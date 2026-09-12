import {
  type Polygon,
  pointInPolygon,
  polygonContainsPolygon,
} from "@agrosense/contracts";
import * as L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  boundsFromPoints,
  type CoordinateBounds,
  rectangleFromBounds,
} from "./geometry";

export const ESRI_WORLD_IMAGERY_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const ESRI_ATTRIBUTION =
  "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community";

export interface BoundaryMapDrawerProps {
  farmBoundary?: Polygon;
  farmName?: string;
  bounds?: CoordinateBounds;
  onBoundsChange?: (bounds: CoordinateBounds) => void;
  disabled?: boolean;
}

const CORDOBA_CENTER: [number, number] = [-31.42, -64.18];
const CORDOBA_DEFAULT_ZOOM = 12;

export function BoundaryMapDrawer({
  farmBoundary,
  farmName,
  bounds,
  onBoundsChange,
  disabled = false,
}: BoundaryMapDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawingLayerRef = useRef<L.LayerGroup | null>(null);
  const farmLayerRef = useRef<L.LayerGroup | null>(null);

  const [drawing, setDrawing] = useState<{
    points: Array<{ lat: number; lng: number }>;
    bounds: CoordinateBounds | undefined;
  }>({ points: [], bounds });
  // Manual coordinate edits replace the controlled bounds and retire old clicks.
  const points = drawing.bounds === bounds ? drawing.points : [];
  const [ready, setReady] = useState(false);
  const [restrictionError, setRestrictionError] = useState<string | null>(null);

  useEffect(() => {
    if (drawing.bounds !== bounds) setRestrictionError(null);
  }, [bounds, drawing.bounds]);

  // Initialize map and tile layer
  useEffect(() => {
    if (!containerRef.current) return;

    const mapInstance = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      minZoom: 5,
      maxZoom: 19,
      scrollWheelZoom: true,
    });
    mapRef.current = mapInstance;

    // Esri World Imagery satellite layer
    L.tileLayer(ESRI_WORLD_IMAGERY_URL, {
      minZoom: 5,
      maxZoom: 19,
      attribution: ESRI_ATTRIBUTION,
    }).addTo(mapInstance);

    // Dedicated layer groups
    farmLayerRef.current = L.layerGroup().addTo(mapInstance);
    drawingLayerRef.current = L.layerGroup().addTo(mapInstance);

    // Initial position
    if (farmBoundary) {
      const boundsLatLng = polygonToLatLngs(farmBoundary);
      const farmBounds = L.latLngBounds(boundsLatLng);
      mapInstance.fitBounds(farmBounds, {
        padding: [32, 32],
        animate: false,
      });
    } else {
      mapInstance.setView(CORDOBA_CENTER, CORDOBA_DEFAULT_ZOOM, {
        animate: false,
      });
    }

    const container = containerRef.current;
    const preventMenu = (e: MouseEvent) => e.preventDefault();
    container.addEventListener("contextmenu", preventMenu);

    const observer = new ResizeObserver(() => {
      mapInstance.invalidateSize({ animate: false });
    });
    observer.observe(container);

    setReady(true);

    return () => {
      container.removeEventListener("contextmenu", preventMenu);
      observer.disconnect();
      mapInstance.remove();
      mapRef.current = null;
      drawingLayerRef.current = null;
      farmLayerRef.current = null;
    };
  }, [farmBoundary]);

  // Handle farm boundary overlay
  useEffect(() => {
    if (!ready || !farmLayerRef.current) return;
    farmLayerRef.current.clearLayers();

    if (!farmBoundary) return;

    const latLngs = polygonToLatLngs(farmBoundary);
    // Outer casing for high contrast on satellite imagery
    L.polygon(latLngs, {
      color: themeColor("card"),
      weight: 4,
      fill: false,
      dashArray: "6 6",
      interactive: false,
    }).addTo(farmLayerRef.current);

    // Inner farm boundary stroke
    const innerFarm = L.polygon(latLngs, {
      color: themeColor("foreground"),
      weight: 2,
      fill: false,
      dashArray: "6 6",
      interactive: false,
    });
    if (farmName) {
      const label = document.createElement("span");
      label.textContent = `Farm: ${farmName}`;
      innerFarm.bindTooltip(label, {
        permanent: false,
        direction: "center",
        className: "map-field-label",
      });
    }
    innerFarm.addTo(farmLayerRef.current);
  }, [farmBoundary, farmName, ready]);

  // Handle map click and contextmenu (right-click)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || disabled) return;

    const handleAddPoint = (latlng: L.LatLng) => {
      if (farmBoundary) {
        const isInside = pointInPolygon(
          [latlng.lng, latlng.lat],
          farmBoundary.coordinates,
        );
        if (!isInside) {
          setRestrictionError("Corners must remain inside the farm boundary.");
          return;
        }
      }
      if (points.length >= 4) return;
      const next = [...points, { lat: latlng.lat, lng: latlng.lng }];
      const nextBounds =
        boundsFromPoints(next) ??
        (points.length === 0 ? emptyBounds() : bounds);
      if (next.length === 4 && nextBounds) {
        const rectangle = rectangleFromBounds(nextBounds);
        if (!rectangle.ok) {
          setRestrictionError(rectangle.message);
          return;
        }
        if (
          farmBoundary &&
          !polygonContainsPolygon(
            farmBoundary.coordinates,
            rectangle.boundary.coordinates,
          )
        ) {
          setRestrictionError(
            "Plot boundary must remain inside the farm boundary.",
          );
          return;
        }
      }
      setRestrictionError(null);
      setDrawing({ points: next, bounds: nextBounds });
      if (nextBounds && nextBounds !== bounds) onBoundsChange?.(nextBounds);
    };

    const onClick = (e: L.LeafletMouseEvent) => {
      handleAddPoint(e.latlng);
    };

    const onContextMenu = (e: L.LeafletMouseEvent) => {
      if (e.originalEvent) {
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
      }
      handleAddPoint(e.latlng);
    };

    map.on("click", onClick);
    map.on("contextmenu", onContextMenu);

    return () => {
      map.off("click", onClick);
      map.off("contextmenu", onContextMenu);
    };
  }, [ready, disabled, onBoundsChange, farmBoundary, points, bounds]);

  // Render points, polyline, and polygon
  useEffect(() => {
    if (!ready || !drawingLayerRef.current) return;
    const layer = drawingLayerRef.current;
    layer.clearLayers();

    if (points.length > 0) {
      // 1. Render numbered marker dots
      points.forEach((point, index) => {
        const marker = L.marker([point.lat, point.lng], {
          icon: createPointIcon(index + 1),
          interactive: false,
        });
        marker.addTo(layer);
      });

      const latLngs = points.map((p) => [p.lat, p.lng] as [number, number]);

      if (points.length >= 2 && points.length < 4) {
        // Connecting polyline
        L.polyline(latLngs, {
          color: themeColor("card"),
          weight: 4,
          interactive: false,
        }).addTo(layer);
        L.polyline(latLngs, {
          color: themeColor("primary"),
          weight: 2,
          interactive: false,
        }).addTo(layer);
      }
    }
    if (bounds) {
      // Preview the same canonical rectangle submitted by both setup forms.
      const rect = rectangleFromBounds(bounds);
      if (rect.ok) {
        const ring = rect.boundary.coordinates[0] ?? [];
        const rectLatLngs = ring.map(
          ([lng, lat]) => [lat, lng] as [number, number],
        );
        L.polygon(rectLatLngs, {
          color: themeColor("card"),
          weight: 4,
          fill: false,
          interactive: false,
        }).addTo(layer);
        L.polygon(rectLatLngs, {
          color: themeColor("primary"),
          weight: 2,
          fillColor: themeColor("primary"),
          fillOpacity: 0.2,
          interactive: false,
        }).addTo(layer);
      }
    }
  }, [points, bounds, ready]);

  const handleClear = () => {
    setRestrictionError(null);
    const cleared = emptyBounds();
    setDrawing({ points: [], bounds: cleared });
    onBoundsChange?.(cleared);
  };

  const handleUndo = () => {
    setRestrictionError(null);
    const cleared = emptyBounds();
    setDrawing({ points: points.slice(0, -1), bounds: cleared });
    onBoundsChange?.(cleared);
  };

  const handleFitOrCenter = () => {
    const map = mapRef.current;
    if (!map) return;
    if (farmBoundary) {
      const latLngs = polygonToLatLngs(farmBoundary);
      map.fitBounds(L.latLngBounds(latLngs), {
        padding: [32, 32],
        animate: false,
      });
    } else {
      map.setView(CORDOBA_CENTER, CORDOBA_DEFAULT_ZOOM, { animate: false });
    }
  };

  const getStatusText = () => {
    switch (points.length) {
      case 0:
        return bounds && rectangleFromBounds(bounds).ok
          ? "Preview matches the manual boundary coordinates."
          : "Click or right-click on the map to place point 1.";
      case 1:
        return "Place point 2.";
      case 2:
        return "Place point 3.";
      case 3:
        return "Place point 4 to complete the rectangular boundary.";
      case 4:
        return "Rectangle complete. Preview and form coordinates match.";
      default:
        return "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              mapRef.current?.zoomIn(undefined, { animate: false })
            }
            disabled={disabled}
          >
            Zoom in
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              mapRef.current?.zoomOut(undefined, { animate: false })
            }
            disabled={disabled}
          >
            Zoom out
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleFitOrCenter}
            disabled={disabled}
          >
            {farmBoundary ? "Fit farm" : "Reset view"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleUndo}
            disabled={disabled || points.length === 0}
          >
            Undo point
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleClear}
            disabled={disabled || (points.length === 0 && !bounds?.west)}
          >
            Clear points
          </Button>
        </div>
        <div className="text-sm font-semibold text-foreground tabular-nums">
          Points: {points.length} / 4
        </div>
      </div>

      <section
        ref={containerRef}
        className="field-map relative z-0 h-80 min-h-72 w-full rounded-lg border border-input bg-muted font-sans md:h-96"
        aria-label="Satellite boundary map. Click or right-click to place 4 points for a rectangular boundary. Manual coordinate inputs are below."
      />

      {restrictionError && (
        <p className="text-sm font-semibold text-destructive" role="alert">
          {restrictionError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-medium text-foreground" role="status">
          {getStatusText()}
        </p>
        <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
          {farmBoundary && (
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block size-3.5 border border-dashed border-foreground bg-card"
                aria-hidden="true"
              />
              Farm outline
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block size-3.5 border-2 border-primary bg-primary/20"
              aria-hidden="true"
            />
            Drawn boundary
          </span>
          <span>Satellite: Esri World Imagery</span>
        </div>
      </div>
    </div>
  );
}

function createPointIcon(index: number): L.DivIcon {
  const marker = document.createElement("span");
  marker.className =
    "flex size-7 items-center justify-center rounded-full border-2 border-card bg-primary text-sm font-semibold text-primary-foreground";
  marker.textContent = String(index);
  return L.divIcon({
    className: "boundary-point-marker",
    html: marker,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function emptyBounds(): CoordinateBounds {
  return { west: "", east: "", south: "", north: "" };
}

function themeColor(name: "card" | "foreground" | "primary") {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--${name}`)
    .trim();
}

function polygonToLatLngs(polygon: Polygon): [number, number][] {
  const ring = polygon.coordinates[0] ?? [];
  return ring.map(([lng, lat]) => [lat, lng]);
}
