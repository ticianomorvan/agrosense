import {
  cropLabels,
  type DashboardResponse,
  type Plot,
} from "@agrosense/contracts";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  assessmentSource,
  currentAlert,
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
  const current = currentAlert(data, plot.id, now);
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
      {!current && status.assessment?.alert.assessmentState === "evaluated" && (
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
      <h3>Recommended next step</h3>
      <p>
        {current?.alert.recommendation ??
          "A recommendation is unavailable until this field has a current evaluation."}
      </p>
      <h3>Weather context</h3>
      {forecast ? (
        <>
          <p>
            Forecast from {formatInstant(data.forecast?.windowStart ?? null)} to{" "}
            {formatInstant(data.forecast?.windowEnd ?? null)} · Córdoba time
            (UTC−3).
          </p>
          <p>
            {data.monitoring.forecastValidUntil
              ? `Forecast ${Math.max(now, Date.parse(data.asOf)) >= Date.parse(data.monitoring.forecastValidUntil) ? "stale since" : "valid until"} ${formatInstant(data.monitoring.forecastValidUntil)} (UTC−3).`
              : "Forecast freshness unavailable."}
          </p>
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
