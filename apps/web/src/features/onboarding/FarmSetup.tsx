import {
  type CreateFarmRequest,
  createFarmRequestSchema,
  type Farm,
} from "@agrosense/contracts";
import { type FormEvent, useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { BoundaryFields } from "./BoundaryFields";
import { boundaryValues } from "./form-values";
import { rectangleFromBounds } from "./geometry";

export function FarmSetup({
  createFarm,
  onCreated,
  onCancel,
}: {
  createFarm: (request: CreateFarmRequest) => Promise<Farm>;
  onCreated: (farm: Farm) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [boundaryInvalid, setBoundaryInvalid] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const rectangle = rectangleFromBounds(boundaryValues(form, "farm"));
    if (!rectangle.ok) {
      setBoundaryInvalid(true);
      setError(rectangle.message);
      return;
    }
    const result = createFarmRequestSchema.safeParse({
      name: form.get("name"),
      province: form.get("province"),
      locality: String(form.get("locality") ?? "").trim() || null,
      declaredAreaHa: Number(form.get("declaredAreaHa")),
      boundary: rectangle.boundary,
    });
    if (!result.success) {
      setBoundaryInvalid(false);
      setError("Check the farm details and declared area, then try again.");
      return;
    }
    setPending(true);
    setBoundaryInvalid(false);
    setError("");
    try {
      onCreated(await createFarm(result.data));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The farm could not be created. Please try again.",
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
          Setup · Farm
        </p>
        <h1>Add your farm</h1>
        <p className="text-muted-foreground">
          Start with the farm identity and its real boundary. You will add the
          first plot next.
        </p>
      </div>
      <form
        className="max-w-3xl space-y-6 rounded-xl border bg-card p-4"
        onSubmit={submit}
        aria-busy={pending}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 font-semibold" htmlFor={`${id}-name`}>
            Farm name
            <Input
              id={`${id}-name`}
              name="name"
              required
              maxLength={100}
              disabled={pending}
            />
          </label>
          <label
            className="grid gap-2 font-semibold"
            htmlFor={`${id}-province`}
          >
            Province
            <Input
              id={`${id}-province`}
              name="province"
              required
              maxLength={100}
              disabled={pending}
            />
          </label>
          <label
            className="grid gap-2 font-semibold"
            htmlFor={`${id}-locality`}
          >
            Locality <span className="font-normal">(optional)</span>
            <Input
              id={`${id}-locality`}
              name="locality"
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
              max="1000000"
              step="0.01"
              required
              disabled={pending}
            />
          </label>
        </div>
        <BoundaryFields
          prefix="farm"
          errorId={boundaryInvalid && error ? `${id}-error` : undefined}
          invalid={boundaryInvalid}
        />
        {error && (
          <p id={`${id}-error`} role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving farm…" : "Save farm and continue"}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={pending}
            >
              Cancel
            </Button>
          )}
        </div>
      </form>
    </main>
  );
}
