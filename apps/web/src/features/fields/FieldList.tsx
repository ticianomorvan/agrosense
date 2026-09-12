import {
  cropLabels,
  type DashboardResponse,
  type Plot,
} from "@agrosense/contracts";
import { DataState } from "../../components/data-state";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { assessmentSource, formatInstant, plotStatus } from "./presentation";

export function FieldList({
  data,
  now,
  plots,
  onSelect,
  onClear,
}: {
  data: DashboardResponse;
  now: number;
  plots: Plot[];
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <>
      <h2>Field priorities</h2>
      <p className="metadata">
        Review the reason before deciding what to do next.
      </p>
      {data.plots.length === 0 ? (
        <DataState title="No fields available">
          No field information has been supplied for this farm.
        </DataState>
      ) : plots.length === 0 ? (
        <DataState title="No fields match this filter">
          <Button variant="outline" onClick={onClear}>
            Clear filters
          </Button>
        </DataState>
      ) : (
        <ul className="field-list">
          {plots.map((plot) => {
            const status = plotStatus(data, plot.id, now);
            return (
              <li key={plot.id} className="field-list__item">
                <h3>{plot.name}</h3>
                <Badge variant={status.badgeVariant}>{status.label}</Badge>
                <p>{status.reason}</p>
                <p className="metadata">
                  {plot.activeCropCycle
                    ? `${cropLabels[plot.activeCropCycle.cropCode]} · ${plot.activeCropCycle.stageCode ?? "Stage unavailable"}`
                    : "Crop and stage unavailable"}{" "}
                  · {plot.declaredAreaHa} ha declared
                </p>
                <p className="metadata">
                  Evaluation: {formatInstant(status.time)} · Córdoba time
                  (UTC−3)
                  <br />
                  Source: {assessmentSource(status)}
                </p>
                <Button
                  variant="outline"
                  id={`view-field-${plot.id}`}
                  onClick={() => onSelect(plot.id)}
                  aria-label={`View field: ${plot.name}`}
                >
                  View field
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
