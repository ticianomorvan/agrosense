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
      <dl className="field-facts">
        <div>
          <dt>Crop</dt>
          <dd>{crop ? cropLabels[crop.cropCode] : "Unavailable"}</dd>
        </div>
        <div>
          <dt>Growth stage</dt>
          <dd>{crop?.stageCode ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Stage observed</dt>
          <dd>{crop?.stageAsOf ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Declared area</dt>
          <dd>{plot.declaredAreaHa.toLocaleString("en-GB")} ha</dd>
        </div>
      </dl>
      <h3>Recommended actions</h3>
      {actions?.length ? (
        <ul className="recommended-actions">
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
      <h3>Weather context</h3>
      {forecast ? (
        <>
          <p>
            Forecast from {formatInstant(data.forecast?.windowStart ?? null)} to{" "}
            {formatInstant(data.forecast?.windowEnd ?? null)} · Córdoba time
            (UTC−3).
          </p>
          <p>{forecastFreshness(data, now)}</p>
          <p className="metadata">
            {forecast.source.isDemo ? "Synthetic forecast" : "Open-Meteo"} ·
            Retrieved {formatInstant(forecast.source.retrievedAt)} ·
            Temperatures at 2 m
          </p>
        </>
      ) : (
        <p>Forecast data is unavailable for this field.</p>
      )}
      <p className="metadata">
        Last evaluation: {formatInstant(status.time)} · Córdoba time (UTC−3)
        <br />
        Source: {assessmentSource(status)}
      </p>
    </>
  );
}
