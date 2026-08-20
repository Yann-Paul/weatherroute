import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Bookmark, BookmarkCheck, Download } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  getGpxResults,
  getGpxModelForecast,
  fetchForecastViaBrowser,
  fetchGpxStopsViaBrowser,
  fetchRoadInfo,
  saveRoute,
} from "@/api/client";
import { cacheJobResult, getCachedJobResult } from "@/lib/resultsCacheDb";
import type { GpxJobResults, GpxWeatherPoint, MapPoi, RoadInfoResult, RoutePlannerPoint } from "@/api/types";
import { CLIENT_FALLBACK_NEEDED } from "@/api/types";
import { downloadGpx } from "@/utils/gpxExport";
import { useT } from "@/i18n/useT";
import { RouteSplitControl } from "@/components/planner/RouteSplitControl";
import { GpxRouteMap } from "./GpxRouteMap";
import { GpxElevationChart } from "./GpxElevationChart";
import { GpxTemperatureChart } from "./GpxTemperatureChart";
import { GpxWeatherTable } from "./GpxWeatherTable";
import { GpxModelBadges } from "./GpxModelBadges";
import { DEFAULT_POI_RADIUS_M, simplifyPoints } from "@/components/planner/MapLayers";
import { RoadProfileBarChart, type RoadDimension } from "@/components/planner/RoadProfile";

type RoadHighlight = { dimension: RoadDimension; category: string } | null;

type ModelOverride = Record<string, {
  temp: number | null; prcp: number | null;
  wspd: number | null; wdir: number | null; cloud: number | null;
}>;

// Nearest-hour lookup for route/pass points, mirrors _nearest_gpx_hour_key in api_app.py
const GPX_HOUR_STEPS = [0, 6, 12, 18];
function hourFracFromIso(iso: string): number {
  const [hh, mm] = iso.slice(11, 16).split(":").map(Number);
  return hh + mm / 60;
}
function nearestGpxHourKey(hourFrac: number): string {
  return String(GPX_HOUR_STEPS.reduce((best, h) =>
    Math.abs(hourFrac - h) < Math.abs(hourFrac - best) ? h : best
  ));
}

export function GpxResultsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const t = useT();
  const [results, setResults] = useState<GpxJobResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentPois, setCurrentPois] = useState<MapPoi[]>([]);
  const [currentPoiRadiusM, setCurrentPoiRadiusM] = useState(DEFAULT_POI_RADIUS_M);
  const [highlightSegment, setHighlightSegment] = useState<RoutePlannerPoint[] | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const handlePoisChange = useCallback((pois: MapPoi[]) => setCurrentPois(pois), []);
  const handlePoiRadiusChange = useCallback((radiusM: number) => setCurrentPoiRadiusM(radiusM), []);
  const [forecastFallbackStatus, setForecastFallbackStatus] = useState<"idle" | "loading" | "failed">("idle");
  const [offlineFromCache, setOfflineFromCache] = useState(false);
  const fallbackStarted = useRef(false);

  // Model switching state
  const [selectedModel, setSelectedModel] = useState("best_match");
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelCache, setModelCache] = useState<Record<string, ModelOverride>>({});

  // Surface / road-type profile tabs
  const [activeTab, setActiveTab] = useState("map");
  const [roadInfo, setRoadInfo] = useState<RoadInfoResult | null>(null);
  const [roadInfoLoading, setRoadInfoLoading] = useState(false);
  const roadInfoSigRef = useRef<string | null>(null);
  const [roadHighlight, setRoadHighlight] = useState<RoadHighlight>(null);

  function handleTabChange(tab: string) {
    setActiveTab(tab);
    setRoadHighlight(null);
  }

  function handleSelectRoadCategory(dimension: RoadDimension, category: string | null) {
    setRoadHighlight(category ? { dimension, category } : null);
  }

  useEffect(() => {
    if (!jobId) return;
    fallbackStarted.current = false;
    setForecastFallbackStatus("idle");
    setIsSaved(false);
    setOfflineFromCache(false);

    async function loadFromCacheOrFail(fallbackMessage: string) {
      const cached = await getCachedJobResult<GpxJobResults>(jobId!, "gpx").catch(() => undefined);
      if (cached) {
        setResults(cached.data);
        setOfflineFromCache(true);
      } else {
        setError(fallbackMessage);
      }
    }

    if (!navigator.onLine) {
      loadFromCacheOrFail(t.results.loadFailed);
      return;
    }
    getGpxResults(jobId)
      .then((data) => {
        setResults(data);
        cacheJobResult(jobId, "gpx", data).catch(() => {});
      })
      .catch((e: Error) => loadFromCacheOrFail(e.message));
  }, [jobId]);

  async function handleSave() {
    if (!jobId || !results || isSaved || isSaving) return;
    setIsSaving(true);
    try {
      const name = `${results.startDate} · ${results.totalKm} km`;
      await saveRoute(jobId, name, null, currentPois);
      setIsSaved(true);
    } catch {
      toast.error(t.results.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  function handleDownloadGpx() {
    if (!results) return;
    downloadGpx(coords, `weatherroute-${results.startDate || "route"}`, currentPois);
  }

  // Server couldn't reach Open-Meteo (e.g. rate-limited outbound IP) - fetch
  // the missing points directly from the browser instead and patch them in.
  useEffect(() => {
    if (!results || results.forecastError !== CLIENT_FALLBACK_NEEDED || fallbackStarted.current) return;
    fallbackStarted.current = true;
    setForecastFallbackStatus("loading");

    async function runFallback() {
      const current = results!;
      const pending = current.weatherPoints
        .map((wp, idx) => ({ wp, idx }))
        .filter((p) => p.wp.forecastPending);
      const stopPending = pending.filter((p) => p.wp.type === "stop");
      const routePending = pending.filter((p) => p.wp.type !== "stop");
      const patched = [...current.weatherPoints];
      let ok = pending.length === 0;

      try {
        if (routePending.length > 0) {
          const points = routePending.map((p) => ({
            lat: p.wp.lat, lon: p.wp.lon, ele: p.wp.ele,
            target_date: p.wp.arrivalTime.slice(0, 10),
          }));
          const data = await fetchForecastViaBrowser(points, selectedModel);
          routePending.forEach((p, i) => {
            const pdata = data[String(i)];
            if (pdata?.ok) {
              const hourKey = nearestGpxHourKey(hourFracFromIso(p.wp.arrivalTime));
              const h = pdata.hourly?.[hourKey];
              if (h) {
                patched[p.idx] = {
                  ...patched[p.idx],
                  temp: h.temp, prcp: h.prcp, wspd: h.wspd, wdir: h.wdir, cloud: h.cloud,
                  forecastPending: false,
                };
              }
            }
          });
          ok = true;
        }
        if (stopPending.length > 0) {
          const stops = stopPending.map((p) => ({
            lat: p.wp.lat, lon: p.wp.lon, ele: p.wp.ele,
            stopTime: p.wp.stopTime!, nextStartTime: p.wp.nextStartTime!,
          }));
          const stopResults = await fetchGpxStopsViaBrowser(stops);
          stopPending.forEach((p, i) => {
            const sr = stopResults[i];
            if (sr) {
              patched[p.idx] = {
                ...patched[p.idx],
                temp: sr.temp, prcp: sr.prcp, wspd: sr.wspd,
                nightData: sr.nightData, nightLow: sr.nightLow,
                forecastPending: false,
              };
            }
          });
          ok = true;
        }
      } catch (e) {
        console.error("GPX client-side forecast fallback failed:", e);
        ok = false;
      }

      if (ok) {
        setResults({ ...current, weatherPoints: patched, forecastError: null });
        setForecastFallbackStatus("idle");
      } else {
        setForecastFallbackStatus("failed");
      }
    }

    runFallback();
  }, [results, selectedModel]);

  const coords = useMemo<RoutePlannerPoint[]>(
    () => results?.trackPoints.map(([lat, lon]) => ({ lat, lon })) ?? [],
    [results]
  );

  // Merge model overrides into weather points
  const activeWeatherPoints = useMemo<GpxWeatherPoint[]>(() => {
    if (!results) return [];
    const overrides = modelCache[selectedModel];
    if (!overrides) return results.weatherPoints;
    return results.weatherPoints.map((wp, idx) => {
      const ov = overrides[String(idx)];
      return ov ? { ...wp, ...ov } : wp;
    });
  }, [results, selectedModel, modelCache]);

  // Forecast km range (for zone bar)
  const forecastRange = useMemo(() => {
    if (!results) return null;
    const pts = results.weatherPoints.filter((wp) => wp.isForecast);
    if (!pts.length) return null;
    return { start: pts[0].km, end: pts[pts.length - 1].km };
  }, [results]);

  // Surface/road-type profile data: fetched lazily once the elevation tab is
  // opened (one Overpass query covers both dimensions), mirroring the same
  // fetch pattern used by RoutePlannerPage.
  const needRoadInfo = activeTab === "elevation";
  useEffect(() => {
    if (!needRoadInfo || !results || results.trackPoints.length < 2) return;
    const simplified = simplifyPoints(
      results.trackPoints.map(([lat, lon]) => ({ lat, lon })),
      2000
    );
    const sig = JSON.stringify(simplified);
    if (sig === roadInfoSigRef.current) return;
    const controller = new AbortController();
    let cancelled = false;
    roadInfoSigRef.current = sig;
    setRoadInfoLoading(true);
    fetchRoadInfo(simplified, controller.signal)
      .then((result) => {
        if (!cancelled) setRoadInfo(result);
      })
      .catch(() => {
        if (roadInfoSigRef.current === sig) roadInfoSigRef.current = null;
        if (!cancelled) toast.error(t.routePlanner.layers.roadInfoError);
      })
      .finally(() => {
        if (!cancelled) setRoadInfoLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needRoadInfo, results]);

  async function handleSelectModel(model: string) {
    if (modelLoading || model === selectedModel || !jobId) return;
    if (modelCache[model]) {
      setSelectedModel(model);
      return;
    }
    setModelLoading(true);
    setPendingModel(model);
    try {
      const data = await getGpxModelForecast(jobId, model);
      setModelCache((prev) => ({ ...prev, [model]: data.weatherPointUpdates }));
      setSelectedModel(model);
    } catch (e) {
      if (e instanceof Error && e.message === CLIENT_FALLBACK_NEEDED && results) {
        try {
          const routePts = results.weatherPoints
            .map((wp, idx) => ({ wp, idx }))
            .filter((p) => p.wp.isForecast && p.wp.type !== "stop");
          const points = routePts.map((p) => ({
            lat: p.wp.lat, lon: p.wp.lon, ele: p.wp.ele,
            target_date: p.wp.arrivalTime.slice(0, 10),
          }));
          const data = await fetchForecastViaBrowser(points, model);
          const overrides: ModelOverride = {};
          routePts.forEach((p, i) => {
            const pdata = data[String(i)];
            if (pdata?.ok) {
              const hourKey = nearestGpxHourKey(hourFracFromIso(p.wp.arrivalTime));
              const h = pdata.hourly?.[hourKey];
              if (h) overrides[String(p.idx)] = { temp: h.temp, prcp: h.prcp, wspd: h.wspd, wdir: h.wdir, cloud: h.cloud };
            }
          });
          setModelCache((prev) => ({ ...prev, [model]: overrides }));
          setSelectedModel(model);
        } catch (e2) {
          console.error("GPX model forecast fallback failed:", e2);
        }
      } else {
        console.error("GPX model forecast error:", e);
      }
    } finally {
      setModelLoading(false);
      setPendingModel(null);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <Alert variant="destructive">
          <AlertDescription>
            {t.results.loadFailed}: {error}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-64 rounded-xl" />
        <Skeleton className="h-[400px] w-full rounded-3xl" />
      </div>
    );
  }

  const { elevation } = results;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      {offlineFromCache && (
        <div aria-live="polite" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
          {t.results.offlineShowingCached}
        </div>
      )}
      {forecastFallbackStatus === "loading" && (
        <div aria-live="polite" className="rounded-lg border border-chart-1/30 bg-chart-1/10 px-3 py-2 text-xs text-foreground">
          {t.results.forecastFallbackLoading}
        </div>
      )}
      {forecastFallbackStatus === "failed" && (
        <Alert variant="destructive">
          <AlertDescription>{t.results.forecastFallbackFailed}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">{t.gpx.results.totalKm}: </span>
          <span className="font-semibold">{results.totalKm} km</span>
        </div>
        {elevation && (
          <>
            <div>
              <span className="text-muted-foreground">{t.gpx.results.ascent}: </span>
              <span className="font-semibold">↑{elevation.totalAscent} m</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t.gpx.results.descent}: </span>
              <span className="font-semibold">↓{elevation.totalDescent} m</span>
            </div>
          </>
        )}
        <div>
          <span className="text-muted-foreground">{t.gpx.startDate}: </span>
          <span className="font-semibold">
            {results.startDate} {results.startTime}
          </span>
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant={isSaved ? "outline" : "secondary"}
            onClick={handleSave}
            disabled={isSaving || isSaved}
            className="gap-1"
          >
            {isSaved ? (
              <><BookmarkCheck className="h-4 w-4" />{t.results.saved}</>
            ) : (
              <><Bookmark className="h-4 w-4" />{isSaving ? "..." : t.results.save}</>
            )}
          </Button>
          <Button size="sm" variant="secondary" onClick={handleDownloadGpx} className="gap-1">
            <Download className="h-4 w-4" />
            {t.routePlanner.downloadGpx}
          </Button>
        </div>
      </div>

      <RouteSplitControl
        coords={coords}
        totalKm={results.totalKm}
        dailyKm={results.dailyConfigs.map((c) => c.dailyKm)}
        pois={currentPois}
        poiRadiusM={currentPoiRadiusM}
        namePrefix={`weatherroute-${results.startDate || "route"}`}
        onSelectedSegmentChange={(seg) => setHighlightSegment(seg?.coords ?? null)}
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex flex-wrap items-center gap-2">
          <TabsList className="justify-start">
            <TabsTrigger value="map">{t.gpx.results.tabMap}</TabsTrigger>
            <TabsTrigger value="elevation">{t.gpx.results.tabElevation}</TabsTrigger>
            <TabsTrigger value="temperature">{t.gpx.results.tabTemperature}</TabsTrigger>
            <TabsTrigger value="weather">{t.gpx.results.tabWeather}</TabsTrigger>
          </TabsList>
          {forecastRange && (
            <div className="ml-auto shrink-0">
              <GpxModelBadges
                selectedModel={selectedModel}
                pendingModel={pendingModel}
                modelLoading={modelLoading}
                onSelect={handleSelectModel}
                totalKm={results.totalKm}
                forecastKmStart={forecastRange.start}
                forecastKmEnd={forecastRange.end}
              />
            </div>
          )}
        </div>

        <TabsContent value="map">
          <GpxRouteMap
            results={{ ...results, weatherPoints: activeWeatherPoints }}
            roadInfo={roadInfo}
            roadHighlight={roadHighlight}
            onPoisChange={handlePoisChange}
            onPoiRadiusChange={handlePoiRadiusChange}
            highlightSegment={highlightSegment}
          />
        </TabsContent>

        <TabsContent value="elevation">
          <Card>
            <CardContent className="space-y-5 pt-4">
              {elevation ? (
                <GpxElevationChart
                  elevation={elevation}
                  weatherPoints={activeWeatherPoints}
                  dailyConfigs={results.dailyConfigs}
                  startDate={results.startDate}
                />
              ) : (
                <p className="text-muted-foreground">{t.results.elevationLoading}</p>
              )}
              <div>
                <p className="mb-2 text-sm font-semibold">{t.gpx.results.tabSurface}</p>
                <RoadProfileBarChart
                  samples={roadInfo?.samples}
                  dimension="surface"
                  selected={roadHighlight?.dimension === "surface" ? roadHighlight.category : null}
                  onSelect={(category) => handleSelectRoadCategory("surface", category)}
                  loading={roadInfoLoading}
                />
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold">{t.gpx.results.tabRoadType}</p>
                <RoadProfileBarChart
                  samples={roadInfo?.samples}
                  dimension="highway"
                  selected={roadHighlight?.dimension === "highway" ? roadHighlight.category : null}
                  onSelect={(category) => handleSelectRoadCategory("highway", category)}
                  loading={roadInfoLoading}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="temperature">
          <Card>
            <CardContent className="pt-4">
              {elevation ? (
                <GpxTemperatureChart
                  elevation={elevation}
                  weatherPoints={activeWeatherPoints}
                  dailyConfigs={results.dailyConfigs}
                  startDate={results.startDate}
                />
              ) : (
                <p className="text-muted-foreground">{t.results.elevationLoading}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="weather">
          <GpxWeatherTable weatherPoints={activeWeatherPoints} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
