import type {
  DashboardResponse,
  Plot,
  Polygon,
  SatellitePreview,
} from "@agrosense/contracts";
import * as L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";

export default function FieldMap({
  data,
  plots,
  selectedId,
  onSelect,
  satellite,
}: {
  data: DashboardResponse;
  plots: Plot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  satellite?: SatellitePreview;
}) {
  const container = useRef<HTMLElement>(null);
  const map = useRef<L.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [imageError, setImageError] = useState(false);
  const farmBounds = useMemo(
    () => polygonLayer(data.farm.boundary).getBounds(),
    [data.farm.boundary],
  );

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, {
      zoomControl: false,
      attributionControl: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      minZoom: 5,
      maxZoom: 19,
      scrollWheelZoom: false,
    });
    map.current = instance;
    instance.fitBounds(farmBounds, {
      padding: [24, 24],
      animate: false,
    });
    const observer = new ResizeObserver(() => {
      if (!container.current?.clientWidth) return;
      instance.invalidateSize({ animate: false });
      instance.fitBounds(farmBounds, {
        padding: [24, 24],
        animate: false,
      });
      // Labels created while the phone map was hidden need visible dimensions.
      instance.eachLayer((layer) => layer.getTooltip()?.update());
    });
    observer.observe(container.current);
    setReady(true);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
  }, [farmBounds]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const group = L.layerGroup().addTo(map.current);
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(`--${name}`).trim();
    polygonLayer(data.farm.boundary, {
      interactive: false,
      color: token("foreground"),
      weight: 2,
      fill: false,
      dashArray: "6 6",
    }).addTo(group);
    for (const plot of plots) {
      const selected = plot.id === selectedId;
      polygonLayer(plot.boundary, {
        interactive: false,
        color: token("card"),
        weight: 4,
        fill: false,
      }).addTo(group);
      const shape = polygonLayer(plot.boundary, {
        color: token(selected ? "primary" : "muted-foreground"),
        weight: 2,
        fillColor: token("muted"),
        fillOpacity: selected ? 0.4 : 0.15,
      });
      const label = document.createElement("span");
      label.textContent = `${plot.name}${selected ? " · Selected" : ""}`;
      shape.bindTooltip(label, {
        permanent: true,
        opacity: 1,
        direction: "center",
        className: "map-field-label",
      });
      shape.on("click", () => onSelect(plot.id));
      shape.addTo(group);
    }
    return () => {
      group.remove();
    };
  }, [data.farm.boundary, plots, selectedId, onSelect, ready]);

  useEffect(() => {
    if (!ready || !map.current) return;
    setImageError(false);
    if (satellite?.status !== "available") return;
    const [w, s, e, n] = satellite.bounds;
    const image = L.imageOverlay(
      `data:image/png;base64,${satellite.imageBase64}`,
      [
        [s, w],
        [n, e],
      ],
      { pane: "tilePane", interactive: false },
    );
    image.on("error", () => setImageError(true));
    image.addTo(map.current);
    return () => {
      image.remove();
    };
  }, [satellite, ready]);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => map.current?.zoomIn(undefined, { animate: false })}
        >
          Zoom in
        </Button>
        <Button
          variant="outline"
          onClick={() => map.current?.zoomOut(undefined, { animate: false })}
        >
          Zoom out
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            map.current?.fitBounds(farmBounds, {
              padding: [24, 24],
              animate: false,
            })
          }
        >
          Fit farm
        </Button>
      </div>
      <section
        ref={container}
        className="field-map relative z-0 h-96 min-h-80 rounded-lg border border-muted-foreground bg-muted font-sans md:h-144 md:min-h-120"
        aria-label="Farm map. Use arrow keys to pan; select plots with the plot selector."
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className="inline-block size-4 border-2 border-muted-foreground bg-card"
          aria-hidden="true"
        />{" "}
        Plot boundary{" "}
        <span
          className="inline-block size-4 border-2 border-primary bg-muted"
          aria-hidden="true"
        />{" "}
        Selected plot
      </div>
      <p className="text-sm leading-normal text-muted-foreground tabular-nums">
        Plot boundaries · Boundary source and observation time unavailable.{" "}
        {satellite?.status === "available" && !imageError
          ? "True color · Missing pixels are transparent."
          : "Imagery unavailable · Plot outlines remain visible."}
      </p>
      {imageError && (
        <p role="status">
          The satellite image could not be displayed. Reload imagery to retry.
        </p>
      )}
    </>
  );
}

function polygonLayer(boundary: Polygon, options?: L.PolylineOptions) {
  return L.polygon(
    boundary.coordinates.map((ring) =>
      ring.map(([longitude, latitude]) => L.latLng(latitude, longitude)),
    ),
    options,
  );
}
