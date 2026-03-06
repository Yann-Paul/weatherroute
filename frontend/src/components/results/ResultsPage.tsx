import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { Map, Mountain, CloudSun, List, Radar } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ResultsHeader } from "./ResultsHeader";
import { RouteMap } from "./RouteMap";
import { ElevationChart } from "./ElevationChart";
import { WeatherGrid } from "./WeatherGrid";
import { RouteList } from "./RouteList";
import { ForecastMap } from "./ForecastMap";
import { useResultsStore } from "@/stores/resultsStore";
import { getJobResults, getJobStatus } from "@/api/client";
import { useT } from "@/i18n/useT";

export function ResultsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { setResults, updateElevation, activeTab, setActiveTab } = useResultsStore();
  const elevationComplete = useResultsStore((s) => s.elevationComplete);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const elevPollingRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!jobId) return;

    async function fetchResults() {
      try {
        const data = await getJobResults(jobId!);
        setResults(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.results.loadFailed);
      } finally {
        setLoading(false);
      }
    }

    fetchResults();
  }, [jobId, setResults]);

  useEffect(() => {
    if (!jobId || elevationComplete !== false) return;

    async function pollElevation() {
      try {
        const status = await getJobStatus(jobId!);
        if (status.status === "done") {
          const data = await getJobResults(jobId!);
          updateElevation({
            elevation: data.elevation,
            elevationError: data.elevationError,
            elevationComplete: data.elevationComplete,
          });
        } else {
          elevPollingRef.current = setTimeout(pollElevation, 2000);
        }
      } catch {
        elevPollingRef.current = setTimeout(pollElevation, 5000);
      }
    }

    elevPollingRef.current = setTimeout(pollElevation, 2000);
    return () => { if (elevPollingRef.current) clearTimeout(elevPollingRef.current); };
  }, [jobId, elevationComplete, updateElevation]);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-16 w-full rounded-3xl" />
        <Skeleton className="h-[500px] w-full rounded-3xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Alert variant="destructive">
          <AlertTitle>{t.results.errorTitle}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 pb-16">
      <ResultsHeader />

      {elevationComplete === false && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          {t.results.elevationLoading}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="map" className="gap-1.5">
            <Map className="h-4 w-4" />
            {t.results.tabMap}
          </TabsTrigger>
          <TabsTrigger value="forecast" className="gap-1.5">
            <Radar className="h-4 w-4" />
            {t.results.tabForecast}
          </TabsTrigger>
          <TabsTrigger value="elevation" className="gap-1.5">
            <Mountain className="h-4 w-4" />
            {t.results.tabElevation}
          </TabsTrigger>
          <TabsTrigger value="weather" className="gap-1.5">
            <CloudSun className="h-4 w-4" />
            {t.results.tabWeather}
          </TabsTrigger>
          <TabsTrigger value="route" className="gap-1.5">
            <List className="h-4 w-4" />
            {t.results.tabRoute}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="map">
          <RouteMap />
        </TabsContent>

        <TabsContent value="elevation">
          <ElevationChart />
        </TabsContent>

        <TabsContent value="weather">
          <WeatherGrid />
        </TabsContent>

        <TabsContent value="route">
          <RouteList />
        </TabsContent>

        <TabsContent value="forecast">
          <ForecastMap />
        </TabsContent>
      </Tabs>
    </div>
  );
}
