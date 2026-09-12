import type { Farm, SatellitePreview } from "@agrosense/contracts";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react";
import { DataState } from "../../components/data-state";
import { Button } from "../../components/ui/button";
import { EventTimeline } from "../events/EventTimeline";
import { SatelliteControls } from "../satellite/SatelliteControls";
import { PlotFacts } from "./PlotFacts";
import { dashboardOptions, type FarmDataSource } from "./queries";

const FieldMap = lazy(() => import("./FieldMap"));

export function FieldOverview({
  source,
  toolbar,
  onAddPlot,
}: {
  source: FarmDataSource;
  toolbar?: ReactNode;
  onAddPlot: (farm: Farm) => void;
}) {
  const query = useQuery(dashboardOptions(source));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phoneMap, setPhoneMap] = useState(false);
  const [satellite, setSatellite] = useState<SatellitePreview>();
  const select = useCallback((id: string) => {
    setSelectedId(id);
    setPhoneMap(false);
  }, []);

  useEffect(() => {
    const plots = query.data?.plots ?? [];
    if (plots.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !plots.some(({ id }) => id === selectedId))
      setSelectedId(plots[0]?.id ?? null);
  }, [query.data, selectedId]);

  if (query.isPending)
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto grid max-w-[1600px] gap-4 p-4 md:gap-6 md:p-6"
      >
        <OverviewHeader toolbar={toolbar} />
        <DataState title="Loading your farm…" pending>
          Plot, imagery, and event information will appear here.
        </DataState>
      </main>
    );
  if (!query.data)
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto grid max-w-[1600px] gap-4 p-4 md:gap-6 md:p-6"
      >
        <OverviewHeader toolbar={toolbar} />
        <DataState
          title="Farm information unavailable"
          retry={() => void query.refetch()}
          pending={query.isFetching}
        >
          {query.error?.message ?? "Please try again."}
        </DataState>
      </main>
    );

  const data = query.data;
  const selected =
    data.plots.find(({ id }) => id === selectedId) ?? data.plots[0];
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto grid max-w-[1600px] gap-4 p-4 md:gap-6 md:p-6"
    >
      <OverviewHeader data={data} toolbar={toolbar} />
      {query.isError && (
        <div className="flex flex-wrap items-center gap-3" role="status">
          <p>
            Farm information could not be updated. Showing the last available
            data.
          </p>
          <Button
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? "Retrying update…" : "Retry update"}
          </Button>
        </div>
      )}
      {!selected ? (
        <section className="rounded-xl border bg-card p-4">
          <DataState title="No plots have been added">
            <div className="space-y-4">
              <p>
                Add the first real plot boundary and crop context to open the
                dashboard.
              </p>
              <Button onClick={() => onAddPlot(data.farm)}>
                Add your first plot
              </Button>
            </div>
          </DataState>
        </section>
      ) : (
        <>
          <div className="md:hidden">
            <Button
              variant="outline"
              onClick={() => setPhoneMap((current) => !current)}
            >
              {phoneMap ? "Back to plot overview" : "View satellite map"}
            </Button>
          </div>
          <div className="grid items-start gap-4 md:gap-6 lg:grid-cols-[15rem_minmax(0,1fr)_17rem] xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
            <div className={cn(phoneMap && "hidden md:block")}>
              <PlotFacts
                data={data}
                plot={selected}
                onSelect={select}
                onAddPlot={onAddPlot}
              />
            </div>
            <section
              className={cn(
                "min-w-0 space-y-4 rounded-xl border bg-card p-4",
                !phoneMap && "hidden md:block",
              )}
              aria-labelledby="satellite-map-title"
            >
              <div className="space-y-1">
                <h2 id="satellite-map-title">Sentinel-2 imagery</h2>
                <p className="text-sm leading-normal text-muted-foreground">
                  True-color context for the selected farm and plot.
                </p>
              </div>
              <MapBoundary>
                <Suspense
                  fallback={
                    <DataState
                      className="min-h-96 md:min-h-144"
                      title="Loading the farm map…"
                      pending
                    />
                  }
                >
                  <FieldMap
                    data={data}
                    plots={data.plots}
                    selectedId={selected.id}
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
            <div className={cn(phoneMap && "hidden md:block")}>
              <EventTimeline data={data} plotId={selected.id} />
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function OverviewHeader({
  data,
  toolbar,
}: {
  data?: { farm: Farm };
  toolbar?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="grid gap-2">
        {data ? (
          <p className="text-sm leading-normal text-muted-foreground">
            {data.farm.province}
            {data.farm.locality ? ` · ${data.farm.locality}` : ""}
          </p>
        ) : null}
        <h1>{data?.farm.name ?? "Your field workspace"}</h1>
        <p>Plot context, dated satellite imagery, and weather events.</p>
      </div>
      {toolbar}
    </div>
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
      <DataState className="min-h-96 md:min-h-144" title="Map unavailable">
        Use the plot selector to review each plot. Reload the page to try
        loading the map again.
      </DataState>
    ) : (
      this.props.children
    );
  }
}
