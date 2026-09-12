import { encode } from "fast-png";
import { expect, it, vi } from "vitest";
import { loadSatellitePreview } from "./provider";

const boundary = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-64.17, -31.47],
      [-64.154, -31.47],
      [-64.154, -31.456],
      [-64.17, -31.456],
      [-64.17, -31.47],
    ],
  ].map((r) => r.map((p) => p as [number, number])),
};
const window = { from: "2026-09-01T00:00:00Z", to: "2026-09-11T23:59:59Z" };
const env = {
  COPERNICUS_CLIENT_ID: "test-id",
  COPERNICUS_CLIENT_SECRET: "test-secret",
};
const scene = {
  id: "S2-test",
  properties: { datetime: "2026-09-10T14:00:00Z", "eo:cloud_cover": 12 },
};

it("returns not_configured without a provider call", async () => {
  const fetcher = vi.fn();
  expect(
    await loadSatellitePreview({}, boundary, window, fetcher),
  ).toMatchObject({ status: "unavailable", reason: "not_configured" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("distinguishes an empty catalog and refuses truncated searches", async () => {
  for (const catalog of [
    { features: [], context: {} },
    { features: [scene], context: { next: 100 } },
  ]) {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "provider-token" }))
      .mockResolvedValueOnce(Response.json(catalog));
    if (catalog.features.length)
      await expect(
        loadSatellitePreview(env, boundary, window, fetcher),
      ).rejects.toThrow("Satellite imagery is temporarily unavailable");
    else
      expect(
        await loadSatellitePreview(env, boundary, window, fetcher),
      ).toMatchObject({ reason: "no_scenes" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  }
});
it("returns dated true-color imagery and identifies fully empty rasters", async () => {
  for (const alpha of [0, 255]) {
    const png = encode({
      width: 1,
      height: 1,
      data: new Uint8Array([20, 60, 30, alpha]),
      channels: 4,
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "provider-token" }))
      .mockResolvedValueOnce(Response.json({ features: [scene], context: {} }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array(png), {
          headers: { "content-type": "image/png" },
        }),
      );
    const result = await loadSatellitePreview(env, boundary, window, fetcher);
    expect(result).toMatchObject(
      alpha
        ? {
            status: "available",
            acquiredAt: new Date(scene.properties.datetime).toISOString(),
            cloudCoverPercent: 12,
          }
        : { reason: "no_coverage" },
    );
    expect(JSON.stringify(result)).not.toContain("provider-token");
    const processRequest = JSON.parse(
      fetcher.mock.calls[2]?.[1]?.body as string,
    );
    expect(processRequest.input.bounds.properties.crs).toContain("3857");
    expect(processRequest.input.data[0].dataFilter.timeRange.from).toBe(
      new Date(scene.properties.datetime).toISOString(),
    );
  }
});
it("rejects oversized geometry before authenticating with the provider", async () => {
  const fetcher = vi.fn();
  const oversized = structuredClone(boundary);
  const ring = oversized.coordinates[0];
  if (!ring) throw new Error("Missing test ring");
  ring[1] = [-60, -31.47];
  await expect(
    loadSatellitePreview(env, oversized, window, fetcher),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it("sanitizes provider failures and never silently substitutes a fixture", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response("credential detail", { status: 429 }));
  await expect(
    loadSatellitePreview(env, boundary, window, fetcher),
  ).rejects.toThrow("Satellite imagery is temporarily unavailable");
});
it("uses a redirect mode supported by the Worker runtime", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (init?.redirect === "error")
      throw new TypeError("Invalid redirect value in workerd");
    return Response.json(
      String(url).endsWith("/token")
        ? { access_token: "provider-token" }
        : { features: [] },
    );
  });
  await expect(
    loadSatellitePreview(env, boundary, window, fetcher),
  ).resolves.toMatchObject({ reason: "no_scenes" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("rejects redirects at every provider step without following them", async () => {
  for (const step of [0, 1, 2]) {
    const responses = [
      Response.json({ access_token: "provider-token" }),
      Response.json({ features: [scene] }),
    ];
    responses[step] = new Response("redirect body", {
      status: 307,
      headers: { Location: "https://example.invalid/collect" },
    });
    const fetcher = vi.fn<typeof fetch>(async () => {
      const response = responses.shift();
      if (!response) throw new Error("Unexpected request after redirect");
      return response;
    });
    await expect(
      loadSatellitePreview(env, boundary, window, fetcher),
    ).rejects.toThrow("Satellite imagery is temporarily unavailable");
    expect(fetcher).toHaveBeenCalledTimes(step + 1);
    for (const [, init] of fetcher.mock.calls)
      expect(init?.redirect).toBe("manual");
  }
});
