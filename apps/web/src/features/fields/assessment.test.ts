import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { createAssessmentDashboard } from "./__fixtures__/assessment";
import { currentAlert, deadlineMilliseconds, plotStatus } from "./assessment";
import { subscribeToRiskClock } from "./clock";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function assessment() {
  const data = createAssessmentDashboard();
  const event = data.events[0];
  const alert = event?.alerts[0];
  assert(event && alert);
  return { data, event, alert, plotId: alert.plotId };
}

function browserEvents() {
  const tab = new EventTarget();
  const documentState = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  vi.stubGlobal("window", tab);
  vi.stubGlobal("document", documentState);
  return { tab, documentState };
}

it("chooses the highest current risk for the selected plot regardless of event order", () => {
  const { data, event, alert, plotId } = assessment();
  const otherPlotAlert = event.alerts[1];
  assert(otherPlotAlert);
  otherPlotAlert.riskLevel = "critical";
  expect(currentAlert(data, plotId)?.alert.id).toBe(alert.id);

  const criticalEvent = structuredClone(event);
  criticalEvent.id = "44444444-4444-4444-8444-444444444445";
  const criticalAlert = criticalEvent.alerts[0];
  assert(criticalAlert);
  criticalAlert.id = "55555555-5555-4555-8555-555555555553";
  criticalAlert.eventId = criticalEvent.id;
  criticalAlert.inputSnapshot.event.id = criticalEvent.id;
  criticalAlert.riskLevel = "critical";
  criticalEvent.alerts = [criticalAlert];
  for (const events of [
    [event, criticalEvent],
    [criticalEvent, event],
  ]) {
    expect(currentAlert({ ...data, events }, plotId)?.event.id).toBe(
      criticalEvent.id,
    );
  }
});

it.each([
  "stale",
  "recent",
  "cancelled",
  "insufficient_data",
  "no_applicable_rule",
  "expired assessment",
  "ended event",
] as const)("excludes a %s assessment from current actions", (state) => {
  const { data, event, alert, plotId } = assessment();
  if (state === "stale") alert.isStale = true;
  if (state === "recent") event.temporalState = "recent";
  if (state === "cancelled") event.status = "cancelled";
  if (state === "insufficient_data" || state === "no_applicable_rule") {
    alert.assessmentState = state;
    alert.riskLevel = null;
    alert.recommendedActions = [];
  }
  if (state === "expired assessment") alert.validUntil = data.asOf;
  if (state === "ended event") event.endsAt = data.asOf;

  expect(currentAlert(data, plotId)).toBeUndefined();
  expect(plotStatus(data, plotId)).toMatchObject({
    isCurrent: false,
    time: alert.generatedAt,
    assessment: { alert },
  });
});

it("expires a PostgreSQL deadline at its fractional instant without rounding it down", () => {
  const { data, alert, plotId } = assessment();
  data.asOf = "2026-09-12T12:30:00.123455Z";
  alert.validUntil = "2026-09-12T12:30:00.123456Z";
  const browserTime = Date.parse(data.asOf);
  expect(deadlineMilliseconds(alert.validUntil)).toBe(browserTime + 1);
  expect(currentAlert(data, plotId, browserTime)?.alert.id).toBe(alert.id);
  expect(currentAlert(data, plotId, browserTime + 1)).toBeUndefined();

  data.asOf = alert.validUntil;
  expect(currentAlert(data, plotId, browserTime)).toBeUndefined();
});

it("does not revive an assessment already expired at the response time when the browser clock moves backward", () => {
  const { data, event, alert, plotId } = assessment();
  data.asOf = alert.validUntil;
  event.endsAt = new Date(
    Date.parse(alert.validUntil) + 3_600_000,
  ).toISOString();
  const earlierBrowserTime = Date.parse(alert.validUntil) - 60_000;
  expect(currentAlert(data, plotId, earlierBrowserTime)).toBeUndefined();
});

it("notifies at assessment expiry without fetching and cancels remaining deadlines on cleanup", () => {
  const { data, alert, plotId } = assessment();
  alert.validUntil = "2026-09-12T12:01:00Z";
  browserEvents();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const changed = vi.fn((now: number) => currentAlert(data, plotId, now));
  const stop = subscribeToRiskClock(data, changed);
  vi.advanceTimersByTime(59_999);
  expect(changed).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(changed).toHaveBeenCalledExactlyOnceWith(Date.now());
  expect(changed).toHaveLastReturnedWith(undefined);
  expect(fetcher).not.toHaveBeenCalled();
  stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("rechecks suspended time on focus and visible resume, then removes its listeners", () => {
  const { data, event, plotId } = assessment();
  const { tab, documentState } = browserEvents();
  const changed = vi.fn((now: number) => currentAlert(data, plotId, now));
  const stop = subscribeToRiskClock(data, changed);
  vi.setSystemTime(new Date(event.endsAt));
  documentState.visibilityState = "hidden";
  documentState.dispatchEvent(new Event("visibilitychange"));
  expect(changed).not.toHaveBeenCalled();
  documentState.visibilityState = "visible";
  documentState.dispatchEvent(new Event("visibilitychange"));
  tab.dispatchEvent(new Event("focus"));
  expect(changed).toHaveBeenCalledTimes(2);
  expect(changed).toHaveLastReturnedWith(undefined);
  stop();
  documentState.dispatchEvent(new Event("visibilitychange"));
  tab.dispatchEvent(new Event("focus"));
  expect(changed).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
