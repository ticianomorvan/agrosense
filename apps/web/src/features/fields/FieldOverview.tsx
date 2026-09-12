import type { CropCode, SatellitePreview } from "@agrosense/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { DataState } from "../../components/data-state";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import { SatelliteControls } from "../satellite/SatelliteControls";
import { useRiskClock } from "./clock";
import { FieldDetails } from "./FieldDetails";
import { FieldList } from "./FieldList";
import { formatInstant } from "./presentation";
import { dashboardOptions, type FarmDataSource } from "./queries";

const FieldMap = lazy(() => import("./FieldMap"));
export function FieldOverview({ source }: { source: FarmDataSource }) {
  const cropId = useId();
  const query = useQuery(dashboardOptions(source));
  const now = useRiskClock(query.data);
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
        <div className="select-field">
          <label htmlFor={cropId}>Crop</label>
          <NativeSelect
            id={cropId}
            className="w-full [&_select]:min-h-11"
            value={crop}
            onChange={(e) => {
              setCrop(e.target.value as typeof crop);
              setSelectedId(null);
            }}
          >
            <NativeSelectOption value="all">All crops</NativeSelectOption>
            <NativeSelectOption value="maize">Maize</NativeSelectOption>
            <NativeSelectOption value="soybean">Soybean</NativeSelectOption>
            <NativeSelectOption value="unknown">
              Crop unavailable
            </NativeSelectOption>
          </NativeSelect>
        </div>
      </div>
      <div className="workspace-status" role="status">
        {data.farm.dataMode === "demo" && (
          <Badge
            variant="secondary"
            className="h-auto whitespace-normal text-sm"
          >
            Demonstration weather and risk data
          </Badge>
        )}
        <span>
          {data.monitoring.status === "never_refreshed"
            ? "Weather has not been evaluated."
            : `Monitoring at last update: ${data.monitoring.status.replaceAll("_", " ")}.`}{" "}
          Last successful update: {formatInstant(data.monitoring.lastSuccessAt)}
        </span>
        {query.isError && (
          <Button
            variant="outline"
            className="min-h-11 min-w-11"
            onClick={() => void query.refetch()}
          >
            Retry update
          </Button>
        )}
      </div>
      <div className="phone-view-switch">
        <Button
          variant="outline"
          className="min-h-11 min-w-11"
          onClick={() => setPhoneMap((v) => !v)}
        >
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
              now={now}
              plot={selected}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <FieldList
              data={data}
              now={now}
              plots={plots}
              onSelect={select}
              onClear={() => setCrop("all")}
            />
          )}
        </section>
      </div>
    </main>
  );
}

class MapBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <DataState title="Map unavailable">
        Use the field list to review your fields. Reload the page to try loading
        the map again.
      </DataState>
    ) : (
      this.props.children
    );
  }
}
