import type { DashboardResponse } from "@agrosense/contracts";
import { assessmentSource, plotStatus } from "./assessment";
import { useRiskClock } from "./clock";
import { formatInstant } from "./presentation";

export function PlotAssessment({
  data,
  plotId,
}: {
  data: DashboardResponse;
  plotId: string;
}) {
  const now = useRiskClock(data);
  const status = plotStatus(data, plotId, now);
  const assessment = status.isCurrent ? status.assessment : undefined;
  const loss = assessment?.alert.lossEstimate;

  return (
    <section
      className="min-w-0 space-y-4 rounded-xl border bg-card p-4 wrap-anywhere"
      aria-labelledby="plot-assessment-title"
    >
      <div className="space-y-2">
        <h2 id="plot-assessment-title">Plot assessment</h2>
        {assessment && (
          <p className="font-semibold">{assessment.event.title}</p>
        )}
        <p>{status.reason}</p>
      </div>
      <div className="space-y-2">
        <h3>Potential production loss</h3>
        {loss ? (
          <>
            <p className="text-2xl font-semibold tabular-nums">
              USD{" "}
              {loss.estimatedLossUsd.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
            <p className="text-sm leading-normal text-muted-foreground">
              Synthetic estimate, not an observed loss. Assumes{" "}
              {(loss.damageRate * 100).toLocaleString("en-US", {
                maximumFractionDigits: 1,
              })}
              % damage to{" "}
              {loss.exposedProductionTons.toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })}{" "}
              t of exposed production at USD {loss.expectedPriceUsdPerTon}/t.
            </p>
          </>
        ) : (
          <p>No current loss estimate is available.</p>
        )}
      </div>
      <div className="space-y-2">
        <h3>Recommended actions</h3>
        {assessment?.alert.recommendedActions.length ? (
          <ul className="list-disc space-y-2 pl-6">
            {assessment.alert.recommendedActions.map((action, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Ordered read-only recommendations may repeat.
              <li key={index}>{action}</li>
            ))}
          </ul>
        ) : (
          <p>No current recommendations are available.</p>
        )}
      </div>
      <p className="text-sm leading-normal text-muted-foreground tabular-nums">
        {assessmentSource(status)} · Evaluated {formatInstant(status.time)}{" "}
        (UTC−3)
      </p>
    </section>
  );
}
