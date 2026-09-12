import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { createAssessmentDashboard } from "./__fixtures__/assessment";
import { FieldOverview } from "./FieldOverview";

const now = new Date("2026-09-12T12:00:00Z");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderWorkspace(data = createAssessmentDashboard(now)) {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const client = new QueryClient();
  const source = {
    scope: "test",
    farmId: data.farm.id,
    loadDashboard: vi.fn(),
    loadSatellite: vi.fn(),
  };
  client.setQueryData(["dashboard", source.scope, source.farmId], data);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <FieldOverview source={source} onAddPlot={() => {}} />
    </QueryClientProvider>,
  );
}

it("shows the selected plot's recommendations and potential loss in the workspace", () => {
  const html = renderWorkspace();
  expect(html).toContain("Recommended actions");
  expect(html).toContain("Potential production loss");
  expect(html).toContain("30,600.00");
  expect(html).toContain("Apply supplemental irrigation");
  expect(html).not.toContain("Monitor damage to flowers");
});

it("changes the assessment with the selected plot", () => {
  const data = createAssessmentDashboard(now);
  data.plots = [...data.plots.slice(1), ...data.plots.slice(0, 1)];
  const html = renderWorkspace(data);
  expect(html).toContain("Monitor damage to flowers");
  expect(html).not.toContain("Apply supplemental irrigation");
  expect(html).toContain("13,824.00");
});

it("does not present expired recommendations or loss estimates as current", () => {
  const data = createAssessmentDashboard(now);
  for (const event of data.events)
    for (const alert of event.alerts) {
      alert.validUntil = now.toISOString();
    }
  const html = renderWorkspace(data);
  expect(html).toContain("no longer current");
  expect(html).not.toContain("Apply supplemental irrigation");
  expect(html).not.toContain("30,600.00");
});

it("keeps recommendations when the economic estimate is unavailable", () => {
  const data = createAssessmentDashboard(now);
  for (const event of data.events)
    for (const alert of event.alerts) {
      alert.lossEstimate = null;
    }
  const html = renderWorkspace(data);
  expect(html).toContain("Apply supplemental irrigation");
  expect(html).toContain("No current loss estimate is available.");
  expect(html).not.toContain("USD 0");
});
