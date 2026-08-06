import { useEffect, useId, useMemo } from "react";
import maplibregl from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";
import { Loader2 } from "lucide-react";
import { useMap } from "@/components/ui/map";
import { useT } from "@/i18n/useT";
import type { RoadCategory, RoadInfoSample, SurfaceCategory } from "@/api/types";

export type RoadDimension = "surface" | "highway";

export const SURFACE_COLORS: Record<SurfaceCategory, string> = {
  paved: "#64748b",
  gravel: "#d97706",
  unpaved: "#a16207",
  unknown: "#94a3b8",
};

export const ROAD_COLORS: Record<RoadCategory, string> = {
  motorway: "#dc2626",
  primary: "#ea580c",
  secondary: "#f59e0b",
  tertiary: "#ca8a04",
  minor: "#65a30d",
  service: "#0891b2",
  track: "#7c3aed",
  path: "#db2777",
  other: "#64748b",
};

export function roadCategoryColor(dimension: RoadDimension, category: string): string {
  const colors: Record<string, string> = dimension === "surface" ? SURFACE_COLORS : ROAD_COLORS;
  return colors[category] ?? "#94a3b8";
}

const EMPTY_FC: FeatureCollection<LineString, { category: string }> = {
  type: "FeatureCollection",
  features: [],
};

/** Merge consecutive route samples of the same category into polylines —
 * same pattern as buildWindSegments in MapLayers.tsx. */
export function buildRoadSegments(
  samples: RoadInfoSample[],
  dimension: RoadDimension
): FeatureCollection<LineString, { category: string }> {
  if (samples.length < 2) return EMPTY_FC;
  const features: { coords: [number, number][]; category: string }[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const category = a[dimension];
    const last = features[features.length - 1];
    if (last && last.category === category) {
      last.coords.push([b.lon, b.lat]);
    } else {
      features.push({ coords: [[a.lon, a.lat], [b.lon, b.lat]], category });
    }
  }
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      properties: { category: f.category },
      geometry: { type: "LineString", coordinates: f.coords },
    })),
  };
}

export function aggregateRoadCategories(
  samples: RoadInfoSample[],
  dimension: RoadDimension
): { category: string; km: number; pct: number }[] {
  if (samples.length < 2) return [];
  const kmByCategory = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const delta = Math.max(0, samples[i + 1].km - samples[i].km);
    const category = samples[i][dimension];
    kmByCategory.set(category, (kmByCategory.get(category) ?? 0) + delta);
    total += delta;
  }
  if (total === 0) return [];
  return Array.from(kmByCategory.entries())
    .map(([category, km]) => ({ category, km, pct: (km / total) * 100 }))
    .sort((a, b) => b.km - a.km);
}

// ─── bar chart + legend ─────────────────────────────────────────────────────

export function RoadProfileBarChart({
  samples,
  dimension,
  selected,
  onSelect,
  loading,
}: {
  samples: RoadInfoSample[] | undefined;
  dimension: RoadDimension;
  selected: string | null;
  onSelect: (category: string | null) => void;
  loading: boolean;
}) {
  const t = useT();
  const rp = t.routePlanner;
  const labels: Record<string, string> =
    dimension === "surface" ? rp.surfaceCategories : rp.roadCategories;
  const colors: Record<string, string> = dimension === "surface" ? SURFACE_COLORS : ROAD_COLORS;

  const stats = useMemo(
    () => (samples ? aggregateRoadCategories(samples, dimension) : []),
    [samples, dimension]
  );

  function handleClick(category: string) {
    onSelect(selected === category ? null : category);
  }

  if (loading && !samples) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {rp.roadInfoLoading}
      </div>
    );
  }

  if (!samples || stats.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{rp.roadInfoEmpty}</p>;
  }

  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden rounded-md border border-border">
        {stats.map((s) => (
          <button
            key={s.category}
            type="button"
            onClick={() => handleClick(s.category)}
            title={`${labels[s.category] ?? s.category} · ${s.pct.toFixed(0)}%`}
            aria-label={`${labels[s.category] ?? s.category} · ${s.pct.toFixed(0)}%`}
            aria-pressed={selected === s.category}
            style={{
              flexBasis: `${s.pct}%`,
              backgroundColor: colors[s.category] ?? "#94a3b8",
              opacity: selected && selected !== s.category ? 0.35 : 1,
            }}
            className="h-full shrink-0 grow-0 transition-opacity hover:opacity-80"
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {stats.map((s) => (
          <button
            key={s.category}
            type="button"
            onClick={() => handleClick(s.category)}
            aria-pressed={selected === s.category}
            className={[
              "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs transition-colors",
              selected === s.category
                ? "bg-muted font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: colors[s.category] ?? "#94a3b8" }}
            />
            {labels[s.category] ?? s.category}
            <span className="text-muted-foreground">{s.pct.toFixed(0)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── map highlight layer (must live inside <Map>) ───────────────────────────

/** Bold overlay on top of the base route line, showing only the segments
 * matching the selected surface/road-type category. Same stacking pattern
 * as WindExposureLayer / the GPX-edit selected-segment overlay. */
export function RoadHighlightLayer({
  samples,
  dimension,
  category,
  color,
}: {
  samples: RoadInfoSample[];
  dimension: RoadDimension;
  category: string | null;
  color: string;
}) {
  const { map, isLoaded } = useMap();
  const id = useId();
  const sourceId = `road-highlight-source-${id}`;
  const layerId = `road-highlight-layer-${id}`;

  useEffect(() => {
    if (!map || !isLoaded) return;

    map.addSource(sourceId, { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": color,
        "line-width": 6,
        "line-opacity": 0.95,
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
    if (!map || !isLoaded || !map.getLayer(layerId)) return;
    map.setPaintProperty(layerId, "line-color", color);
  }, [map, isLoaded, layerId, color]);

  useEffect(() => {
    if (!map || !isLoaded) return;
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    if (!category) {
      source.setData(EMPTY_FC);
      return;
    }
    const all = buildRoadSegments(samples, dimension);
    source.setData({
      type: "FeatureCollection",
      features: all.features.filter((f) => f.properties.category === category),
    });
  }, [map, isLoaded, samples, dimension, category, sourceId]);

  return null;
}
