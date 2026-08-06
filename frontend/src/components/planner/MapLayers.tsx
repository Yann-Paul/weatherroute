import { useEffect, useId, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";
import { ChevronRight, Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMap } from "@/components/ui/map";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useT } from "@/i18n/useT";
import { fetchRoutePois } from "@/api/client";
import type {
  ForestGeoJson,
  GpxWeatherPoint,
  MapPoi,
  PoiCategory,
  RoutePlannerPoint,
  WindShelterSample,
} from "@/api/types";

// ─── base map styles ─────────────────────────────────────────────────────────

const TOPO_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    opentopomap: {
      type: "raster",
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 17,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    },
  },
  layers: [{ id: "opentopomap", type: "raster", source: "opentopomap" }],
};

// Stable object identity — the Map component compares styles by reference.
export const TOPO_STYLES = { light: TOPO_STYLE, dark: TOPO_STYLE };

export type BaseLayer = "standard" | "topo";

// Thematic groups for the layer menu; group and category order also defines
// the menu row order.
export const POI_GROUPS = [
  { id: "supplies", categories: ["water", "supermarket", "food", "bakery", "cafe"] },
  { id: "rest", categories: ["shelter", "picnic", "toilets", "shower", "camping"] },
  { id: "services", categories: ["fuel", "atm", "bike_repair", "bike_tube", "train"] },
  { id: "sights", categories: ["park", "beach", "attraction", "pass"] },
] as const satisfies readonly { id: string; categories: readonly PoiCategory[] }[];

export type PoiGroupId = (typeof POI_GROUPS)[number]["id"];

export const POI_CATEGORIES: readonly PoiCategory[] = POI_GROUPS.flatMap(
  (g) => g.categories
);

export type OverlayState = Record<PoiCategory, boolean> & {
  forest: boolean;
  wind: boolean;
};

export const NO_OVERLAYS: OverlayState = {
  ...(Object.fromEntries(POI_CATEGORIES.map((c) => [c, false])) as Record<PoiCategory, boolean>),
  forest: false,
  wind: false,
};

export const POI_COLORS: Record<PoiCategory, string> = {
  shelter: "#8b5cf6",
  picnic: "#f97316",
  water: "#0ea5e9",
  toilets: "#64748b",
  shower: "#06b6d4",
  fuel: "#ef4444",
  supermarket: "#eab308",
  food: "#ec4899",
  bakery: "#a16207",
  cafe: "#14b8a6",
  camping: "#84cc16",
  atm: "#10b981",
  bike_repair: "#3b82f6",
  bike_tube: "#1e40af",
  train: "#6366f1",
  park: "#22c55e",
  beach: "#fbbf24",
  attraction: "#d946ef",
  pass: "#78716c",
};

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Thin a polyline to at most maxPoints (keeps endpoints) — used to keep
 * request payloads for the corridor queries small. */
export function simplifyPoints(points: RoutePlannerPoint[], maxPoints = 60): RoutePlannerPoint[] {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => points[Math.round(i * step)]);
}

function emptyPoiMap(): Record<PoiCategory, MapPoi[]> {
  return POI_CATEGORIES.reduce((acc, c) => {
    acc[c] = [];
    return acc;
  }, {} as Record<PoiCategory, MapPoi[]>);
}

/**
 * Fetches only the POI categories currently enabled, incrementally — turning
 * on one more category fetches just that category instead of re-running one
 * giant all-categories Overpass query. Already-fetched categories are cached
 * until the route itself changes.
 *
 * Each category is fetched as its own independent API/Overpass call (never
 * bundled with other categories into one query), even when several
 * categories become "missing" at once (e.g. after a route edit with
 * multiple layers enabled) — a category's markers can then appear as soon
 * as its own request resolves instead of waiting on the slowest one in a
 * shared batch. Trade-off: outbound Overpass calls are serialized
 * server-side to respect the public instance's rate limit, so enabling N
 * categories at once takes roughly N times as long in total as the
 * previous single combined query did.
 */
export function usePoiOverlay(
  points: RoutePlannerPoint[],
  overlays: OverlayState
): { poisByCategory: Record<PoiCategory, MapPoi[]>; poisLoading: boolean } {
  const t = useT();
  const [poisByCategory, setPoisByCategory] = useState<Record<PoiCategory, MapPoi[]>>(emptyPoiMap);
  const [poisLoading, setPoisLoading] = useState(false);
  const loadedRef = useRef<Set<PoiCategory>>(new Set());
  const routeSigRef = useRef<string | null>(null);

  const enabledCategories = POI_CATEGORIES.filter((c) => overlays[c]);
  const enabledKey = enabledCategories.join(",");
  const routeSig = points.length > 1 ? JSON.stringify(simplifyPoints(points)) : null;

  useEffect(() => {
    if (!routeSig || enabledCategories.length === 0) return;

    if (routeSig !== routeSigRef.current) {
      routeSigRef.current = routeSig;
      loadedRef.current = new Set();
      setPoisByCategory(emptyPoiMap());
    }

    const missing = enabledCategories.filter((c) => !loadedRef.current.has(c));
    if (missing.length === 0) return;

    const controller = new AbortController();
    let cancelled = false;
    const handle = setTimeout(() => {
      const simplified = simplifyPoints(points);
      let inFlight = missing.length;
      setPoisLoading(true);
      for (const category of missing) {
        fetchRoutePois(simplified, [category], controller.signal)
          .then((result) => {
            if (cancelled) return;
            loadedRef.current.add(category);
            setPoisByCategory((prev) => ({ ...prev, [category]: result }));
          })
          .catch(() => {
            if (!cancelled) toast.error(t.routePlanner.layers.poiError);
          })
          .finally(() => {
            inFlight -= 1;
            if (!cancelled && inFlight === 0) setPoisLoading(false);
          });
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(handle);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSig, enabledKey]);

  return { poisByCategory, poisLoading };
}

// ─── wind exposure ───────────────────────────────────────────────────────────

export const WIND_COLORS = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#ef4444",
} as const;

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x =
    Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * Combine landcover shelter samples with the wind forecast into colored route
 * segments. Per segment: effective wind = wind speed × direction factor
 * (headwind worst, tailwind best) × shelter factor (forest/built-up damps
 * the wind). Consecutive segments of the same level are merged.
 */
export function buildWindSegments(
  samples: WindShelterSample[],
  weatherPoints: GpxWeatherPoint[]
): FeatureCollection<LineString, { color: string }> {
  const wps = weatherPoints
    .filter((p) => p.wspd != null && p.wdir != null)
    .sort((a, b) => a.km - b.km);
  const features: { coords: [number, number][]; color: string }[] = [];
  if (samples.length < 2 || wps.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }

  let wpIdx = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const midKm = (a.km + b.km) / 2;
    while (
      wpIdx < wps.length - 1 &&
      Math.abs(wps[wpIdx + 1].km - midKm) <= Math.abs(wps[wpIdx].km - midKm)
    ) {
      wpIdx++;
    }
    const wspd = wps[wpIdx].wspd as number;
    const wdir = wps[wpIdx].wdir as number;

    // wdir is the direction the wind comes FROM; rel = 0 → headwind,
    // rel = 180 → tailwind. Factor: headwind 1.0, crosswind 0.55, tailwind 0.1.
    const bearing = bearingDeg(a.lat, a.lon, b.lat, b.lon);
    const rel = Math.abs(((wdir - bearing + 540) % 360) - 180);
    const dirFactor = 0.55 + 0.45 * Math.cos((rel * Math.PI) / 180);
    const shelterFactor = a.sheltered && b.sheltered ? 0.25 : a.sheltered || b.sheltered ? 0.6 : 1;
    const effective = wspd * dirFactor * shelterFactor;

    const color =
      effective < 8 ? WIND_COLORS.low : effective < 16 ? WIND_COLORS.medium : WIND_COLORS.high;

    const last = features[features.length - 1];
    if (last && last.color === color) {
      last.coords.push([b.lon, b.lat]);
    } else {
      features.push({ coords: [[a.lon, a.lat], [b.lon, b.lat]], color });
    }
  }

  return {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      properties: { color: f.color },
      geometry: { type: "LineString", coordinates: f.coords },
    })),
  };
}

// ─── layers menu (floating map control) ──────────────────────────────────────

export function LayersMenu({
  base,
  onBaseChange,
  overlays,
  onToggleOverlay,
  routeReady,
  windReady,
  poisLoading,
  shelterLoading,
}: {
  base: BaseLayer;
  onBaseChange: (b: BaseLayer) => void;
  overlays: OverlayState;
  onToggleOverlay: (key: keyof OverlayState) => void;
  /** Overlays need a computed route — disabled until one exists. */
  routeReady: boolean;
  /** Wind exposure additionally needs weather data. */
  windReady: boolean;
  poisLoading: boolean;
  shelterLoading: boolean;
}) {
  const t = useT();
  const ly = t.routePlanner.layers;
  // Groups with an active overlay start expanded; the rest stay collapsed.
  const [openGroups, setOpenGroups] = useState<Record<PoiGroupId, boolean>>(
    () =>
      Object.fromEntries(
        POI_GROUPS.map((g) => [g.id, g.categories.some((c) => overlays[c])])
      ) as Record<PoiGroupId, boolean>
  );

  function baseButton(value: BaseLayer, label: string) {
    return (
      <button
        type="button"
        onClick={() => onBaseChange(value)}
        className={[
          "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
          base === value
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:text-foreground",
        ].join(" ")}
      >
        {label}
      </button>
    );
  }

  function overlayRow(
    key: keyof OverlayState,
    label: string,
    opts?: { dot?: string; disabled?: boolean; loading?: boolean }
  ) {
    const id = `layer-${key}`;
    return (
      <div key={key} className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={overlays[key]}
          disabled={opts?.disabled}
          onCheckedChange={() => onToggleOverlay(key)}
        />
        {opts?.dot && (
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: opts.dot }}
          />
        )}
        <label
          htmlFor={id}
          className={[
            "flex-1 cursor-pointer select-none text-xs",
            opts?.disabled ? "text-muted-foreground/60" : "",
          ].join(" ")}
        >
          {label}
        </label>
        {opts?.loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ly.button}
          className="flex h-10 w-10 items-center justify-center rounded-xl border bg-card/95 text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-muted"
        >
          <Layers className="h-5 w-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="max-h-[min(70vh,560px)] w-60 overflow-y-auto p-3"
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">{ly.baseHeading}</p>
            <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
              {baseButton("standard", ly.baseStandard)}
              {baseButton("topo", ly.baseTopo)}
            </div>
          </div>

          <div className="h-px bg-border" />

          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">{ly.overlaysHeading}</p>
            {POI_GROUPS.map((group) => {
              const activeCount = group.categories.filter((c) => overlays[c]).length;
              const open = openGroups[group.id];
              return (
                <div key={group.id} className="space-y-2">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenGroups((s) => ({ ...s, [group.id]: !s[group.id] }))
                    }
                    className="flex w-full items-center gap-1.5 text-xs font-medium transition-colors hover:text-foreground"
                  >
                    <ChevronRight
                      className={[
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        open ? "rotate-90" : "",
                      ].join(" ")}
                    />
                    <span className="flex-1 text-left">{ly.groups[group.id]}</span>
                    {!open && activeCount > 0 && poisLoading && (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                    {activeCount > 0 && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
                        {activeCount}
                      </span>
                    )}
                  </button>
                  {open && (
                    <div className="space-y-2 pl-5">
                      {group.categories.map((cat) =>
                        overlayRow(cat, ly[cat], {
                          dot: POI_COLORS[cat],
                          disabled: !routeReady,
                          loading: overlays[cat] && poisLoading,
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {overlayRow("forest", ly.forest, {
              dot: "#16a34a",
              disabled: !routeReady,
              loading: overlays.forest && shelterLoading,
            })}
            {overlayRow("wind", ly.wind, {
              disabled: !routeReady,
              loading: overlays.wind && (shelterLoading || !windReady),
            })}
            {!routeReady && (
              <p className="text-[11px] leading-snug text-muted-foreground">{ly.needRoute}</p>
            )}
            {routeReady && overlays.wind && !windReady && (
              <p className="text-[11px] leading-snug text-muted-foreground">{ly.windNeedsWeather}</p>
            )}
          </div>

          {overlays.wind && windReady && (
            <>
              <div className="h-px bg-border" />
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">{ly.windLegend}</p>
                {(
                  [
                    [WIND_COLORS.low, ly.windLegendLow],
                    [WIND_COLORS.medium, ly.windLegendMed],
                    [WIND_COLORS.high, ly.windLegendHigh],
                  ] as const
                ).map(([color, label]) => (
                  <div key={color} className="flex items-center gap-2">
                    <span
                      className="inline-block h-1 w-6 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs">{label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── map layer components (must live inside <Map>) ──────────────────────────

/** POI markers as a circle layer with a hover tooltip (name, category and
 * whitelisted OSM detail tags). Clicking a marker pins the popup open (it no
 * longer closes on mouseleave) so desktop users can reach the Google Maps
 * link inside it; it closes via its close button. On touch devices, which
 * have no hover, this is also simply how the popup opens. */
export function PoiLayer({
  pois,
  color,
  label,
}: {
  pois: MapPoi[];
  color: string;
  label: string;
}) {
  const { map, isLoaded } = useMap();
  const id = useId();
  const sourceId = `poi-source-${id}`;
  const layerId = `poi-layer-${id}`;
  const t = useT();
  // Read translations through a ref so the (once-registered) map handlers
  // always render with the current language.
  const uiRef = useRef({
    label,
    details: t.routePlanner.layers.poiDetails,
    googleMapsLabel: t.routePlanner.layers.openInGoogleMaps,
  });
  uiRef.current = {
    label,
    details: t.routePlanner.layers.poiDetails,
    googleMapsLabel: t.routePlanner.layers.openInGoogleMaps,
  };

  useEffect(() => {
    if (!map || !isLoaded) return;

    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: layerId,
      type: "circle",
      source: sourceId,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 3, 12, 6],
        "circle-color": color,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
        "circle-opacity": 0.9,
      },
    });

    // closeButton: touch has no hover to dismiss the popup with, so tapping
    // a POI needs an explicit way to close it again.
    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      offset: 10,
      maxWidth: "260px",
    });

    const buildContent = (
      feature: maplibregl.MapGeoJSONFeature,
      coords: [number, number]
    ) => {
      const { label: catLabel, details, googleMapsLabel } = uiRef.current;
      const props = feature.properties as {
        name?: string | null;
        subtype?: string | null;
        tags?: string | Record<string, string>;
      };
      // MapLibre serializes nested feature properties to JSON strings.
      let tags: Record<string, string> = {};
      if (typeof props.tags === "string") {
        try {
          tags = JSON.parse(props.tags);
        } catch {
          tags = {};
        }
      } else if (props.tags) {
        tags = props.tags;
      }

      // Build popup DOM manually — OSM names/tags are untrusted input.
      // The map strips maplibre's own popup background (globals.css), so
      // this needs its own opaque card background or the text is unreadable
      // against the map underneath it.
      const div = document.createElement("div");
      div.className = "rounded-md border bg-popover p-3 text-popover-foreground shadow-md";
      div.style.fontSize = "12px";
      div.style.lineHeight = "1.45";
      const title = document.createElement("p");
      title.style.fontWeight = "600";
      title.textContent = props.name || catLabel;
      div.appendChild(title);
      const subtype = tags.shelter_type ?? props.subtype ?? null;
      if (props.name || subtype) {
        const sub = document.createElement("p");
        sub.style.opacity = "0.7";
        sub.textContent = props.name
          ? subtype
            ? `${catLabel} · ${subtype}`
            : catLabel
          : String(subtype);
        div.appendChild(sub);
      }
      const detailKeys = Object.keys(tags).filter(
        (k) => k !== "shelter_type" && tags[k]
      );
      if (detailKeys.length > 0) {
        const list = document.createElement("div");
        list.style.marginTop = "6px";
        list.style.display = "grid";
        list.style.gap = "2px";
        for (const key of detailKeys) {
          const row = document.createElement("p");
          const keyLabel = details.labels[key as keyof typeof details.labels] ?? key;
          let value = tags[key];
          if (value === "yes") value = details.yes;
          else if (value === "no") value = details.no;
          const strong = document.createElement("span");
          strong.style.opacity = "0.7";
          strong.textContent = `${keyLabel}: `;
          row.appendChild(strong);
          row.appendChild(document.createTextNode(value));
          list.appendChild(row);
        }
        div.appendChild(list);
      }
      const [lon, lat] = coords;
      const link = document.createElement("a");
      link.href = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = googleMapsLabel;
      link.style.display = "block";
      link.style.marginTop = "8px";
      link.style.color = "var(--primary)";
      link.style.textDecoration = "underline";
      // popup lives outside the click-to-place-point map handlers, but stop
      // propagation anyway so a tap on the link can't also register as a
      // map click on touch devices.
      link.addEventListener("click", (ev) => ev.stopPropagation());
      div.appendChild(link);
      return div;
    };

    // set while a marker is pinned open via click — hover no longer moves
    // the popup around and mouseleave no longer closes it, so a desktop
    // user can actually reach the link inside (moving the cursor off the
    // small marker circle toward the popup would otherwise fire mouseleave
    // and close it before the click lands).
    let pinned = false;

    const showPopup = (
      e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }
    ) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const coords: [number, number] =
        feature.geometry.type === "Point"
          ? (feature.geometry.coordinates as [number, number])
          : [e.lngLat.lng, e.lngLat.lat];
      // Popup#addTo() closes-then-reopens (firing a "close" event) whenever
      // the popup is already open, so calling it unconditionally on every
      // hover/click made the "close" listener below immediately un-pin a
      // marker right after handleClick had just pinned it. Only call addTo
      // for the actual first open.
      popup.setLngLat(coords).setDOMContent(buildContent(feature, coords));
      if (!popup.isOpen()) popup.addTo(map);
    };

    const handleClick = (
      e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }
    ) => {
      pinned = true;
      showPopup(e);
    };
    const handleEnter = (
      e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }
    ) => {
      map.getCanvas().style.cursor = "pointer";
      if (!pinned) showPopup(e);
    };
    const handleHoverMove = (
      e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }
    ) => {
      if (!pinned) showPopup(e);
    };
    const handleLeave = () => {
      map.getCanvas().style.cursor = "";
      if (!pinned) popup.remove();
    };
    // Closing is via the popup's own close button only (not a click
    // elsewhere on the map) — RoutePlannerPage's ClickCapture treats every
    // map click that doesn't land on a POI marker as "place a route point
    // here", so an outside-click-to-dismiss handler here would also drop an
    // unwanted waypoint every time a user dismissed a pinned popup.
    popup.on("close", () => {
      pinned = false;
    });

    map.on("click", layerId, handleClick); // touch devices have no hover
    map.on("mouseenter", layerId, handleEnter);
    map.on("mousemove", layerId, handleHoverMove);
    map.on("mouseleave", layerId, handleLeave);

    return () => {
      map.off("click", layerId, handleClick);
      map.off("mouseenter", layerId, handleEnter);
      map.off("mousemove", layerId, handleHoverMove);
      map.off("mouseleave", layerId, handleLeave);
      popup.remove();
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // map may already be destroyed
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded]);

  useEffect(() => {
    if (!map || !isLoaded) return;
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: pois.map((p) => ({
        type: "Feature",
        properties: { name: p.name, subtype: p.subtype, tags: p.tags ?? {} },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      })),
    });
  }, [map, isLoaded, pois, sourceId]);

  useEffect(() => {
    if (!map || !isLoaded || !map.getLayer(layerId)) return;
    map.setPaintProperty(layerId, "circle-color", color);
  }, [map, isLoaded, layerId, color]);

  return null;
}

/** Semi-transparent forest polygons (from the wind-shelter corridor query). */
export function ForestLayer({ data }: { data: ForestGeoJson }) {
  const { map, isLoaded } = useMap();
  const id = useId();
  const sourceId = `forest-source-${id}`;
  const layerId = `forest-layer-${id}`;

  useEffect(() => {
    if (!map || !isLoaded) return;

    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    // Insert below any route line so the track stays fully visible.
    const routeLayerId = map.getStyle().layers?.find((l) => l.id.startsWith("route-layer-"))?.id;
    map.addLayer(
      {
        id: layerId,
        type: "fill",
        source: sourceId,
        paint: {
          "fill-color": "#16a34a",
          "fill-opacity": 0.2,
          "fill-outline-color": "#15803d",
        },
      },
      routeLayerId
    );

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // map may already be destroyed
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded]);

  useEffect(() => {
    if (!map || !isLoaded) return;
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(data as unknown as FeatureCollection);
  }, [map, isLoaded, data, sourceId]);

  return null;
}

/** Route colored by wind exposure, drawn on top of the plain route line. */
export function WindExposureLayer({
  samples,
  weatherPoints,
}: {
  samples: WindShelterSample[];
  weatherPoints: GpxWeatherPoint[];
}) {
  const { map, isLoaded } = useMap();
  const id = useId();
  const sourceId = `wind-source-${id}`;
  const layerId = `wind-layer-${id}`;

  useEffect(() => {
    if (!map || !isLoaded) return;

    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 5,
        "line-opacity": 0.9,
      },
    });

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // map may already be destroyed
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded]);

  useEffect(() => {
    if (!map || !isLoaded) return;
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(buildWindSegments(samples, weatherPoints));
  }, [map, isLoaded, samples, weatherPoints, sourceId]);

  return null;
}
