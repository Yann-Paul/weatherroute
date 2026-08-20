import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { CloudRain, Play, Pause } from "lucide-react";
import { findContentLayerBeforeId, useMap } from "@/components/ui/map";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useT } from "@/i18n/useT";

// ─── Rain radar (RainViewer prototype) ─────────────────────────────────────────
//
// Free tier of https://www.rainviewer.com/api.html — personal/non-commercial use
// only, attribution required. Since the Jan-2026 API transition only past radar
// is available (last ~2h in 10-min steps), max zoom is capped server-side at 7,
// and there's no forecast (nowcast) data anymore.
//
// Shared between the GPX results map and the route planner map.

export type RainViewerFrame = { time: number; path: string };
type RainViewerData = { host: string; radar: { past: RainViewerFrame[] } };

/** Only fetches/polls while `enabled` — avoids spending a user's RainViewer
 * rate-limit quota on page loads that never turn the radar on. */
function useRainViewerFrames(enabled: boolean): { data: RainViewerData | null; error: boolean } {
  const [data, setData] = useState<RainViewerData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function load() {
      if (!navigator.onLine) return; // avoid spamming a doomed request; the 5min interval will retry
      try {
        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as RainViewerData;
        if (cancelled) return;
        setData(json);
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      }
    }
    load();
    const interval = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return { data, error };
}

/** Bundles the radar state (on/off, opacity, frame scrubbing, live-follow) so
 * each map page only wires `enabled`/`tileUrl`/`opacity` into RainRadarLayer
 * and spreads `panelProps` into RainRadarPanel. */
export function useRainRadar() {
  const [enabled, setEnabled] = useState(false);
  const [opacity, setOpacity] = useState(0.7);
  const [frameIdx, setFrameIdx] = useState(0);
  const [followLive, setFollowLive] = useState(true);
  const { data, error } = useRainViewerFrames(enabled);
  const frames = useMemo(() => data?.radar.past ?? [], [data]);

  // Keep the slider pinned to the newest frame as new data arrives, unless the
  // user manually scrubbed to an older frame (see onManualScrub below).
  const latestTime = frames.length > 0 ? frames[frames.length - 1].time : null;
  const prevLatestTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (latestTime == null || prevLatestTimeRef.current === latestTime) return;
    prevLatestTimeRef.current = latestTime;
    if (followLive) setFrameIdx(frames.length - 1);
  }, [latestTime, frames.length, followLive]);

  const frame = frames[frameIdx] ?? frames[frames.length - 1] ?? null;
  const tileUrl =
    data && frame ? `${data.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png` : null;

  return {
    enabled,
    opacity,
    tileUrl,
    panelProps: {
      frames,
      loadError: error,
      enabled,
      onToggleEnabled: setEnabled,
      opacity,
      onOpacityChange: setOpacity,
      frameIdx,
      onFrameIdxChange: setFrameIdx,
      followLive,
      onManualScrub: (v: number) => {
        setFollowLive(false);
        setFrameIdx(v);
      },
      onJumpToLive: () => {
        setFollowLive(true);
        setFrameIdx(frames.length - 1);
      },
    },
  };
}

const RADAR_SOURCE_ID = "rainviewer-radar-source";
const RADAR_LAYER_ID = "rainviewer-radar-layer";

export function RainRadarLayer({ tileUrl, opacity }: { tileUrl: string; opacity: number }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded) return;

    map.addSource(RADAR_SOURCE_ID, {
      type: "raster",
      tiles: [tileUrl],
      tileSize: 256,
      maxzoom: 7,
      attribution:
        'Regenradar &copy; <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a>',
    });
    // Insert below the route/POI/wind/forest layers (if already present) so
    // toggling the radar on never hides the route underneath it.
    map.addLayer(
      {
        id: RADAR_LAYER_ID,
        type: "raster",
        source: RADAR_SOURCE_ID,
        paint: { "raster-opacity": opacity },
      },
      findContentLayerBeforeId(map)
    );

    return () => {
      try {
        if (map.getLayer(RADAR_LAYER_ID)) map.removeLayer(RADAR_LAYER_ID);
        if (map.getSource(RADAR_SOURCE_ID)) map.removeSource(RADAR_SOURCE_ID);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded]);

  useEffect(() => {
    if (!map || !map.getLayer(RADAR_LAYER_ID)) return;
    map.setPaintProperty(RADAR_LAYER_ID, "raster-opacity", opacity);
  }, [map, opacity]);

  useEffect(() => {
    const source = map?.getSource(RADAR_SOURCE_ID) as maplibregl.RasterTileSource | undefined;
    source?.setTiles([tileUrl]);
  }, [map, tileUrl]);

  return null;
}

export function RainRadarPanel({
  frames,
  loadError,
  enabled,
  onToggleEnabled,
  opacity,
  onOpacityChange,
  frameIdx,
  onFrameIdxChange,
  followLive,
  onManualScrub,
  onJumpToLive,
}: {
  frames: RainViewerFrame[];
  loadError: boolean;
  enabled: boolean;
  onToggleEnabled: (v: boolean) => void;
  opacity: number;
  onOpacityChange: (v: number) => void;
  frameIdx: number;
  onFrameIdxChange: (v: number) => void;
  followLive: boolean;
  onManualScrub: (v: number) => void;
  onJumpToLive: () => void;
}) {
  const t = useT();
  const tr = t.gpx.results.radar;
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const id = setInterval(() => {
      onFrameIdxChange((frameIdx + 1) % frames.length);
    }, 600);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, frameIdx, frames.length]);

  const currentFrame = frames[frameIdx];
  const frameLabel = currentFrame
    ? new Date(currentFrame.time * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "–";

  return (
    <div className="w-full rounded-md border border-border bg-background/95 p-2.5 shadow-sm backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <CloudRain className="size-3.5 shrink-0 text-blue-400" />
          <span className="truncate">{tr.title}</span>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggleEnabled} className="shrink-0 scale-90" />
      </div>

      {enabled && frames.length > 0 && (
        <div className="mt-2.5 space-y-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying((v) => !v)}
              className="flex size-6 shrink-0 items-center justify-center rounded border border-border bg-card hover:bg-muted"
              aria-label={playing ? tr.pause : tr.play}
            >
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </button>
            <Slider
              min={0}
              max={frames.length - 1}
              step={1}
              value={[frameIdx]}
              onValueChange={([v]) => {
                setPlaying(false);
                onManualScrub(v);
              }}
              className="min-w-0 flex-1"
            />
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
              {frameLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[10px] text-muted-foreground">{tr.opacity}</span>
            <Slider
              min={0.1}
              max={1}
              step={0.05}
              value={[opacity]}
              onValueChange={([v]) => onOpacityChange(v)}
              className="min-w-0 flex-1"
            />
          </div>
          <div className="flex justify-end">
            {followLive ? (
              <span className="flex items-center gap-1 text-[9px] font-medium text-emerald-500">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {tr.live}
              </span>
            ) : (
              <button
                type="button"
                onClick={onJumpToLive}
                className="text-[9px] font-medium text-primary underline underline-offset-2"
              >
                {tr.live}
              </button>
            )}
          </div>
        </div>
      )}

      {enabled && frames.length === 0 && !loadError && (
        <p className="mt-2 text-[10px] text-muted-foreground">{tr.loading}</p>
      )}

      {enabled && loadError && frames.length === 0 && (
        <p className="mt-2 text-[10px] text-destructive">{tr.error}</p>
      )}

      <p className="mt-2 text-[9px] leading-tight text-muted-foreground">
        {tr.dataSource}:{" "}
        <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer" className="underline">
          RainViewer
        </a>{" "}
        · {tr.pastNote}
      </p>
    </div>
  );
}
