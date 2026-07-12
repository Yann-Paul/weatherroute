import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import maplibregl from "maplibre-gl";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  Mountain,
  RefreshCw,
} from "lucide-react";
import {
  Map,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerPopup,
  MapRoute,
  useMap,
} from "@/components/ui/map";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GpxElevationChart } from "@/components/gpx/GpxElevationChart";
import { GpxMarkers } from "@/components/gpx/GpxRouteMap";
import {
  previewRoutePlan,
  submitRoutePlannerJob,
  getJobStatus,
  getGpxResults,
} from "@/api/client";
import type { GpxDayConfig, GpxJobResults, RoutePlannerPoint } from "@/api/types";
import { useT } from "@/i18n/useT";
import { useLangStore } from "@/i18n/store";
import { useJobStore } from "@/stores/jobStore";
import { toast } from "sonner";
import {
  GlobalPlanPanel,
  Hint,
  PerDayPlanTable,
} from "@/components/wizard/RoutePlanningSteps";
import {
  DEFAULT_DAY_CONFIG,
  buildDayConfigs,
  editParam,
  numDaysFor,
  type DayConfig,
  type Param,
} from "@/components/wizard/dayConfig";

const PROFILES = ["trekking", "fastbike", "mtb", "safety"] as const;
type Profile = (typeof PROFILES)[number];

type WeatherStatus = "idle" | "pending" | "running" | "done" | "error";

const GERMANY_CENTER: [number, number] = [10.4515, 51.1657];

// ─── map helper components (must live inside <Map>) ───────────────────────────

function ClickCapture({ onMapClick }: { onMapClick: (lat: number, lon: number) => void }) {
  const { map, isLoaded } = useMap();
  const cbRef = useRef(onMapClick);
  useEffect(() => {
    cbRef.current = onMapClick;
  }, [onMapClick]);
  useEffect(() => {
    if (!map || !isLoaded) return;
    const handler = (e: maplibregl.MapMouseEvent) => cbRef.current(e.lngLat.lat, e.lngLat.lng);
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [map, isLoaded]);
  return null;
}

function FitOnce({ coordinates }: { coordinates: [number, number][] }) {
  const { map, isLoaded } = useMap();
  const hasFit = useRef(false);
  useEffect(() => {
    if (!map || !isLoaded || coordinates.length === 0 || hasFit.current) return;
    hasFit.current = true;
    if (coordinates.length === 1) {
      map.jumpTo({ center: coordinates[0], zoom: 12 });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    coordinates.forEach((c) => bounds.extend(c));
    map.fitBounds(bounds, { padding: 60 });
  }, [map, isLoaded, coordinates]);
  return null;
}

// ─── full-window map ────────────────────────────────────────────────────────

function RouteMapView({
  points,
  previewCoords,
  weatherResult,
  onMapClick,
  onDragPoint,
  onRemovePoint,
}: {
  points: RoutePlannerPoint[];
  previewCoords: RoutePlannerPoint[];
  weatherResult: GpxJobResults | null;
  onMapClick: (lat: number, lon: number) => void;
  onDragPoint: (i: number, lat: number, lon: number) => void;
  onRemovePoint: (i: number) => void;
}) {
  const t = useT();
  const rp = t.routePlanner;

  const routeLine: [number, number][] =
    previewCoords.length > 1
      ? previewCoords.map((p) => [p.lon, p.lat])
      : points.map((p) => [p.lon, p.lat]);

  return (
    <Map center={GERMANY_CENTER} zoom={6} className="h-full w-full">
      <ClickCapture onMapClick={onMapClick} />
      <FitOnce coordinates={points.map((p) => [p.lon, p.lat])} />
      {routeLine.length > 1 && (
        <MapRoute coordinates={routeLine} color="hsl(var(--primary))" width={4} opacity={0.85} />
      )}
      {weatherResult && (
        <GpxMarkers weatherPoints={weatherResult.weatherPoints} trackPoints={weatherResult.trackPoints} />
      )}
      {points.map((pt, i) => {
        const label =
          i === 0 ? rp.pointStart : i === points.length - 1 ? rp.pointEnd : rp.pointVia(i);
        return (
          <MapMarker
            key={i}
            longitude={pt.lon}
            latitude={pt.lat}
            draggable
            onDragEnd={(lngLat) => onDragPoint(i, lngLat.lat, lngLat.lng)}
          >
            <MarkerContent>
              <div className="flex size-6 items-center justify-center rounded-full border-2 border-white bg-primary text-[11px] font-bold text-primary-foreground shadow-md">
                {i + 1}
              </div>
            </MarkerContent>
            <MarkerPopup>
              <div className="min-w-[120px] space-y-1.5 text-xs">
                <p className="font-semibold">{label}</p>
                <p className="text-muted-foreground">
                  {pt.lat.toFixed(5)}, {pt.lon.toFixed(5)}
                </p>
                <button
                  type="button"
                  onClick={() => onRemovePoint(i)}
                  className="font-medium text-destructive hover:underline"
                >
                  {rp.removePoint}
                </button>
              </div>
            </MarkerPopup>
          </MapMarker>
        );
      })}
      <MapControls position="bottom-right" showLocate />
    </Map>
  );
}

// ─── floating controls panel ───────────────────────────────────────────────

function ControlsPanel({
  onBack,
  profile,
  onProfileChange,
  points,
  distanceKm,
  ascentM,
  previewLoading,
  previewError,
  onClearPoints,
  startDate,
  onDateChange,
  useGlobal,
  globalConfig,
  dayConfigs,
  nDays,
  totalKm,
  onToggleMode,
  onGlobalParam,
  onGlobalTime,
  onDayParam,
  onDayTime,
  collapsed,
  onToggleCollapsed,
  actionsDisabled,
  actionsDisabledHint,
  onFinalize,
  finalizeBusy,
}: {
  onBack: () => void;
  profile: Profile;
  onProfileChange: (p: Profile) => void;
  points: RoutePlannerPoint[];
  distanceKm: number | null;
  ascentM: number | null;
  previewLoading: boolean;
  previewError: boolean;
  onClearPoints: () => void;
  startDate: string;
  onDateChange: (d: string) => void;
  useGlobal: boolean;
  globalConfig: DayConfig;
  dayConfigs: DayConfig[];
  nDays: number | null;
  totalKm: number | null;
  onToggleMode: (individual: boolean) => void;
  onGlobalParam: (p: Param, v: number) => void;
  onGlobalTime: (t: string) => void;
  onDayParam: (dayIdx: number, p: Param, v: number) => void;
  onDayTime: (dayIdx: number, t: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  actionsDisabled: boolean;
  actionsDisabledHint?: string;
  onFinalize: () => void;
  finalizeBusy: boolean;
}) {
  const t = useT();
  const rp = t.routePlanner;
  const tp = t.planner;
  const w = t.wizard;

  function pillClass(active: boolean) {
    return [
      "px-3 py-1.5 text-xs font-medium transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-card text-muted-foreground hover:bg-muted",
    ].join(" ");
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border bg-card/95 shadow-lg backdrop-blur-sm">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label={w.back}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="truncate text-sm font-semibold">{rp.heading}</h1>
          {distanceKm != null && (
            <span className="hidden shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary sm:inline">
              {distanceKm.toFixed(1)} km · ↑{Math.round(ascentM ?? 0)} m
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? rp.expand : rp.collapse}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="relative min-h-0 flex-1 border-t border-border">
          <div className="h-full space-y-3 overflow-y-auto px-4 py-3">
          {/* profile + distance/ascent (mobile) + clear */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[160px] flex-1 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">{rp.profile}</p>
              <Select value={profile} onValueChange={(v) => onProfileChange(v as Profile)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROFILES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {tp.brouterProfiles[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 text-sm sm:hidden">
              <span>{distanceKm != null ? `${distanceKm.toFixed(1)} km` : previewLoading ? "…" : "—"}</span>
              <span>↑{ascentM != null ? Math.round(ascentM) : "—"} m</span>
            </div>
            {points.length > 0 && (
              <button
                type="button"
                onClick={onClearPoints}
                className="pb-2 text-xs text-muted-foreground hover:text-destructive"
              >
                {rp.clearPoints}
              </button>
            )}
          </div>
          <Hint>{rp.mapHint}</Hint>

          {previewError && (
            <Alert variant="destructive">
              <AlertDescription>{rp.previewError}</AlertDescription>
            </Alert>
          )}

          <div className="h-px bg-border" />

          {/* start date */}
          <div className="space-y-1.5">
            <Label htmlFor="rp-start-date">{t.gpx.startDate}</Label>
            <Input
              id="rp-start-date"
              type="date"
              value={startDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="max-w-[200px]"
            />
          </div>

          {/* mode toggle */}
          <div className="flex w-fit overflow-hidden rounded-lg border border-border">
            <button type="button" onClick={() => onToggleMode(false)} className={pillClass(useGlobal)}>
              {t.gpx.sameForAll}
            </button>
            <button type="button" onClick={() => onToggleMode(true)} className={pillClass(!useGlobal)}>
              {t.gpx.perDay}
            </button>
          </div>

          {useGlobal ? (
            <GlobalPlanPanel
              config={globalConfig}
              nDays={nDays}
              onParamChange={onGlobalParam}
              onTimeChange={onGlobalTime}
            />
          ) : (
            dayConfigs.length > 0 && (
              <PerDayPlanTable
                dayConfigs={dayConfigs}
                totalKm={totalKm ?? 0}
                onParamChange={onDayParam}
                onTimeChange={onDayTime}
              />
            )
          )}

          <div className="space-y-2 border-t border-border pt-3">
            {actionsDisabled && actionsDisabledHint && (
              <p className="text-center text-xs text-muted-foreground">{actionsDisabledHint}</p>
            )}
            <div className="flex items-center justify-end">
              <Button type="button" onClick={onFinalize} disabled={actionsDisabled || finalizeBusy} className="gap-1.5">
                {finalizeBusy ? w.gpxAnalyzing : w.gpxAnalyze}
              </Button>
            </div>
          </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-2xl bg-gradient-to-t from-card to-transparent" />
        </div>
      )}
    </div>
  );
}

// ─── full-width collapsible elevation + weather dock ───────────────────────

function ProfileWindow({
  status,
  message,
  result,
  error,
  stale,
  collapsed,
  onToggleCollapsed,
  onRefresh,
}: {
  status: WeatherStatus;
  message: string;
  result: GpxJobResults | null;
  error: string | null;
  stale: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRefresh: () => void;
}) {
  const t = useT();
  const rp = t.routePlanner;

  if (status === "idle") return null;

  const busy = status === "pending" || status === "running";

  return (
    <div className="rounded-2xl border bg-card/95 shadow-lg backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Mountain className="h-4 w-4 text-primary" />
          {rp.profileHeading}
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-3">
          {(status === "done" || status === "error") && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={busy}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" />
              {rp.weatherRefresh}
            </button>
          )}
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? rp.expand : rp.collapse}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="max-h-[260px] overflow-y-auto border-t border-border px-4 py-3">
          {busy && !result && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p>{message || rp.weatherButtonLoading}</p>
            </div>
          )}

          {status === "error" && !result && (
            <Alert variant="destructive">
              <AlertDescription>{error || rp.weatherErrorFallback}</AlertDescription>
            </Alert>
          )}

          {result && (
            <>
              {status === "error" && (
                <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-foreground">
                  {error || rp.weatherErrorFallback}
                </div>
              )}
              {status === "done" && stale && (
                <div className="mb-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-foreground">
                  {rp.weatherStale}
                </div>
              )}
              <GpxElevationChart
                elevation={result.elevation}
                weatherPoints={result.weatherPoints}
                dailyConfigs={result.dailyConfigs}
                startDate={result.startDate}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── main route planner page ───────────────────────────────────────────────────

export function RoutePlannerPage() {
  const navigate = useNavigate();
  const t = useT();
  const rp = t.routePlanner;
  const lang = useLangStore((s) => s.lang);
  const setJobId = useJobStore((s) => s.setJobId);

  useEffect(() => {
    document.title = lang === "de" ? "WeatherRoute — Streckenplaner" : "WeatherRoute — Route Planner";
    return () => {
      document.title = "WeatherRoute";
    };
  }, [lang]);

  // ── route state
  const [points, setPoints] = useState<RoutePlannerPoint[]>([]);
  const [profile, setProfile] = useState<Profile>("trekking");
  const [previewCoords, setPreviewCoords] = useState<RoutePlannerPoint[]>([]);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [ascentM, setAscentM] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const reqIdRef = useRef(0);

  // ── date state
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));

  // ── planning state
  const [useGlobal, setUseGlobal] = useState(true);
  const [globalConfig, setGlobalConfig] = useState<DayConfig>(DEFAULT_DAY_CONFIG);
  const [dayConfigs, setDayConfigs] = useState<DayConfig[]>([]);

  // ── panel + submit state
  const [collapsed, setCollapsed] = useState(false);
  const [weatherCollapsed, setWeatherCollapsed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── weather preview state
  const [weatherStatus, setWeatherStatus] = useState<WeatherStatus>("idle");
  const [weatherMessage, setWeatherMessage] = useState("");
  const [weatherResult, setWeatherResult] = useState<GpxJobResults | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [weatherJobId, setWeatherJobId] = useState<string | null>(null);
  const [weatherSignature, setWeatherSignature] = useState<string | null>(null);
  const pollTokenRef = useRef(0);

  useEffect(() => () => { pollTokenRef.current++; }, []);

  const nDays = distanceKm != null ? numDaysFor(distanceKm, globalConfig.dailyKm) : null;

  // ── live route preview (debounced)
  useEffect(() => {
    if (points.length < 2) {
      setPreviewCoords([]);
      setDistanceKm(null);
      setAscentM(null);
      setPreviewError(false);
      setPreviewLoading(false);
      return;
    }
    const myId = ++reqIdRef.current;
    setPreviewLoading(true);
    setPreviewError(false);
    const handle = setTimeout(async () => {
      try {
        const result = await previewRoutePlan(points, profile);
        if (reqIdRef.current !== myId) return;
        setPreviewCoords(result.coordinates);
        setDistanceKm(result.distanceKm);
        setAscentM(result.ascentM);
      } catch {
        if (reqIdRef.current !== myId) return;
        setPreviewError(true);
        setPreviewCoords([]);
        setDistanceKm(null);
        setAscentM(null);
      } finally {
        if (reqIdRef.current === myId) setPreviewLoading(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [points, profile]);

  // ── point handling
  function handleMapClick(lat: number, lon: number) {
    setPoints((p) => [...p, { lat, lon }]);
  }

  function handleDragPoint(i: number, lat: number, lon: number) {
    setPoints((p) => p.map((pt, idx) => (idx === i ? { lat, lon } : pt)));
  }

  function handleRemovePoint(i: number) {
    setPoints((p) => p.filter((_, idx) => idx !== i));
  }

  function handleClearPoints() {
    setPoints([]);
  }

  // ── planning config changes
  function handleGlobalParam(param: Param, value: number) {
    const next = editParam(globalConfig, param, value);
    setGlobalConfig(next);
    if (!useGlobal && distanceKm != null)
      setDayConfigs(buildDayConfigs(numDaysFor(distanceKm, next.dailyKm), next, distanceKm));
  }

  function handleGlobalTime(time: string) {
    setGlobalConfig((p) => ({ ...p, startTime: time }));
    if (!useGlobal) setDayConfigs((p) => p.map((d) => ({ ...d, startTime: time })));
  }

  function handleToggleMode(individual: boolean) {
    setUseGlobal(!individual);
    if (individual && distanceKm != null && nDays != null)
      setDayConfigs(buildDayConfigs(nDays, globalConfig, distanceKm));
  }

  function handleDayParam(dayIdx: number, param: Param, value: number) {
    setDayConfigs((p) => p.map((d, i) => (i === dayIdx ? editParam(d, param, value) : d)));
  }

  function handleDayTime(dayIdx: number, time: string) {
    setDayConfigs((p) => p.map((d, i) => (i === dayIdx ? { ...d, startTime: time } : d)));
  }

  // ── shared config + signature builders
  function buildConfigs(): GpxDayConfig[] {
    if (distanceKm == null) return [];
    return useGlobal
      ? buildDayConfigs(nDays ?? 1, globalConfig, distanceKm).map((c) => ({
          startTime: c.startTime,
          speed: c.speed,
          dailyKm: c.dailyKm,
        }))
      : dayConfigs.map((c) => ({ startTime: c.startTime, speed: c.speed, dailyKm: c.dailyKm }));
  }

  function computeSignature(configs: GpxDayConfig[]) {
    return JSON.stringify({ points, profile, startDate, configs });
  }

  const currentSignature = distanceKm != null ? computeSignature(buildConfigs()) : null;
  const isStale =
    weatherStatus === "done" &&
    weatherSignature != null &&
    currentSignature != null &&
    weatherSignature !== currentSignature;

  const actionsDisabled = points.length < 2 || previewLoading || distanceKm == null || !startDate;

  // ── weather preview: submit + poll inline, no navigation
  async function pollWeatherJob(jobId: string) {
    const myToken = ++pollTokenRef.current;
    for (;;) {
      if (pollTokenRef.current !== myToken) return;
      let status;
      try {
        status = await getJobStatus(jobId);
      } catch {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      if (pollTokenRef.current !== myToken) return;

      if (status.status === "error") {
        setWeatherStatus("error");
        setWeatherError(status.error);
        return;
      }

      setWeatherStatus("running");
      setWeatherMessage(status.message);

      if (status.status === "done" || status.status === "preview") {
        try {
          const results = await getGpxResults(jobId);
          if (pollTokenRef.current !== myToken) return;
          setWeatherResult(results as GpxJobResults);
          setWeatherStatus("done");
        } catch {
          if (pollTokenRef.current !== myToken) return;
          setWeatherStatus("error");
          setWeatherError(rp.weatherErrorFallback);
        }
        return;
      }

      await new Promise((r) => setTimeout(r, 900));
    }
  }

  async function submitWeatherJob(configs: GpxDayConfig[], sig: string) {
    setWeatherStatus("pending"); // ProfileWindow keeps showing the last good `result` underneath
    setWeatherMessage("");
    setWeatherError(null);
    try {
      const { jobId } = await submitRoutePlannerJob(points, profile, startDate, configs);
      setWeatherJobId(jobId);
      setWeatherSignature(sig);
      pollWeatherJob(jobId);
    } catch (err) {
      setWeatherStatus("error");
      setWeatherError(err instanceof Error ? err.message : rp.weatherErrorFallback);
    }
  }

  // Manual retry/refresh (button in the profile window)
  function handleRefreshWeather() {
    if (points.length < 2 || !startDate || distanceKm == null) return;
    submitWeatherJob(buildConfigs(), currentSignature ?? computeSignature(buildConfigs()));
  }

  // Auto-fetch: whenever the route or day-planning settings settle on a new
  // value, query weather + elevation automatically (debounced — the lookups
  // hit rate-limited external APIs, so we don't want to fire on every drag).
  useEffect(() => {
    if (points.length < 2 || !startDate || distanceKm == null) return;
    const configs = buildConfigs();
    if (configs.length === 0) return;
    const sig = computeSignature(configs);
    if (sig === weatherSignature) return; // already fetched/fetching this exact combination

    const handle = setTimeout(() => {
      submitWeatherJob(configs, sig);
    }, 1500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, profile, startDate, distanceKm, useGlobal, globalConfig, dayConfigs]);

  // ── final submit: reuse an up-to-date weather preview job if one exists
  async function handleFinalize() {
    if (points.length < 2) { toast.error(rp.errors.minPoints); return; }
    if (!startDate) { toast.error(rp.errors.noDate); return; }
    if (distanceKm == null) { toast.error(rp.previewError); return; }

    const configs = buildConfigs();
    const sig = computeSignature(configs);
    setSubmitting(true);
    try {
      if (weatherJobId && weatherStatus === "done" && weatherSignature === sig) {
        setJobId(weatherJobId);
        navigate(`/progress/${weatherJobId}`);
        return;
      }
      const { jobId } = await submitRoutePlannerJob(points, profile, startDate, configs);
      setJobId(jobId);
      navigate(`/progress/${jobId}`);
    } catch (err) {
      const msg = rp.errors.submissionFailed + (err instanceof Error ? `: ${err.message}` : "");
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1">
        <RouteMapView
          points={points}
          previewCoords={previewCoords}
          weatherResult={weatherResult}
          onMapClick={handleMapClick}
          onDragPoint={handleDragPoint}
          onRemovePoint={handleRemovePoint}
        />

        <div className="pointer-events-none absolute inset-y-3 left-3 z-20 w-[380px] max-w-[92vw]">
          <div className="pointer-events-auto h-full">
            <ControlsPanel
              onBack={() => navigate("/")}
              profile={profile}
              onProfileChange={setProfile}
              points={points}
              distanceKm={distanceKm}
              ascentM={ascentM}
              previewLoading={previewLoading}
              previewError={previewError}
              onClearPoints={handleClearPoints}
              startDate={startDate}
              onDateChange={setStartDate}
              useGlobal={useGlobal}
              globalConfig={globalConfig}
              dayConfigs={dayConfigs}
              nDays={nDays}
              totalKm={distanceKm}
              onToggleMode={handleToggleMode}
              onGlobalParam={handleGlobalParam}
              onGlobalTime={handleGlobalTime}
              onDayParam={handleDayParam}
              onDayTime={handleDayTime}
              collapsed={collapsed}
              onToggleCollapsed={() => setCollapsed((c) => !c)}
              actionsDisabled={actionsDisabled}
              actionsDisabledHint={actionsDisabled ? rp.needPointsHint : undefined}
              onFinalize={handleFinalize}
              finalizeBusy={submitting}
            />
          </div>
        </div>
      </div>

      {weatherStatus !== "idle" && (
        <div className="shrink-0 px-3 pb-3">
          <ProfileWindow
            status={weatherStatus}
            message={weatherMessage}
            result={weatherResult}
            error={weatherError}
            stale={isStale}
            collapsed={weatherCollapsed}
            onToggleCollapsed={() => setWeatherCollapsed((c) => !c)}
            onRefresh={handleRefreshWeather}
          />
        </div>
      )}
    </div>
  );
}
