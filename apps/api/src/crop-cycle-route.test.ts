import { afterEach, expect, it, vi } from "vitest";
import app from "./index";
import * as cropCycle from "./lib/crop-cycle";

vi.mock("./lib/auth", () => ({
  requireAuth: async (_context: unknown, next: () => Promise<void>) => next(),
}));
afterEach(() => vi.restoreAllMocks());

const path =
  "/api/farms/11111111-1111-4111-8111-111111111111/plots/22222222-2222-4222-8222-222222222222/crop-cycle";

it("cancels an oversized stream before consuming the remaining body", async () => {
  let chunksRead = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        chunksRead++;
        controller.enqueue(new Uint8Array(8192));
        if (chunksRead === 4) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const response = await app.request(
    new Request(`http://localhost${path}`, {
      method: "PATCH",
      body,
      duplex: "half",
    } as RequestInit),
  );
  expect(response.status).toBe(413);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(cancelled).toBe(true);
  expect(chunksRead).toBe(3);
});

it("accepts a valid body exactly at the byte limit", async () => {
  const update = vi
    .spyOn(cropCycle, "updateCropCycle")
    .mockRejectedValue(new cropCycle.CropCycleError({ kind: "conflict" }));
  const payload = { expectedDataVersion: 1, sownOn: null };
  const response = await app.request(path, {
    method: "PATCH",
    body: JSON.stringify(payload).padEnd(16 * 1024, " "),
  });
  expect(response.status).toBe(409);
  expect(update).toHaveBeenCalledWith(
    undefined,
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    payload,
  );
});

it("counts UTF-8 bytes rather than characters", async () => {
  const response = await app.request(path, {
    method: "PATCH",
    body: "é".repeat(8193),
  });
  expect(response.status).toBe(413);
});

it.each([undefined, "{"])(
  "rejects malformed or empty JSON: %s",
  async (body) => {
    const response = await app.request(path, { method: "PATCH", body });
    expect(response.status).toBe(400);
  },
);
