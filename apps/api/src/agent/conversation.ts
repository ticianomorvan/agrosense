import {
  type WhatsappAgentRun,
  type WhatsappMessageResponse,
  whatsappAgentRunSchema,
  whatsappTextSchema,
} from "@agrosense/contracts";
import { KapsoError } from "../lib/kapso";
import { AgentConfigurationError } from "./config";
import { type InboundMessage, messageFingerprint } from "./inbound";
import { AgentError } from "./model";
import { type AgentResult, AgentRunError, type ChatMessage } from "./runner";

// This small storage boundary is implemented by Durable Object storage in production.
export interface StoreTransaction {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: {
    prefix: string;
    end?: string;
    limit?: number;
  }): Promise<Map<string, T>>;
  setAlarm(timestamp: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}
export interface ConversationStore extends StoreTransaction {
  transaction<T>(action: (store: StoreTransaction) => Promise<T>): Promise<T>;
}
export type RunInput = {
  message: InboundMessage;
  ownerId: string;
  history: ChatMessage[];
};
export type SendInput = {
  message: InboundMessage;
  ownerId: string;
  reply: string;
};
type Record = WhatsappAgentRun & {
  fingerprint: string;
  expiresAt: number;
  input: { message: InboundMessage; ownerId: string } | null;
  reply: string | null;
};
type History = { messages: ChatMessage[]; expiresAt: number };
const DAY = 86400000;
const fallbackReply =
  "I couldn’t complete that check right now. Please try again in a few minutes.";
const expiryPrefix = (time: number) =>
  `expiry:${String(time).padStart(16, "0")}`;
const terminal = (status: Record["status"]) =>
  ["accepted", "failed", "send_unknown"].includes(status);
export class AdmissionError extends Error {
  constructor(readonly status: 409 | 429) {
    super(
      status === 409
        ? "Message ID reused with different content"
        : "Conversation capacity reached",
    );
  }
}

export class Conversation {
  private readonly store: ConversationStore;
  private readonly now: () => number;
  constructor(
    private readonly options: {
      store: ConversationStore;
      now?: () => number;
      run(input: RunInput): Promise<AgentResult>;
      send(input: SendInput): Promise<WhatsappMessageResponse>;
    },
  ) {
    this.store = options.store;
    this.now = options.now ?? Date.now;
  }

  async enqueue(messages: InboundMessage[], ownerId: string) {
    const prepared = await Promise.all(
      messages.map(async (message) => ({
        message,
        fingerprint: `${ownerId}:${await messageFingerprint(message)}`,
      })),
    );
    return this.store.transaction(async (store) => {
      const queue = (await store.get<string[]>("queue")) ?? [];
      const unique = new Map<string, (typeof prepared)[number]>();
      let duplicates = 0;
      for (const item of prepared) {
        const existing = await store.get<Record>(
          `run:${item.message.messageId}`,
        );
        const fingerprint =
          existing?.fingerprint ??
          unique.get(item.message.messageId)?.fingerprint;
        if (fingerprint) {
          if (fingerprint !== item.fingerprint) throw new AdmissionError(409);
          duplicates++;
        } else unique.set(item.message.messageId, item);
      }
      if (!unique.size) {
        if (queue.length) await store.setAlarm(this.now() + 1);
        return { accepted: 0, duplicates };
      }
      const now = this.now();
      let rate = await store.get<{ startedAt: number; count: number }>("rate");
      if (!rate || now - rate.startedAt >= 3600000)
        rate = { startedAt: now, count: 0 };
      if (queue.length + unique.size > 20 || rate.count + unique.size > 60)
        throw new AdmissionError(429);
      for (const { message, fingerprint } of unique.values()) {
        const expiresAt = now + 7 * DAY;
        const record: Record = {
          messageId: message.messageId,
          status: "queued",
          receivedAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          attempts: 0,
          modelSteps: 0,
          trace: [],
          replyMessageId: null,
          errorCode: null,
          input: { message, ownerId },
          reply: null,
          fingerprint,
          expiresAt,
        };
        await store.put(`run:${message.messageId}`, record);
        await store.put(
          `${expiryPrefix(expiresAt)}:${message.messageId}`,
          `run:${message.messageId}`,
        );
        queue.push(message.messageId);
      }
      await store.put("queue", queue);
      await store.put("rate", { ...rate, count: rate.count + unique.size });
      // Admission and wakeup are atomic; HTTP acknowledgement follows this commit.
      await store.setAlarm(now + 1);
      return { accepted: unique.size, duplicates };
    });
  }

  async status(messageId: string): Promise<WhatsappAgentRun | null> {
    const record = await this.store.get<Record>(`run:${messageId}`);
    if (!record || record.expiresAt <= this.now()) return null;
    return whatsappAgentRunSchema.strip().parse(record);
  }

  // Called only by the Durable Object alarm, whose invocations Cloudflare serializes.
  async processNext(): Promise<void> {
    await this.cleanup();
    const queue = (await this.store.get<string[]>("queue")) ?? [];
    const id = queue[0];
    if (!id) {
      await this.schedule();
      return;
    }
    const record = await this.store.get<Record>(`run:${id}`);
    if (!record || terminal(record.status)) {
      await this.removeFromQueue(id);
      await this.schedule();
      return;
    }
    // A later alarm recovers a crash. No external operation runs in a transaction.
    await this.store.setAlarm(this.now() + 120000);
    if (record.status === "sending") {
      record.errorCode = "SEND_OUTCOME_UNKNOWN";
      await this.finish(record, "send_unknown");
      return;
    }
    const input = record.input;
    if (!input || Date.parse(input.message.sentAt) < this.now() - DAY) {
      record.errorCode = "MESSAGE_EXPIRED";
      await this.finish(record, "failed");
      return;
    }
    if (record.status === "queued" || record.status === "running") {
      if (record.attempts >= 2) {
        record.reply = fallbackReply;
        record.errorCode = "AGENT_RECOVERY_EXHAUSTED";
      } else {
        record.status = "running";
        record.attempts++;
        record.updatedAt = new Date(this.now()).toISOString();
        await this.store.put(`run:${id}`, record);
        const history = await this.store.get<History>("history");
        try {
          const result = await this.options.run({
            ...input,
            history:
              history && history.expiresAt > this.now() ? history.messages : [],
          });
          record.reply = whatsappTextSchema.parse(result.reply);
          record.trace = result.trace;
          record.modelSteps = result.modelSteps;
        } catch (error) {
          if (error instanceof AgentRunError) {
            record.trace = error.trace;
            record.modelSteps = error.modelSteps;
          }
          record.reply = fallbackReply;
          record.errorCode =
            error instanceof AgentError ? error.code : "AGENT_UNAVAILABLE";
        }
      }
      record.status = "reply_pending";
      record.updatedAt = new Date(this.now()).toISOString();
      await this.store.put(`run:${id}`, record);
    }
    if (!record.reply || Date.parse(input.message.sentAt) < this.now() - DAY) {
      record.errorCode = "MESSAGE_EXPIRED";
      await this.finish(record, "failed");
      return;
    }
    record.status = "sending";
    record.updatedAt = new Date(this.now()).toISOString();
    await this.store.put(`run:${id}`, record);
    let status: "accepted" | "failed" | "send_unknown";
    try {
      const sent = await this.options.send({ ...input, reply: record.reply });
      record.replyMessageId = sent.messageId;
      status = "accepted";
    } catch (error) {
      status =
        error instanceof AgentConfigurationError ||
        (error instanceof KapsoError && error.code !== "SEND_OUTCOME_UNKNOWN")
          ? "failed"
          : "send_unknown";
      record.errorCode =
        error instanceof KapsoError
          ? error.code
          : error instanceof AgentConfigurationError
            ? "AGENT_UNAVAILABLE"
            : "SEND_OUTCOME_UNKNOWN";
    }
    await this.finish(record, status);
  }

  private async finish(
    record: Record,
    status: "accepted" | "failed" | "send_unknown",
  ) {
    await this.store.transaction(async (store) => {
      if (status === "accepted" && record.input && record.reply) {
        const prior = await store.get<History>("history");
        const history =
          prior && prior.expiresAt > this.now()
            ? prior
            : ({ messages: [], expiresAt: this.now() + DAY } satisfies History);
        // A follow-up must not extend the retention of older messages.
        history.messages = [
          ...history.messages,
          { role: "user" as const, content: record.input.message.text },
          { role: "assistant" as const, content: record.reply },
        ].slice(-12);
        await store.put("history", history);
      }
      await store.put(`run:${record.messageId}`, {
        ...record,
        status,
        updatedAt: new Date(this.now()).toISOString(),
        input: null,
        reply: null,
      });
      const queue = (await store.get<string[]>("queue")) ?? [];
      await store.put(
        "queue",
        queue.filter((id) => id !== record.messageId),
      );
    });
    await this.schedule();
  }

  private async removeFromQueue(id: string) {
    await this.store.transaction(async (store) => {
      const queue = (await store.get<string[]>("queue")) ?? [];
      await store.put(
        "queue",
        queue.filter((item) => item !== id),
      );
    });
  }

  private async cleanup() {
    await this.store.transaction(async (store) => {
      const expired = await store.list<string>({
        prefix: "expiry:",
        end: `${expiryPrefix(this.now() + 1)}:`,
        limit: 100,
      });
      for (const [index, key] of expired) {
        await store.delete(key);
        await store.delete(index);
      }
      const history = await store.get<History>("history");
      if (history && history.expiresAt <= this.now())
        await store.delete("history");
    });
  }

  private async schedule() {
    await this.store.transaction(async (store) => {
      const queue = (await store.get<string[]>("queue")) ?? [];
      if (queue.length) {
        await store.setAlarm(this.now() + 1);
        return;
      }
      const firstExpiry = (
        await store.list<string>({ prefix: "expiry:", limit: 1 })
      )
        .keys()
        .next().value;
      const history = await store.get<History>("history");
      const next = Math.min(
        firstExpiry ? Number(firstExpiry.split(":")[1]) : Infinity,
        history?.expiresAt ?? Infinity,
      );
      if (Number.isFinite(next))
        await store.setAlarm(Math.max(this.now() + 1, next));
      else await store.deleteAlarm();
    });
  }
}
