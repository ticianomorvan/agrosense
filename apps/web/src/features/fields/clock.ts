import type { DashboardResponse } from "@agrosense/contracts";
import { useEffect, useState } from "react";

// Subscribe to the response's deadlines, not a polling interval or a new TTL.
export function subscribeToRiskClock(
  data: DashboardResponse,
  onTimeChange: (now: number) => void,
) {
  const deadlines = data.events.flatMap((event) => [
    Date.parse(event.endsAt),
    ...event.alerts.map((alert) => Date.parse(alert.validUntil)),
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    clearTimeout(timer);
    const now = Math.max(Date.now(), Date.parse(data.asOf));
    const next = Math.min(...deadlines.filter((deadline) => deadline > now));
    if (Number.isFinite(next))
      timer = setTimeout(refresh, Math.min(next - now, 2_147_483_647));
  }
  function refresh() {
    onTimeChange(Date.now());
    schedule();
  }
  function onVisibilityChange() {
    if (document.visibilityState === "visible") refresh();
  }
  schedule();
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

export function useRiskClock(data: DashboardResponse | undefined) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!data) return;
    return subscribeToRiskClock(data, (time) => {
      // Moving the system clock backward must not revive expired advice.
      setNow((previous) => Math.max(previous, time));
    });
  }, [data]);
  return Math.max(now, Date.now());
}
