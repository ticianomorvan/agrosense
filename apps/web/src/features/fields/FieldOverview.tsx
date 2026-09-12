import type { CropCode, SatellitePreview } from "@agrosense/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Button,
  DataState,
  SelectField,
  StatusLabel,
} from "../../components/ui";
import { MapBoundary } from "../../components/ui/MapBoundary";
import { SatelliteControls } from "../satellite/SatelliteControls";
import { FieldDetails } from "./FieldDetails";
import { FieldList } from "./FieldList";
import { formatInstant } from "./presentation";
import { dashboardOptions, type FarmDataSource } from "./queries";

const FieldMap = lazy(() => import("./FieldMap"));
export function FieldOverview({ source }: { source: FarmDataSource }) {
  const query = useQuery(dashboardOptions(source));
  const [crop, setCrop] = useState<CropCode | "all" | "unknown">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phoneMap, setPhoneMap] = useState(false);
  const [satellite, setSatellite] = useState<SatellitePreview>();
  const details = useRef<HTMLElement>(null);
  const previousSelection = useRef<string | null>(null);
  const select = useCallback((id: string) => {
    setSelectedId(id);
    setPhoneMap(false);
  }, []);
  useEffect(() => {
    if (selectedId)
      details.current
        ?.querySelector<HTMLElement>("#field-detail-title")
        ?.focus();
    else if (previousSelection.current)
      document
        .getElementById(`view-field-${previousSelection.current}`)
        ?.focus();
    previousSelection.current = selectedId;
  }, [selectedId]);
  if (query.isPending)
    return (
      <main className="workspace">
        <h1>Your fields</h1>
        <DataState title="Loading your farm…" pending>
          Field information will appear here.
        </DataState>
      </main>
    );
  if (!query.data)
    return (
      <main className="workspace">
        <h1>Your fields</h1>
        <DataState
          title="Farm information unavailable"
          retry={() => void query.refetch()}
        >
          {query.error?.message ?? "Please try again."}
        </DataState>
      </main>
    );
  const data = query.data;
  const plots = data.plots.filter(
    (p) =>
      crop === "all" ||
      (crop === "unknown"
        ? !p.activeCropCycle
        : p.activeCropCycle?.cropCode === crop),
  );
  const selected = plots.find((p) => p.id === selectedId);
  return (
    <main className={`workspace ${phoneMap ? "workspace--map" : ""}`}>
      <div className="page-heading">
        <div>
          <p className="metadata">
            {data.farm.province}
            {data.farm.locality ? ` · ${data.farm.locality}` : ""}
          </p>
          <h1>{data.farm.name}</h1>
          <p>Understand your fields. Decide what needs attention.</p>
        </div>
        <SelectField
          label="Crop"
          value={crop}
          onChange={(e) => {
            setCrop(e.target.value as typeof crop);
            setSelectedId(null);
          }}
        >
          <option value="all">All crops</option>
          <option value="maize">Maize</option>
          <option value="soybean">Soybean</option>
          <option value="unknown">Crop unavailable</option>
        </SelectField>
      </div>
      <div className="workspace-status" role="status">
        {data.farm.dataMode === "demo" && (
          <StatusLabel tone="info">Demonstration data</StatusLabel>
        )}
        <span>
          {data.monitoring.status === "never_refreshed"
            ? "Weather has not been evaluated."
            : `Monitoring: ${data.monitoring.status.replaceAll("_", " ")}.`}{" "}
          Last successful update: {formatInstant(data.monitoring.lastSuccessAt)}
        </span>
        {query.isError && (
          <Button onClick={() => void query.refetch()}>Retry update</Button>
        )}
      </div>
      <div className="phone-view-switch">
        <Button onClick={() => setPhoneMap((v) => !v)} aria-pressed={phoneMap}>
          {phoneMap ? "Back to priorities" : "View farm map"}
        </Button>
      </div>
      <div className="overview-layout">
        <section className="map-panel panel" aria-label="Farm view">
          <h2>Farm view</h2>
          <MapBoundary>
            <Suspense
              fallback={<DataState title="Loading the farm map…" pending />}
            >
              <FieldMap
                data={data}
                plots={plots}
                selectedId={selectedId}
                onSelect={select}
                satellite={satellite}
              />
            </Suspense>
          </MapBoundary>
          <SatelliteControls
            key={`${source.scope}:${source.farmId}`}
            source={source}
            onImage={setSatellite}
          />
        </section>
        <section
          ref={details}
          className="priorities-panel panel"
          aria-label={selected ? "Field details" : "Field priorities"}
        >
          {selected ? (
            <FieldDetails
              data={data}
              plot={selected}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <FieldList
              data={data}
              plots={plots}
              selectedId={selectedId}
              onSelect={select}
              onClear={() => setCrop("all")}
            />
          )}
        </section>
      </div>
    </main>
  );
}
