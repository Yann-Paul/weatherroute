import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { Loader2, Pencil, X } from "lucide-react";
import { MapMarker, MarkerContent, MapRoute, useMap } from "@/components/ui/map";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RoutePlannerPoint } from "@/api/types";
import { useT } from "@/i18n/useT";

export const EDIT_PROFILES = ["trekking", "fastbike", "mtb", "safety"] as const;
export type EditProfile = (typeof EDIT_PROFILES)[number];

export interface GpxEditSelection {
  startIdx: number | null;
  endIdx: number | null;
  via: RoutePlannerPoint | null;
}

export const EMPTY_EDIT_SELECTION: GpxEditSelection = {
  startIdx: null,
  endIdx: null,
  via: null,
};

export type GpxEditStep = "selectStart" | "selectEnd" | "placeVia" | "preview";

export function gpxEditStep(sel: GpxEditSelection): GpxEditStep {
  if (sel.startIdx == null) return "selectStart";
  if (sel.endIdx == null) return "selectEnd";
  if (sel.via == null) return "placeVia";
  return "preview";
}

// ─── click capture + crosshair cursor while editing ──────────────────────────

function EditClickCapture({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  const { map, isLoaded } = useMap();
  const cbRef = useRef(onClick);
  cbRef.current = onClick;

  useEffect(() => {
    if (!map || !isLoaded) return;
    const handler = (e: maplibregl.MapMouseEvent) => {
      // Tapping a POI marker shows its info popup (see PoiLayer) — it
      // shouldn't also register as the via-point selection click.
      const poiLayerIds = map
        .getStyle()
        .layers?.filter((l) => l.id.startsWith("poi-layer-"))
        .map((l) => l.id);
      if (
        poiLayerIds?.length &&
        map.queryRenderedFeatures(e.point, { layers: poiLayerIds }).length > 0
      ) {
        return;
      }
      cbRef.current(e.lngLat.lat, e.lngLat.lng);
    };
    map.on("click", handler);
    map.getCanvas().style.cursor = "crosshair";
    return () => {
      map.off("click", handler);
      map.getCanvas().style.cursor = "";
    };
  }, [map, isLoaded]);

  return null;
}

// ─── selection markers ────────────────────────────────────────────────────────

function SectionMarker({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  return (
    <MapMarker longitude={lon} latitude={lat}>
      <MarkerContent>
        <div className="flex size-5 items-center justify-center rounded-full border-2 border-white bg-orange-500 text-[10px] font-bold text-white shadow-md">
          {label}
        </div>
      </MarkerContent>
    </MapMarker>
  );
}

// ─── map-side elements (must live inside <Map>) ──────────────────────────────

export function GpxEditMapElements({
  selection,
  trackPoints,
  previewCoords,
  onMapClick,
  onViaDrag,
}: {
  selection: GpxEditSelection;
  trackPoints: [number, number][];
  previewCoords: RoutePlannerPoint[];
  onMapClick: (lat: number, lon: number) => void;
  onViaDrag: (lat: number, lon: number) => void;
}) {
  const { startIdx, endIdx, via } = selection;

  const segCoords: [number, number][] =
    startIdx != null && endIdx != null
      ? trackPoints.slice(startIdx, endIdx + 1).map(([lat, lon]) => [lon, lat])
      : [];

  return (
    <>
      <EditClickCapture onClick={onMapClick} />
      {segCoords.length > 1 && (
        <MapRoute
          coordinates={segCoords}
          color="#f97316"
          width={5}
          opacity={0.9}
          interactive={false}
        />
      )}
      {previewCoords.length > 1 && (
        <MapRoute
          coordinates={previewCoords.map((p) => [p.lon, p.lat] as [number, number])}
          color="#10b981"
          width={4}
          opacity={0.95}
          interactive={false}
        />
      )}
      {startIdx != null && (
        <SectionMarker lat={trackPoints[startIdx][0]} lon={trackPoints[startIdx][1]} label="A" />
      )}
      {endIdx != null && (
        <SectionMarker lat={trackPoints[endIdx][0]} lon={trackPoints[endIdx][1]} label="B" />
      )}
      {via && (
        <MapMarker
          longitude={via.lon}
          latitude={via.lat}
          draggable
          onDragEnd={(lngLat) => onViaDrag(lngLat.lat, lngLat.lng)}
        >
          <MarkerContent>
            <div className="flex size-6 items-center justify-center rounded-full border-2 border-white bg-emerald-600 text-[12px] font-bold text-white shadow-md">
              +
            </div>
          </MarkerContent>
        </MapMarker>
      )}
    </>
  );
}

// ─── floating edit panel ──────────────────────────────────────────────────────

export function GpxEditPanel({
  active,
  selection,
  segmentKm,
  profile,
  onProfileChange,
  previewLoading,
  previewError,
  canApply,
  applying,
  onActivate,
  onCancel,
  onReset,
  onApply,
}: {
  active: boolean;
  selection: GpxEditSelection;
  /** [fromKm, toKm] of the selected section, when both endpoints are set. */
  segmentKm: [number, number] | null;
  profile: EditProfile;
  onProfileChange: (p: EditProfile) => void;
  previewLoading: boolean;
  previewError: boolean;
  canApply: boolean;
  applying: boolean;
  onActivate: () => void;
  onCancel: () => void;
  onReset: () => void;
  onApply: () => void;
}) {
  const t = useT();
  const ed = t.gpx.results.edit;

  if (!active) {
    return (
      <button
        type="button"
        onClick={onActivate}
        className="flex w-full items-center gap-1.5 rounded-md border border-border bg-background/95 p-2.5 text-xs font-medium shadow-sm backdrop-blur-sm transition-colors hover:bg-muted"
      >
        <Pencil className="size-3.5 shrink-0 text-primary" />
        <span className="truncate">{ed.title}</span>
      </button>
    );
  }

  const step = gpxEditStep(selection);
  const hint =
    step === "selectStart"
      ? ed.hintSelectStart
      : step === "selectEnd"
        ? ed.hintSelectEnd
        : step === "placeVia"
          ? ed.hintPlaceVia
          : ed.hintPreview;

  return (
    <div className="w-full rounded-md border border-border bg-background/95 p-2.5 shadow-sm backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <Pencil className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">{ed.title}</span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label={ed.cancel}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">{hint}</p>

      {segmentKm && (
        <p className="mt-1 text-[10px] font-medium text-orange-500">
          {ed.segment(Math.round(segmentKm[0]), Math.round(segmentKm[1]))}
        </p>
      )}

      <div className="mt-2 space-y-1">
        <p className="text-[10px] text-muted-foreground">{ed.profile}</p>
        <Select value={profile} onValueChange={(v) => onProfileChange(v as EditProfile)}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EDIT_PROFILES.map((p) => (
              <SelectItem key={p} value={p}>
                {t.planner.brouterProfiles[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {previewLoading && (
        <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {ed.previewLoading}
        </p>
      )}
      {previewError && !previewLoading && (
        <p className="mt-2 text-[10px] text-destructive">{ed.previewError}</p>
      )}

      <div className="mt-2.5 flex flex-col gap-1.5">
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          disabled={!canApply || applying}
          onClick={onApply}
        >
          {applying ? ed.applying : ed.apply}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onReset}
          disabled={applying}
        >
          {ed.reset}
        </Button>
      </div>
    </div>
  );
}
