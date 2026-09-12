import {
  cropLabels,
  type DashboardResponse,
  type Plot,
} from "@agrosense/contracts";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { currentAlert, formatInstant, plotStatus } from "./presentation";

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
      <Button variant="outline" className="min-h-11 min-w-11" onClick={onBack}>
        Back to fields
      </Button>
      <h2 tabIndex={-1} id="field-detail-title">
        {plot.name}
      </h2>
      <Badge
        variant={status.badgeVariant}
        className="h-auto whitespace-normal text-sm"
      >
        {status.label}
      </Badge>
      <p>{status.reason}</p>
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
            Forecast from {formatInstant(forecast.hours[0]?.at ?? null)} to{" "}
            {formatInstant(forecast.hours.at(-1)?.at ?? null)}.
          </p>
          <p className="metadata">
            {forecast.source.isDemo ? "Synthetic forecast" : "Open-Meteo"} ·
            Retrieved {formatInstant(forecast.source.retrievedAt)} ·
            Temperatures at 2 m
          </p>
        </>
      ) : (
        <p>Weather observations are unavailable.</p>
      )}
      <p className="metadata">
        Last evaluation: {formatInstant(status.time)} · Córdoba time (UTC−3)
      </p>
    </>
  );
}
