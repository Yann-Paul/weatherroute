import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import { fetchRoutePois } from "@/api/client";
import { simplifyPoints } from "@/components/planner/MapLayers";
import type { MapPoi, PoiCategory, RoutePlannerPoint } from "@/api/types";
import {
  boundariesForDays,
  boundariesForDistance,
  buildSegments,
  type RouteSegment,
} from "@/utils/routeSegments";
import { downloadGpx, downloadGpxZip } from "@/utils/gpxExport";
import { useT } from "@/i18n/useT";

type Mode = "none" | "day" | "km";

function pillClass(active: boolean) {
  return [
    "px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    active ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted",
  ].join(" ");
}

interface RouteSplitControlProps {
  /** Full track, in order. */
  coords: RoutePlannerPoint[];
  totalKm: number | null;
  /** Per-day distance plan, e.g. from buildConfigs()/dailyConfigs — used for "per day" mode. */
  dailyKm: number[];
  /** Currently loaded whole-route POIs, used only to infer which categories to re-query per segment. */
  pois: MapPoi[];
  /** POI search radius (meters) to use when re-querying POIs for a segment. */
  poiRadiusM: number;
  /** File name (without extension/suffix) used as the base for downloads. */
  namePrefix: string;
  onSelectedSegmentChange?: (segment: RouteSegment | null) => void;
}

/** Lets the user split a route into day- or distance-based segments, switch between them, and
 * download a single segment (or all of them as a zip) with POIs scoped to that segment. */
export function RouteSplitControl({
  coords,
  totalKm,
  dailyKm,
  pois,
  poiRadiusM,
  namePrefix,
  onSelectedSegmentChange,
}: RouteSplitControlProps) {
  const t = useT();
  const rp = t.routePlanner.split;
  const [mode, setMode] = useState<Mode>("none");
  const [stepKm, setStepKm] = useState(50);
  const [selected, setSelected] = useState<number | "all">("all");
  const [busy, setBusy] = useState(false);

  const activeCategories = useMemo(
    () => [...new Set(pois.map((p) => p.category))] as PoiCategory[],
    [pois]
  );

  const segments = useMemo(() => {
    if (mode === "none" || coords.length < 2 || totalKm == null) return [];
    const boundaries =
      mode === "day" ? boundariesForDays(dailyKm) : boundariesForDistance(totalKm, stepKm);
    return buildSegments(coords, boundaries);
  }, [mode, coords, totalKm, dailyKm, stepKm]);

  const dayModeDisabled = dailyKm.length < 2;

  function selectSegment(sel: number | "all") {
    setSelected(sel);
    onSelectedSegmentChange?.(sel === "all" ? null : (segments[sel] ?? null));
  }

  function handleModeChange(next: Mode) {
    setMode(next);
    setSelected("all");
    onSelectedSegmentChange?.(null);
  }

  async function fetchSegmentPois(segment: RouteSegment): Promise<MapPoi[]> {
    if (activeCategories.length === 0) return [];
    try {
      return await fetchRoutePois(simplifyPoints(segment.coords), activeCategories, poiRadiusM);
    } catch {
      toast.error(t.routePlanner.layers.poiError);
      return [];
    }
  }

  async function handleDownloadSegment(segment: RouteSegment) {
    setBusy(true);
    try {
      const segPois = await fetchSegmentPois(segment);
      downloadGpx(segment.coords, `${namePrefix}-${segment.index + 1}`, segPois);
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadZip() {
    setBusy(true);
    try {
      const entries = [];
      for (const segment of segments) {
        entries.push({
          name: `${namePrefix}-${segment.index + 1}`,
          coords: segment.coords,
          pois: await fetchSegmentPois(segment),
        });
      }
      await downloadGpxZip(entries, namePrefix);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-xs font-semibold text-muted-foreground">{rp.heading}</p>
      <div className="flex w-fit overflow-hidden rounded-lg border border-border">
        <button type="button" onClick={() => handleModeChange("none")} className={pillClass(mode === "none")}>
          {rp.modeOff}
        </button>
        <button
          type="button"
          onClick={() => handleModeChange("day")}
          disabled={dayModeDisabled}
          title={dayModeDisabled ? rp.needMultipleDays : undefined}
          className={pillClass(mode === "day")}
        >
          {rp.modeDay}
        </button>
        <button type="button" onClick={() => handleModeChange("km")} className={pillClass(mode === "km")}>
          {rp.modeKm}
        </button>
      </div>

      {mode === "km" && (
        <div className="flex items-center gap-2">
          <NumericInput value={stepKm} onChange={setStepKm} fallback={50} min={1} className="h-8 w-20 text-xs" />
          <span className="text-xs text-muted-foreground">{rp.stepKmLabel}</span>
        </div>
      )}

      {mode !== "none" && segments.length > 1 && (
        <>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => selectSegment("all")} className={pillClass(selected === "all")}>
              {rp.wholeRoute}
            </button>
            {segments.map((seg) => (
              <button
                key={seg.index}
                type="button"
                onClick={() => selectSegment(seg.index)}
                className={pillClass(selected === seg.index)}
              >
                {mode === "day" ? rp.day(seg.index + 1) : rp.segment(seg.index + 1, seg.startKm, seg.endKm)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {selected !== "all" && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => handleDownloadSegment(segments[selected])}
                className="gap-1"
              >
                <Download className="h-4 w-4" />
                {rp.downloadSegment}
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={busy} onClick={handleDownloadZip} className="gap-1">
              <Download className="h-4 w-4" />
              {rp.downloadZip}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
