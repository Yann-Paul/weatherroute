import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Map, Mountain, CloudSun, List } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ResultsHeader } from "./ResultsHeader";
import { RouteMap } from "./RouteMap";
import { ElevationChart } from "./ElevationChart";
import { WeatherGrid } from "./WeatherGrid";
import { RouteList } from "./RouteList";
import { useResultsStore } from "@/stores/resultsStore";
import { getJobResults } from "@/api/client";

export function ResultsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { setResults, activeTab, setActiveTab, route } = useResultsStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    async function fetchResults() {
      try {
        const data = await getJobResults(jobId!);
        setResults(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load results");
      } finally {
        setLoading(false);
      }
    }

    fetchResults();
  }, [jobId, setResults]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <Skeleton className="h-16 w-full rounded-3xl" />
        <Skeleton className="h-[500px] w-full rounded-3xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-16">
      <ResultsHeader />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="map" className="gap-1.5">
            <Map className="h-4 w-4" />
            Map
          </TabsTrigger>
          <TabsTrigger value="elevation" className="gap-1.5">
            <Mountain className="h-4 w-4" />
            Elevation
          </TabsTrigger>
          <TabsTrigger value="weather" className="gap-1.5">
            <CloudSun className="h-4 w-4" />
            Weather
          </TabsTrigger>
          <TabsTrigger value="route" className="gap-1.5">
            <List className="h-4 w-4" />
            Route
          </TabsTrigger>
        </TabsList>

        <TabsContent value="map">
          <RouteMap />
        </TabsContent>

        <TabsContent value="elevation" forceMount className="data-[state=inactive]:hidden">
          <ElevationChart />
        </TabsContent>

        <TabsContent value="weather">
          <WeatherGrid />
        </TabsContent>

        <TabsContent value="route">
          <RouteList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
