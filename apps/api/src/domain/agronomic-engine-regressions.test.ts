import {
  DEMO_V1_RULES,
  type EvaluatePlotAlertInput,
  evaluatePlotAlert,
  plotAlertSchema,
} from "@agrosense/contracts";
import { assert, describe, expect, it } from "vitest";

const plotId = "44444444-4444-4444-8444-444444444444";
function createEvaluationInput(): EvaluatePlotAlertInput {
  return {
    alertId: "55555555-5555-4555-8555-555555555555",
    now: "2026-09-12T00:30:00Z",
    plot: {
      id: plotId,
      activeCropCycle: {
        id: "33333333-3333-4333-8333-333333333333",
        plotId,
        cropCode: "maize",
        seasonLabel: "2026/27",
        sownOn: "2026-08-01",
        stageCode: "V3",
        stageAsOf: "2026-09-05",
        endedOn: null,
        updatedAt: "2026-09-05T12:00:00Z",
      },
    },
    event: {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "frost",
      status: "active",
      startsAt: "2026-09-12T01:00:00Z",
      endsAt: "2026-09-12T02:00:00Z",
      evidence: {
        schemaVersion: 1,
        scope: "farm_demo",
        plotIds: [plotId],
        forecastDate: "2026-09-12",
        samplePoint: null,
        source: {
          code: "demo",
          url: null,
          issuedAt: null,
          retrievedAt: "2026-09-12T00:00:00Z",
          isDemo: true,
        },
        temperatureHeightM: 2,
        detectionThresholdC: 0,
        hours: [
          {
            at: "2026-09-12T01:00:00Z",
            temperatureC: -2,
            windGustKmh: null,
            precipitationMm: null,
            precipitationProbability: null,
            weatherCode: null,
          },
        ],
      },
    },
  };
}

describe("Agronomic engine regression boundaries", () => {
  it("rejects evidence whose freshness deadline has expired", () => {
    const value = createEvaluationInput();
    value.now = "2026-09-12T02:00:00Z";
    expect(() => evaluatePlotAlert(value)).toThrow();
  });
  it("rejects a stage observed after the event local start date", () => {
    const value = createEvaluationInput();
    assert(value.plot.activeCropCycle);
    value.plot.activeCropCycle.stageAsOf = "2026-09-12";
    // 01:00 UTC September 12 is 22:00 September 11 in Cordoba.
    expect(evaluatePlotAlert(value).assessmentState).toBe("insufficient_data");
  });
  it("keeps a stage fresh at 14 days on the event local start date", () => {
    const value = createEvaluationInput();
    assert(value.plot.activeCropCycle);
    value.plot.activeCropCycle.stageAsOf = "2026-08-28";
    expect(evaluatePlotAlert(value).assessmentState).toBe("evaluated");
  });
  it("accepts valid PostgreSQL timestamps separated by one microsecond", () => {
    const alert = evaluatePlotAlert(createEvaluationInput());
    alert.generatedAt = "2026-09-12T00:30:00.000001Z";
    alert.validUntil = "2026-09-12T00:30:00.000002Z";
    expect(plotAlertSchema.safeParse(alert).success).toBe(true);
  });
  it("uses lexicographic code order for equal-risk rules", () => {
    const value = createEvaluationInput();
    const baseRule = DEMO_V1_RULES[0];
    assert(baseRule);
    value.rules = ["Z-rule", "a-rule"].map((code) => ({
      ...baseRule,
      code,
    }));
    for (const rules of [value.rules, [...value.rules].reverse()]) {
      const alert = evaluatePlotAlert({ ...value, rules });
      expect(alert.inputSnapshot.matchedRuleCodes).toEqual([
        "Z-rule",
        "a-rule",
      ]);
      expect(alert.reason).toBe(
        "Escenario sintético: la regla Z-rule coincide.",
      );
    }
  });
  it("requires an explicit hazard when storm and hail share evidence", () => {
    const value = createEvaluationInput();
    assert(value.plot.activeCropCycle);
    value.plot.activeCropCycle.stageCode = "V6";
    value.event.kind = "severe-storm";
    value.event.evidence.detectionThresholdC = null;
    for (const hour of value.event.evidence.hours) {
      hour.windGustKmh = 75;
      hour.weatherCode = 96;
    }
    expect(evaluatePlotAlert(value).assessmentState).toBe("evaluated");
    const { kind: _kind, ...snapshot } = value.event;
    expect(() => {
      // @ts-expect-error Snapshot evidence cannot determine the event hazard.
      evaluatePlotAlert({ ...value, event: snapshot });
    }).toThrow();
    value.event.kind = "hail";
    expect(evaluatePlotAlert(value).assessmentState).toBe("no_applicable_rule");
  });

  it.each(["2026-09-12T01:00:00Z", "2026-09-12T02:00:00Z"])(
    "rejects expired evidence at %s even with a future deadline override",
    (now) => {
      const value = createEvaluationInput();
      value.now = now;
      value.validUntil = "2026-09-12T03:00:00Z";
      expect(() => evaluatePlotAlert(value)).toThrow(/INVALID_PROVIDER_DATA/);
    },
  );

  it("caps a requested deadline at the earlier issuance freshness deadline", () => {
    const value = createEvaluationInput();
    value.event.evidence.source.issuedAt = "2026-09-11T18:45:00.000002Z";
    value.now = "2026-09-12T00:45:00.000001Z";
    value.validUntil = "2026-09-12T03:00:00Z";
    expect(evaluatePlotAlert(value).validUntil).toBe(
      "2026-09-12T00:45:00.000002Z",
    );
    value.now = "2026-09-12T00:45:00.000002Z";
    expect(() => evaluatePlotAlert(value)).toThrow(/INVALID_PROVIDER_DATA/);
  });

  it.each([
    ["2026-09-12T00:30:00.000001Z", "2026-09-12T00:30:00.000001Z"],
    ["2026-09-12T00:30:00.000002Z", "2026-09-12T00:30:00.000001Z"],
    ["2026-09-12T00:30:00.1Z", "2026-09-12T00:30:00.100000Z"],
  ])(
    "rejects a non-increasing alert deadline %s -> %s",
    (generatedAt, validUntil) => {
      const alert = evaluatePlotAlert(createEvaluationInput());
      expect(
        plotAlertSchema.safeParse({ ...alert, generatedAt, validUntil })
          .success,
      ).toBe(false);
    },
  );
});
