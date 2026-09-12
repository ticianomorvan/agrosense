import { dashboardResponseSchema } from "@agrosense/contracts";
import { describe, expect, it } from "vitest";
import { createDemoDashboard } from "./demo-source";

describe("createDemoDashboard", () => {
  it("generates a valid DashboardResponse satisfying all schema refinements", () => {
    const dashboard = createDemoDashboard();
    const result = dashboardResponseSchema.safeParse(dashboard);
    expect(result.success).toBe(true);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
  });

  it("includes valid lossEstimate on evaluated alerts", () => {
    const dashboard = createDemoDashboard();
    const frostEvent = dashboard.events.find((e) => e.kind === "frost");
    expect(frostEvent).toBeDefined();

    const alertMaize = frostEvent?.alerts.find(
      (a) => a.plotId === "22222222-2222-4222-8222-222222222221",
    );
    expect(alertMaize?.lossEstimate).toBeDefined();
    expect(alertMaize?.lossEstimate?.cropCode).toBe("maize");
    expect(alertMaize?.lossEstimate?.estimatedLossUsd).toBeGreaterThan(0);
    expect(alertMaize?.lossEstimate?.damageRate).toBe(0.2);

    const alertSoybean = frostEvent?.alerts.find(
      (a) => a.plotId === "22222222-2222-4222-8222-222222222222",
    );
    expect(alertSoybean?.lossEstimate).toBeDefined();
    expect(alertSoybean?.lossEstimate?.cropCode).toBe("soybean");
    expect(alertSoybean?.lossEstimate?.estimatedLossUsd).toBeGreaterThan(0);
    expect(alertSoybean?.lossEstimate?.damageRate).toBe(0.2);
  });
});
