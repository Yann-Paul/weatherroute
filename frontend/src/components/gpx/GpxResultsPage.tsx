import { useEffect, useState, useMemo } from "react";
import { useParams } from "react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { getGpxResults, getGpxModelForecast } from "@/api/client";
import type { GpxJobResults, GpxWeatherPoint } from "@/api/types";
import { useT } from "@/i18n/useT";
import { GpxRouteMap } from "./GpxRouteMap";
import { GpxElevationChart } from "./GpxElevationChart";
import { GpxTemperatureChart } from "./GpxTemperatureChart";
import { GpxWeatherTable } from "./GpxWeatherTable";
import { GpxModelBadges } from "./GpxModelBadges";

type ModelOverride = Record<string, {
  temp: number | null; prcp: number | null;
  wspd: number | null; wdir: number | null; cloud: number | null;
}>;

export function GpxResultsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const t = useT();
  const [results, setResults] = useState<GpxJobResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Model switching state
  const [selectedModel, setSelectedModel] = useState("best_match");
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelCache, setModelCache] = useState<Record<string, ModelOverride>>({});

  useEffect(() => {
    if (!jobId) return;
    getGpxResults(jobId)
      .then(setResults)
      .catch((e: Error) => setError(e.message));
  }, [jobId]);

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
      console.error("GPX model forecast error:", e);
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
      </div>

      <Tabs defaultValue="map">
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
          <GpxRouteMap results={{ ...results, weatherPoints: activeWeatherPoints }} />
        </TabsContent>

        <TabsContent value="elevation">
          <Card>
            <CardContent className="pt-4">
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
