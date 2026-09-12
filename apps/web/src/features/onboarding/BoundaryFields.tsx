import { useId } from "react";
import { Input } from "../../components/ui/input";
import type { CoordinateBounds } from "./geometry";

export type BoundaryFieldPrefix = "farm" | "plot";

export function BoundaryFields({
  prefix,
  errorId,
  invalid = false,
  values,
  onChange,
  disabled = false,
}: {
  prefix: BoundaryFieldPrefix;
  errorId?: string;
  invalid?: boolean;
  values?: CoordinateBounds;
  onChange?: (direction: keyof CoordinateBounds, value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ");
  return (
    <fieldset className="space-y-3" aria-describedby={describedBy}>
      <legend className="mb-2 font-semibold">Boundary coordinates</legend>
      <p id={hintId} className="text-sm leading-normal text-muted-foreground">
        Enter decimal degrees for a rectangular boundary. West and east are
        longitude; south and north are latitude.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["west", "West longitude", "-64.200000"],
            ["east", "East longitude", "-64.100000"],
            ["south", "South latitude", "-31.500000"],
            ["north", "North latitude", "-31.400000"],
          ] as const
        ).map(([direction, label, placeholder]) => (
          <label
            className="grid gap-2 font-semibold"
            htmlFor={`${id}-${direction}`}
            key={direction}
          >
            {label}
            <Input
              id={`${id}-${direction}`}
              name={`${prefix}${capitalize(direction)}`}
              type="number"
              step="any"
              placeholder={placeholder}
              required
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              disabled={disabled}
              value={values ? values[direction] : undefined}
              onChange={
                onChange
                  ? (event) => onChange(direction, event.target.value)
                  : undefined
              }
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function capitalize(value: string) {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
