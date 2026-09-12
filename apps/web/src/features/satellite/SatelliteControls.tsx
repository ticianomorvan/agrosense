import {
  type SatellitePreview,
  type SatelliteRequest,
  satelliteRequestSchema,
} from "@agrosense/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { Button, StatusLabel } from "../../components/ui";
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
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(() =>
    new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  );
  const [requested, setRequested] = useState<SatelliteRequest | null>(null);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["satellite", source.scope, source.farmId, requested],
    queryFn: ({ signal }) => {
      if (!source.loadSatellite || !requested)
        throw new Error("Satellite imagery is unavailable.");
      return source.loadSatellite(requested, signal);
    },
    enabled: !!requested && !!source.loadSatellite,
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
    <div className="satellite-controls">
      <h3>Sentinel-2 · True color</h3>
      <p className="metadata">
        Dated imagery of the farm. Clouds may obscure the land; image color does
        not indicate crop risk.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
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
        className="satellite-form"
      >
        <label htmlFor={`${id}-from`}>
          From (UTC)
          <input
            id={`${id}-from`}
            type="date"
            value={from}
            required
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setRequested(null);
            }}
          />
        </label>
        <label htmlFor={`${id}-to`}>
          To (UTC)
          <input
            id={`${id}-to`}
            type="date"
            value={to}
            required
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setRequested(null);
            }}
          />
        </label>
        <Button
          type="submit"
          disabled={!source.loadSatellite}
          pending={query.isFetching}
        >
          {query.isFetching ? "Loading imagery…" : "Load imagery"}
        </Button>
      </form>
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      {!source.loadSatellite && (
        <p className="metadata">
          Satellite imagery is unavailable for this farm.
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
          <StatusLabel tone="info">
            Acquired {formatInstant(query.data.acquiredAt)} (UTC−3)
          </StatusLabel>
          <p className="metadata">
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
