import {
  type CreatePlotRequest,
  type CreatePlotResponse,
  type CropCode,
  createPlotRequestSchema,
  cropLabels,
  cropStages,
  type Farm,
  polygonContainsPolygon,
} from "@agrosense/contracts";
import { type FormEvent, useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import { BoundaryFields } from "./BoundaryFields";
import { BoundaryMapDrawer } from "./BoundaryMapDrawer";
import { boundaryValues, farmExtent, todayInCordoba } from "./form-values";
import { type CoordinateBounds, rectangleFromBounds } from "./geometry";

export function PlotSetup({
  farm,
  createPlot,
  onCreated,
  onCancel,
}: {
  farm: Farm;
  createPlot: (request: CreatePlotRequest) => Promise<CreatePlotResponse>;
  onCreated: (response: CreatePlotResponse) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const today = todayInCordoba();
  const extent = farmExtent(farm);
  const [crop, setCrop] = useState<CropCode | "">("");
  const [stage, setStage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [boundaryInvalid, setBoundaryInvalid] = useState(false);
  const [manualCoordsOpen, setManualCoordsOpen] = useState(false);
  const [coordinates, setCoordinates] = useState<CoordinateBounds>({
    west: "",
    south: "",
    east: "",
    north: "",
  });
  const stages = crop ? cropStages[crop] : [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const rectangle = rectangleFromBounds(boundaryValues(form, "plot"));
    if (!rectangle.ok) {
      setBoundaryInvalid(true);
      setManualCoordsOpen(true);
      setError(rectangle.message);
      return;
    }
    if (
      !polygonContainsPolygon(
        farm.boundary.coordinates,
        rectangle.boundary.coordinates,
      )
    ) {
      setBoundaryInvalid(true);
      setManualCoordsOpen(true);
      setError("Plot boundary must remain inside the farm boundary.");
      return;
    }
    const stageAsOf = stage
      ? String(form.get("stageAsOf") ?? "") || null
      : null;
    const result = createPlotRequestSchema.safeParse({
      name: form.get("name"),
      declaredAreaHa: Number(form.get("declaredAreaHa")),
      boundary: rectangle.boundary,
      samplePoint: rectangle.samplePoint,
      cropCycle: {
        cropCode: crop,
        seasonLabel: form.get("seasonLabel"),
        sownOn: String(form.get("sownOn") ?? "") || null,
        stageCode: stage || null,
        stageAsOf,
      },
    });
    if (!result.success) {
      setBoundaryInvalid(false);
      setError(
        "Check the plot, crop season, and observation dates, then try again.",
      );
      return;
    }
    if (
      (result.data.cropCycle.sownOn && result.data.cropCycle.sownOn > today) ||
      (result.data.cropCycle.stageAsOf &&
        result.data.cropCycle.stageAsOf > today)
    ) {
      setBoundaryInvalid(false);
      setError("Sowing and stage observation dates cannot be in the future.");
      return;
    }
    setPending(true);
    setBoundaryInvalid(false);
    setError("");
    try {
      onCreated(await createPlot(result.data));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The plot could not be created. Please try again.",
      );
      setPending(false);
    }
  }

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto grid w-full max-w-[1600px] gap-6 p-4 md:p-6"
    >
      <div className="max-w-2xl space-y-2">
        <p className="text-sm leading-normal font-semibold text-primary">
          Setup · Plot
        </p>
        <h1>Add a plot to {farm.name}</h1>
        <p className="text-muted-foreground">
          Define one monitored plot and its current crop context. Crop dates are
          optional; unavailable values remain labeled as unavailable.
        </p>
      </div>
      <form
        className="max-w-3xl space-y-6 rounded-xl border bg-card p-4"
        onSubmit={submit}
        aria-busy={pending}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 font-semibold" htmlFor={`${id}-name`}>
            Plot name
            <Input
              id={`${id}-name`}
              name="name"
              required
              maxLength={100}
              disabled={pending}
            />
          </label>
          <label className="grid gap-2 font-semibold" htmlFor={`${id}-area`}>
            Declared area (ha)
            <Input
              id={`${id}-area`}
              name="declaredAreaHa"
              type="number"
              min="0.01"
              max={farm.declaredAreaHa}
              step="0.01"
              required
              disabled={pending}
            />
          </label>
          <label className="grid gap-2 font-semibold" htmlFor={`${id}-crop`}>
            Crop
            <NativeSelect
              id={`${id}-crop`}
              className="w-full"
              name="cropCode"
              value={crop}
              required
              disabled={pending}
              onChange={(event) => {
                setCrop(event.target.value as CropCode | "");
                setStage("");
              }}
            >
              <NativeSelectOption value="" disabled>
                Select a crop
              </NativeSelectOption>
              {(Object.entries(cropLabels) as [CropCode, string][]).map(
                ([value, label]) => (
                  <NativeSelectOption key={value} value={value}>
                    {label}
                  </NativeSelectOption>
                ),
              )}
            </NativeSelect>
          </label>
          <label className="grid gap-2 font-semibold" htmlFor={`${id}-season`}>
            Crop season
            <Input
              id={`${id}-season`}
              name="seasonLabel"
              required
              pattern="\d{4}/\d{2}"
              title="Use the format 2026/27"
              placeholder="2026/27"
              disabled={pending}
            />
          </label>
          <label className="grid gap-2 font-semibold" htmlFor={`${id}-sown`}>
            <span>
              Sowing date <span className="font-normal">(optional)</span>
            </span>
            <Input
              id={`${id}-sown`}
              name="sownOn"
              type="date"
              max={today}
              disabled={pending}
            />
          </label>
          <label className="grid gap-2 font-semibold" htmlFor={`${id}-stage`}>
            <span>
              Growth stage <span className="font-normal">(optional)</span>
            </span>
            <NativeSelect
              id={`${id}-stage`}
              className="w-full"
              name="stageCode"
              value={stage}
              disabled={!crop || pending}
              onChange={(event) => setStage(event.target.value)}
            >
              <NativeSelectOption value="">Not supplied</NativeSelectOption>
              {stages.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {value}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label
            className="grid gap-2 font-semibold"
            htmlFor={`${id}-stage-date`}
          >
            Stage observed
            <Input
              id={`${id}-stage-date`}
              name="stageAsOf"
              type="date"
              max={today}
              required={!!stage}
              disabled={!stage || pending}
            />
          </label>
        </div>
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">
              Plot boundary
            </h2>
            <p className="text-sm leading-normal text-muted-foreground">
              The farm outline is shown with a dashed line. Mark 4 corners on
              the map inside your farm by clicking or right-clicking.
            </p>
          </div>
          <BoundaryMapDrawer
            farmBoundary={farm.boundary}
            farmName={farm.name}
            bounds={coordinates}
            onBoundsChange={setCoordinates}
            disabled={pending}
          />
          <div className="space-y-1 text-sm leading-normal text-muted-foreground tabular-nums">
            <p>Plot bounds must remain inside the farm boundary.</p>
            <p>
              Farm extent reference — west {extent.west.toFixed(6)}, east{" "}
              {extent.east.toFixed(6)}, south {extent.south.toFixed(6)}, north{" "}
              {extent.north.toFixed(6)}.
            </p>
          </div>
          <details
            className="rounded-lg border border-border bg-card p-3"
            open={manualCoordsOpen || boundaryInvalid}
            onToggle={(e) => setManualCoordsOpen(e.currentTarget.open)}
          >
            <summary className="cursor-pointer font-semibold text-sm text-foreground flex items-center justify-between">
              <span>Manual coordinate inputs (synced)</span>
              <span className="text-xs text-muted-foreground font-normal">
                {coordinates.west
                  ? "Coordinates synced"
                  : "Click to view or edit"}
              </span>
            </summary>
            <div className="mt-3">
              <BoundaryFields
                prefix="plot"
                values={coordinates}
                onChange={(direction, value) =>
                  setCoordinates((prev) => ({ ...prev, [direction]: value }))
                }
                errorId={boundaryInvalid && error ? `${id}-error` : undefined}
                invalid={boundaryInvalid}
                disabled={pending}
              />
            </div>
          </details>
        </div>
        {error && (
          <p id={`${id}-error`} role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving plot…" : "Save plot and open dashboard"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      </form>
    </main>
  );
}
