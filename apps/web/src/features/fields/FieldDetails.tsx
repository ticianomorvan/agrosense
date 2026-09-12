import {
  cropLabels,
  type DashboardResponse,
  type Plot,
} from "@agrosense/contracts";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  assessmentSource,
  forecastFreshness,
  formatInstant,
  plotStatus,
} from "./presentation";

export function FieldDetails({
  data,
  now,
  plot,
  onBack,
}: {
  data: DashboardResponse;
  now: number;
  plot: Plot;
  onBack: () => void;
}) {
  const status = plotStatus(data, plot.id, now);
  const crop = plot.activeCropCycle;
  const actions = status.isCurrent
    ? status.assessment?.alert.recommendedActions
    : undefined;
  const facts = [
    ["Crop", crop ? cropLabels[crop.cropCode] : "Unavailable"],
    ["Growth stage", crop?.stageCode ?? "Unavailable"],
    ["Stage observed", crop?.stageAsOf ?? "Unavailable"],
    ["Declared area", `${plot.declaredAreaHa.toLocaleString("en-GB")} ha`],
  ];
  const forecast = data.forecast?.plots.find((p) => p.plotId === plot.id);
  return (
    <>
      <Button variant="outline" onClick={onBack}>
        Back to fields
      </Button>
      <h2 tabIndex={-1} id="field-detail-title">
        {plot.name}
      </h2>
      <Badge variant={status.badgeVariant}>{status.label}</Badge>
      <p>{status.reason}</p>
      {!status.isCurrent &&
        status.assessment?.alert.assessmentState === "evaluated" && (
          <>
            <h3>Previous assessment · not current</h3>
            <p>
              {status.assessment.alert.riskLevel &&
                `Previously ${status.assessment.alert.riskLevel} risk. `}
              {status.assessment.alert.reason}
            </p>
          </>
        )}
      <dl className="my-6 grid gap-3">
        {facts.map(([label, value]) => (
          <div key={label} className="flex flex-wrap justify-between gap-4">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-right tabular-nums wrap-anywhere">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <h3>Recommended actions</h3>
      {actions?.length ? (
        <ul className="space-y-2 pl-6 wrap-anywhere">
          {actions.map((action, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Ordered read-only strings have no IDs and may repeat.
            <li key={index}>{action}</li>
          ))}
        </ul>
      ) : (
        <p>
          Recommended actions are unavailable for this field's current
          evaluation.
        </p>
      )}
      {status.assessment?.alert.lossEstimate ? (
        <>
          <h3>Estimated production loss</h3>
          <p className="text-lg font-semibold tabular-nums">
            USD{" "}
            {status.assessment.alert.lossEstimate.estimatedLossUsd.toLocaleString(
              "en-US",
              { minimumFractionDigits: 2, maximumFractionDigits: 2 },
            )}
          </p>
          <p className="text-sm leading-normal text-muted-foreground">
            Synthetic estimate:{" "}
            {(
              status.assessment.alert.lossEstimate.damageRate * 100
            ).toLocaleString("en-US", {
              maximumFractionDigits: 1,
            })}
            % of exposed production (
            {status.assessment.alert.lossEstimate.exposedProductionTons.toLocaleString(
              "en-US",
              { maximumFractionDigits: 2 },
            )}{" "}
            t). Price: USD{" "}
            {status.assessment.alert.lossEstimate.expectedPriceUsdPerTon}/t.
          </p>
        </>
      ) : null}
      <h3>Weather context</h3>
      {forecast ? (
        <>
          <p>
            Forecast from {formatInstant(data.forecast?.windowStart ?? null)} to{" "}
            {formatInstant(data.forecast?.windowEnd ?? null)} · Córdoba time
            (UTC−3).
          </p>
          <p>{forecastFreshness(data, now)}</p>
          <p className="text-sm leading-normal text-muted-foreground tabular-nums">
            {forecast.source.isDemo ? "Synthetic forecast" : "Open-Meteo"} ·
            Retrieved {formatInstant(forecast.source.retrievedAt)} ·
            Temperatures at 2 m
          </p>
        </>
      ) : (
        <p>Forecast data is unavailable for this field.</p>
      )}
      <p className="text-sm leading-normal text-muted-foreground tabular-nums">
        Last evaluation: {formatInstant(status.time)} · Córdoba time (UTC−3)
        <br />
        Source: {assessmentSource(status)}
      </p>
    </>
  );
}
