import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { getGpxResults } from "@/api/client";
import type { GpxJobResults } from "@/api/types";
import { useT } from "@/i18n/useT";
import { GpxRouteMap } from "./GpxRouteMap";
import { GpxElevationChart } from "./GpxElevationChart";
import { GpxTemperatureChart } from "./GpxTemperatureChart";
import { GpxWeatherTable } from "./GpxWeatherTable";

export function GpxResultsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const t = useT();
  const [results, setResults] = useState<GpxJobResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    getGpxResults(jobId)
      .then(setResults)
      .catch((e: Error) => setError(e.message));
  }, [jobId]);

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
        <TabsList className="w-full justify-start">
          <TabsTrigger value="map">{t.gpx.results.tabMap}</TabsTrigger>
          <TabsTrigger value="elevation">{t.gpx.results.tabElevation}</TabsTrigger>
          <TabsTrigger value="temperature">{t.gpx.results.tabTemperature}</TabsTrigger>
          <TabsTrigger value="weather">{t.gpx.results.tabWeather}</TabsTrigger>
        </TabsList>

        <TabsContent value="map">
          <GpxRouteMap results={results} />
        </TabsContent>

        <TabsContent value="elevation">
          <Card>
            <CardContent className="pt-4">
              {elevation ? (
                <GpxElevationChart
                  elevation={elevation}
                  weatherPoints={results.weatherPoints}
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
                  weatherPoints={results.weatherPoints}
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
          <GpxWeatherTable weatherPoints={results.weatherPoints} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
