import type {
  DashboardResponse,
  Plot,
  SatellitePreview,
} from "@agrosense/contracts";
import * as L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import "leaflet/dist/leaflet.css";

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
  const farmBounds = L.geoJSON(data.farm.boundary).getBounds();

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
    instance.fitBounds(L.geoJSON(data.farm.boundary).getBounds(), {
      padding: [24, 24],
      animate: false,
    });
    const observer = new ResizeObserver(() => {
      instance.invalidateSize({ animate: false });
      if (container.current?.clientWidth)
        instance.fitBounds(L.geoJSON(data.farm.boundary).getBounds(), {
          padding: [24, 24],
          animate: false,
        });
    });
    observer.observe(container.current);
    setReady(true);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
  }, [data.farm.boundary]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const group = L.layerGroup().addTo(map.current);
    const token = (name: string) =>
      getComputedStyle(document.documentElement)
        .getPropertyValue(`--color-${name}`)
        .trim();
    L.geoJSON(data.farm.boundary, {
      interactive: false,
      style: { color: token("text"), weight: 2, fill: false, dashArray: "6 6" },
    }).addTo(group);
    for (const plot of plots) {
      const selected = plot.id === selectedId;
      L.geoJSON(plot.boundary, {
        interactive: false,
        style: { color: token("surface"), weight: 4, fill: false },
      }).addTo(group);
      const shape = L.geoJSON(plot.boundary, {
        style: {
          color: token(selected ? "brand" : "control-border"),
          weight: 2,
          fillColor: token("subtle"),
          fillOpacity: selected ? 0.4 : 0.15,
        },
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
      <div className="map-toolbar">
        <Button
          onClick={() => map.current?.zoomIn(undefined, { animate: false })}
        >
          Zoom in
        </Button>
        <Button
          onClick={() => map.current?.zoomOut(undefined, { animate: false })}
        >
          Zoom out
        </Button>
        <Button
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
        className="field-map"
        aria-label="Farm map. Use arrow keys to pan; select fields in the field list."
      />
      <div className="map-legend">
        <span className="legend-boundary" aria-hidden="true" /> Field boundary{" "}
        <span className="legend-selected" aria-hidden="true" /> Selected field
      </div>
      <p className="metadata">
        Declared field boundaries.{" "}
        {satellite?.status === "available" && !imageError
          ? "True color · Missing pixels are transparent."
          : "Imagery unavailable · Field outlines remain visible."}
      </p>
      {imageError && (
        <p role="status">
          The satellite image could not be displayed. Reload imagery to retry.
        </p>
      )}
    </>
  );
}
