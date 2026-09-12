import {
  cropLabels,
  type DashboardResponse,
  type Farm,
  type Plot,
} from "@agrosense/contracts";
import { useId } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import { formatInstant } from "./presentation";

export function PlotFacts({
  data,
  plot,
  onSelect,
  onAddPlot,
}: {
  data: DashboardResponse;
  plot: Plot;
  onSelect: (plotId: string) => void;
  onAddPlot: (farm: Farm) => void;
}) {
  const id = useId();
  const crop = plot.activeCropCycle;
  const monitoring = monitoringLabel(data.monitoring.status);
  const facts = [
    ["Declared area", `${plot.declaredAreaHa.toLocaleString("en-GB")} ha`],
    ["Crop", crop ? cropLabels[crop.cropCode] : "Unavailable"],
    ["Season", crop?.seasonLabel ?? "Unavailable"],
    ["Sown", crop?.sownOn ?? "Unavailable"],
    ["Growth stage", crop?.stageCode ?? "Unavailable"],
    ["Stage observed", crop?.stageAsOf ?? "Unavailable"],
  ];
  return (
    <section
      className="min-w-0 space-y-5 rounded-xl border bg-card p-4"
      aria-labelledby="plot-facts-title"
    >
      <div className="space-y-2">
        <h2 id="plot-facts-title">Plot and crop</h2>
        <label className="grid gap-2 font-semibold" htmlFor={`${id}-plot`}>
          Selected plot
          <NativeSelect
            id={`${id}-plot`}
            className="w-full"
            value={plot.id}
            onChange={(event) => onSelect(event.target.value)}
          >
            {data.plots.map((option) => (
              <NativeSelectOption value={option.id} key={option.id}>
                {option.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      <dl className="grid gap-3">
        {facts.map(([label, value]) => (
          <div
            className="grid gap-1 border-b pb-3 last:border-b-0 last:pb-0"
            key={label}
          >
            <dt className="text-sm leading-normal text-muted-foreground">
              {label}
            </dt>
            <dd className="tabular-nums wrap-anywhere">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-2 border-t pt-4">
        <h3>Farm</h3>
        <p>{data.farm.name}</p>
        <p className="text-sm leading-normal text-muted-foreground">
          {data.farm.province}
          {data.farm.locality ? ` · ${data.farm.locality}` : ""}
        </p>
        {data.farm.dataMode === "demo" && (
          <Badge variant="info">Demonstration weather and risk data</Badge>
        )}
      </div>
      <div className="space-y-2 border-t pt-4">
        <h3>Monitoring</h3>
        <p>{monitoring}</p>
        <p className="text-sm leading-normal text-muted-foreground tabular-nums">
          Last successful update: {formatInstant(data.monitoring.lastSuccessAt)}
          <br />
          Córdoba time (UTC−3)
        </p>
      </div>
      <Button variant="outline" onClick={() => onAddPlot(data.farm)}>
        Add plot
      </Button>
    </section>
  );
}

function monitoringLabel(status: DashboardResponse["monitoring"]["status"]) {
  if (status === "never_refreshed") return "Weather has not been evaluated.";
  if (status === "fresh") return "Monitoring was fresh at the last update.";
  if (status === "stale") return "Monitoring data is stale.";
  return "The last monitoring refresh failed.";
}
