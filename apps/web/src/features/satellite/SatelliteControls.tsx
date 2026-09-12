import {
  type SatellitePreview,
  type SatelliteRequest,
  satelliteRequestSchema,
} from "@agrosense/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { formatInstant } from "../fields/presentation";
import type { FarmDataSource } from "../fields/queries";

export function SatelliteControls({
  source,
  onImage,
}: {
  source: FarmDataSource;
  onImage: (data: SatellitePreview | undefined) => void;
}) {
  const id = useId();
  const [initialWindow] = useState(() => defaultSatelliteWindow());
  const [from, setFrom] = useState(() => initialWindow.from.slice(0, 10));
  const [to, setTo] = useState(() => initialWindow.to.slice(0, 10));
  const [requested, setRequested] = useState<SatelliteRequest | null>(
    initialWindow,
  );
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["satellite", source.scope, source.farmId, requested],
    queryFn: ({ signal }) => {
      if (!requested) throw new Error("Choose a satellite date window first.");
      return source.loadSatellite(requested, signal);
    },
    enabled: !!requested,
    retry: false,
    staleTime: 3600000,
    gcTime: 60000,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    onImage(query.data);
  }, [query.data, onImage]);
  return (
    <div className="space-y-3 border-t pt-4">
      <h3>Sentinel-2 · True color</h3>
      <p className="text-sm leading-normal text-muted-foreground tabular-nums">
        Dated imagery of the farm. Clouds may obscure the land; image color does
        not indicate crop risk.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (query.isFetching) return;
          const result = satelliteRequestSchema.safeParse({
            from: `${from}T00:00:00Z`,
            to: `${to}T23:59:59Z`,
          });
          if (!result.success || Date.parse(result.data.to) > Date.now()) {
            setError("Choose a past date window of at most 31 days.");
            return;
          }
          setError("");
          if (
            requested?.from === result.data.from &&
            requested.to === result.data.to
          )
            void query.refetch();
          else setRequested(result.data);
        }}
        className="flex flex-col items-stretch gap-3 md:flex-row md:flex-wrap md:items-end"
      >
        <label
          className="flex flex-col gap-2 font-semibold md:flex-[1_1_9rem]"
          htmlFor={`${id}-from`}
        >
          From (UTC)
          <Input
            id={`${id}-from`}
            type="date"
            value={from}
            required
            aria-invalid={!!error || undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setRequested(null);
            }}
          />
        </label>
        <label
          className="flex flex-col gap-2 font-semibold md:flex-[1_1_9rem]"
          htmlFor={`${id}-to`}
        >
          To (UTC)
          <Input
            id={`${id}-to`}
            type="date"
            value={to}
            required
            aria-invalid={!!error || undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setRequested(null);
            }}
          />
        </label>
        <Button
          variant="default"
          type="submit"
          disabled={query.isFetching}
          aria-busy={query.isFetching || undefined}
        >
          {query.isFetching ? "Loading imagery…" : "Load imagery"}
        </Button>
      </form>
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      {query.isError && (
        <p role="alert">
          Satellite imagery could not be loaded. Use Load imagery to retry.
        </p>
      )}
      {query.data?.status === "unavailable" && (
        <p role="status">{query.data.message}</p>
      )}
      {query.data?.status === "available" && (
        <>
          <Badge variant="info">
            Acquired {formatInstant(query.data.acquiredAt)} (UTC−3)
          </Badge>
          <p className="text-sm leading-normal text-muted-foreground tabular-nums">
            {query.data.source} · Scene cloud cover:{" "}
            {query.data.cloudCoverPercent === null
              ? "Unavailable"
              : `${query.data.cloudCoverPercent}%`}{" "}
            · Nominal source resolution: {query.data.sourceResolutionM} m;
            display resampled.
            <br />
            {query.data.attribution}
          </p>
        </>
      )}
    </div>
  );
}

export function defaultSatelliteWindow(now = new Date()): SatelliteRequest {
  const day = 86_400_000;
  const from = new Date(now.getTime() - 30 * day).toISOString().slice(0, 10);
  const to = new Date(now.getTime() - day).toISOString().slice(0, 10);
  return {
    from: `${from}T00:00:00Z`,
    to: `${to}T23:59:59Z`,
  };
}
