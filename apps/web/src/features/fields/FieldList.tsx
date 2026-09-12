import {
  cropLabels,
  type DashboardResponse,
  type Plot,
} from "@agrosense/contracts";
import { Button, DataState, StatusLabel } from "../../components/ui";
import { formatInstant, plotStatus } from "./presentation";

export function FieldList({
  data,
  now,
  plots,
  selectedId,
  onSelect,
  onClear,
}: {
  data: DashboardResponse;
  now: number;
  plots: Plot[];
  selectedId: string | null;
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
          <Button onClick={onClear}>Clear filters</Button>
        </DataState>
      ) : (
        <ul className="field-list">
          {plots.map((plot) => {
            const status = plotStatus(data, plot.id, now);
            return (
              <li
                key={plot.id}
                className={
                  plot.id === selectedId
                    ? "field-list__item is-selected"
                    : "field-list__item"
                }
              >
                <h3>{plot.name}</h3>
                <p className="metadata">
                  {plot.activeCropCycle
                    ? `${cropLabels[plot.activeCropCycle.cropCode]} · ${plot.activeCropCycle.stageCode ?? "Stage unavailable"}`
                    : "Crop and stage unavailable"}{" "}
                  · {plot.declaredAreaHa} ha declared
                </p>
                <StatusLabel tone={status.tone}>{status.label}</StatusLabel>
                <p>{status.reason}</p>
                <p className="metadata">
                  Evaluation: {formatInstant(status.time)}
                </p>
                <Button
                  id={`view-field-${plot.id}`}
                  onClick={() => onSelect(plot.id)}
                  aria-pressed={plot.id === selectedId}
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
