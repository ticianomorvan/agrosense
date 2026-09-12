import { describe, expect, it, vi } from "vitest";
import { KapsoError } from "../lib/kapso";
import {
  Conversation,
  type ConversationStore,
  type RunInput,
  type SendInput,
  type StoreTransaction,
} from "./conversation";
import type { InboundMessage } from "./inbound";

class MemoryStore implements ConversationStore {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.data.get(key)) as T | undefined;
  }
  async put(key: string, value: unknown) {
    this.data.set(key, structuredClone(value));
  }
  async delete(key: string) {
    return this.data.delete(key);
  }
  async list<T>(options: { prefix: string; end?: string; limit?: number }) {
    return new Map(
      [...this.data.entries()]
        .filter(
          ([key]) =>
            key.startsWith(options.prefix) &&
            (!options.end || key < options.end),
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, options.limit ?? Infinity)
        .map(([key, value]) => [key, structuredClone(value) as T]),
    );
  }
  async setAlarm(time: number) {
    this.alarm = time;
  }
  async deleteAlarm() {
    this.alarm = null;
  }
  transaction<T>(action: (store: StoreTransaction) => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const snapshot = structuredClone(this.data),
        alarm = this.alarm;
      try {
        return await action(this);
      } catch (error) {
        this.data = snapshot;
        this.alarm = alarm;
        throw error;
      }
    });
    this.tail = result.catch(() => {});
    return result;
  }
}
const ownerId = "11111111-1111-4111-8111-111111111111";
const baseTime = Date.parse("2026-09-12T12:00:00Z");
const message = (
  messageId = "wamid.1",
  text = "Forecast for three days?",
): InboundMessage => ({
  messageId,
  phoneNumberId: "647015955153740",
  sender: "5493511234567",
  text,
  sentAt: new Date(baseTime).toISOString(),
});
function setup(store = new MemoryStore()) {
  let timestamp = baseTime;
  const run = vi.fn(async (_input: RunInput) => ({
    reply: "The forecast is available.",
    trace: [
      { tool: "get_forecast", ok: true, errorCode: null, durationMs: 12 },
    ],
    modelSteps: 2,
  }));
  const send = vi.fn(async (_input: SendInput) => ({
    messageId: "wamid.reply",
    status: "accepted" as const,
  }));
  const conversation = new Conversation({
    store,
    run,
    send,
    now: () => timestamp,
  });
  return {
    store,
    run,
    send,
    conversation,
    advance: (ms: number) => {
      timestamp += ms;
    },
  };
}

describe("durable conversation processing", () => {
  it("persists admission and an alarm before acknowledgement; duplicate deliveries invoke the agent once", async () => {
    const { conversation, store, run, send } = setup();
    const admitted = await Promise.all([
      conversation.enqueue([message()], ownerId),
      conversation.enqueue([message()], ownerId),
    ]);
    expect(admitted.map((result) => result.accepted).sort()).toEqual([0, 1]);
    expect(store.alarm).not.toBeNull();
    expect((await conversation.status("wamid.1"))?.status).toBe("queued");
    expect(run).not.toHaveBeenCalled();
    await conversation.processNext();
    await conversation.processNext();
    expect(run).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      message: message(),
      ownerId,
      reply: "The forecast is available.",
    });
    expect(await conversation.status("wamid.1")).toMatchObject({
      status: "accepted",
      replyMessageId: "wamid.reply",
      trace: [{ tool: "get_forecast", ok: true }],
    });
    const stored = JSON.stringify(await store.get("run:wamid.1"));
    expect(stored).not.toContain(message().text);
    expect(stored).not.toContain(message().sender);
  });

  it("rejects a reused message ID with different content without overwriting its receipt", async () => {
    const { conversation } = setup();
    await conversation.enqueue([message()], ownerId);
    await expect(
      conversation.enqueue([message("wamid.1", "changed content")], ownerId),
    ).rejects.toMatchObject({ status: 409 });
    expect((await conversation.status("wamid.1"))?.status).toBe("queued");
  });

  it("deduplicates repeated IDs inside one batch and rejects conflicting batches atomically", async () => {
    const { conversation } = setup();
    expect(await conversation.enqueue([message(), message()], ownerId)).toEqual(
      { accepted: 1, duplicates: 1 },
    );
    await expect(
      conversation.enqueue(
        [message("wamid.2"), message("wamid.1", "changed")],
        ownerId,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await conversation.status("wamid.2")).toBeNull();
  });

  it("caps queued work and returns a retryable admission error", async () => {
    const { conversation } = setup();
    await conversation.enqueue(
      Array.from({ length: 20 }, (_, index) => message(`wamid.${index}`)),
      ownerId,
    );
    await expect(
      conversation.enqueue([message("wamid.extra")], ownerId),
    ).rejects.toMatchObject({ status: 429 });
    expect(await conversation.status("wamid.extra")).toBeNull();
  });

  it("retains bounded conversation history for follow-up messages", async () => {
    const { conversation, run } = setup();
    await conversation.enqueue([message()], ownerId);
    await conversation.processNext();
    await conversation.enqueue([message("wamid.2", "And tomorrow?")], ownerId);
    await conversation.processNext();
    expect(run.mock.calls[1]?.[0]).toMatchObject({
      history: [
        { role: "user", content: message().text },
        { role: "assistant", content: "The forecast is available." },
      ],
    });
  });

  it("forgets history after 24 hours", async () => {
    const { conversation, advance, run } = setup();
    await conversation.enqueue([message()], ownerId);
    await conversation.processNext();
    advance(86400001);
    await conversation.enqueue(
      [
        {
          ...message("wamid.2"),
          sentAt: new Date(baseTime + 86400001).toISOString(),
        },
      ],
      ownerId,
    );
    await conversation.processNext();
    expect(run.mock.calls[1]?.[0]).toMatchObject({ history: [] });
  });

  it("recovers interrupted reasoning without losing the durable input", async () => {
    const { conversation, store, run } = setup();
    await conversation.enqueue([message()], ownerId);
    const record = await store.get<Record<string, unknown>>("run:wamid.1");
    await store.put("run:wamid.1", {
      ...record,
      status: "running",
      attempts: 1,
    });
    await conversation.processNext();
    expect(run).toHaveBeenCalledTimes(1);
    expect((await conversation.status("wamid.1"))?.status).toBe("accepted");
  });

  it("uses a stored generated reply after restart without calling the model again", async () => {
    const { conversation, store, run, send } = setup();
    await conversation.enqueue([message()], ownerId);
    const record = await store.get<Record<string, unknown>>("run:wamid.1");
    await store.put("run:wamid.1", {
      ...record,
      status: "reply_pending",
      reply: "Already generated",
    });
    await conversation.processNext();
    expect(run).not.toHaveBeenCalled();
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      reply: "Already generated",
    });
  });

  it("never resends after a crash once the sending marker was persisted", async () => {
    const { conversation, store, run, send } = setup();
    await conversation.enqueue([message()], ownerId);
    const record = await store.get<Record<string, unknown>>("run:wamid.1");
    await store.put("run:wamid.1", {
      ...record,
      status: "sending",
      reply: "Possibly sent",
    });
    await conversation.processNext();
    expect((await conversation.status("wamid.1"))?.status).toBe("send_unknown");
    expect(run).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("records uncertain outbound outcomes without retries or invented delivery success", async () => {
    const { conversation, send } = setup();
    send.mockRejectedValue(
      new KapsoError("SEND_OUTCOME_UNKNOWN", 504, "Unknown"),
    );
    await conversation.enqueue([message()], ownerId);
    await conversation.processNext();
    await conversation.enqueue([message()], ownerId);
    await conversation.processNext();
    expect((await conversation.status("wamid.1"))?.status).toBe("send_unknown");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends an honest unavailable reply when the agent fails and keeps safe error metadata", async () => {
    const { conversation, run, send } = setup();
    run.mockRejectedValue(new Error("private error details"));
    await conversation.enqueue([message()], ownerId);
    await conversation.processNext();
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      reply: expect.stringContaining("couldn’t complete"),
    });
    const status = await conversation.status("wamid.1");
    expect(status).toMatchObject({
      status: "accepted",
      errorCode: "AGENT_UNAVAILABLE",
    });
    expect(JSON.stringify(status)).not.toContain("private error details");
  });

  it("expires deduplication receipts after seven days", async () => {
    const { conversation, store, advance } = setup();
    await conversation.enqueue([message()], ownerId);
    await conversation.processNext();
    advance(7 * 86400000 + 1);
    await conversation.processNext();
    expect(await conversation.status("wamid.1")).toBeNull();
    expect(await store.get("history")).toBeUndefined();
    expect(store.alarm).toBeNull();
  });

  it("does not admit work unless its wakeup can be committed", async () => {
    const { conversation, store } = setup();
    vi.spyOn(store, "setAlarm").mockRejectedValueOnce(
      new Error("storage failed"),
    );
    await expect(conversation.enqueue([message()], ownerId)).rejects.toThrow();
    expect(await conversation.status("wamid.1")).toBeNull();
    expect(await store.get("queue")).toBeUndefined();
  });

  it("preserves messages admitted while the agent is running", async () => {
    const { conversation, run, send } = setup();
    run.mockImplementationOnce(async () => {
      await conversation.enqueue([message("wamid.2")], ownerId);
      return { reply: "First", trace: [], modelSteps: 1 };
    });
    await conversation.enqueue([message()], ownerId);
    await conversation.processNext();
    await conversation.processNext();
    expect(send).toHaveBeenCalledTimes(2);
    expect((await conversation.status("wamid.2"))?.status).toBe("accepted");
  });

  it("caps hourly admission independently of queue depth and caps history at six exchanges", async () => {
    const { conversation, run, advance } = setup();
    for (let index = 0; index < 60; index++) {
      await conversation.enqueue([message(`wamid.${index}`)], ownerId);
      await conversation.processNext();
    }
    expect(run.mock.calls[59]?.[0].history).toHaveLength(12);
    await expect(
      conversation.enqueue([message("wamid.limit")], ownerId),
    ).rejects.toMatchObject({ status: 429 });
    advance(3600000);
    expect(
      await conversation.enqueue([message("wamid.limit")], ownerId),
    ).toMatchObject({ accepted: 1 });
  });

  it("does not extend old history retention when a follow-up arrives", async () => {
    const { conversation, advance, run } = setup();
    await conversation.enqueue([message()], ownerId);
    await conversation.processNext();
    advance(23 * 3600000);
    await conversation.enqueue([message("wamid.2")], ownerId);
    await conversation.processNext();
    advance(3600001);
    await conversation.enqueue(
      [
        {
          ...message("wamid.3"),
          sentAt: new Date(baseTime + 86400001).toISOString(),
        },
      ],
      ownerId,
    );
    await conversation.processNext();
    expect(run.mock.calls[2]?.[0].history).toEqual([]);
  });
});
