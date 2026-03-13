import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { Map, Mountain, CloudSun, List, Bookmark, BookmarkCheck, SlidersHorizontal } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ResultsHeader } from "./ResultsHeader";
import { ForecastMap } from "./ForecastMap";
import { ElevationChart } from "./ElevationChart";
import { WeatherGrid } from "./WeatherGrid";
import { RouteList } from "./RouteList";
import { useResultsStore } from "@/stores/resultsStore";
import { usePlannerStore } from "@/stores/plannerStore";
import { getJobResults, getJobStatus, saveRoute } from "@/api/client";
import { useT } from "@/i18n/useT";
import { useLangStore } from "@/i18n/store";
import { dayOfYearToDate } from "@/utils/constants";
import type { JobResults } from "@/api/types";

function buildRouteName(results: JobResults, lang: "de" | "en"): string {
  const cities = results.route.map((s) => s.cityName);
  const stopsLabel = lang === "de" ? "Haltepunkte" : "stops";
  const label =
    cities.length <= 4
      ? cities.join(" → ")
      : `${cities[0]} → ... → ${cities[cities.length - 1]} (${cities.length} ${stopsLabel})`;
  const locale = lang === "de" ? "de-DE" : "en-US";
  const dateStr = dayOfYearToDate(results.startDay, undefined, locale);
  return `${label}, ${dateStr}`;
}

export function ResultsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { setResults, updateElevation, activeTab, setActiveTab } = useResultsStore();
  const elevationComplete = useResultsStore((s) => s.elevationComplete);
  const route = useResultsStore((s) => s.route);
  const startDay = useResultsStore((s) => s.startDay);
  const loadFromResults = usePlannerStore((s) => s.loadFromResults);
  const plannerStore = usePlannerStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [forecastUpdating, setForecastUpdating] = useState(false);
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const elevPollingRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const forecastPollingRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!jobId) return;

    async function fetchResults() {
      try {
        const data = await getJobResults(jobId!);
        setResults(data);
        // Check if forecast is still being refreshed (restored route)
        const status = await getJobStatus(jobId!);
        if (status.status !== "done") {
          setForecastUpdating(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t.results.loadFailed);
      } finally {
        setLoading(false);
      }
    }

    fetchResults();
  }, [jobId, setResults]);

  // Poll for forecast refresh (when restoring saved routes)
  useEffect(() => {
    if (!forecastUpdating || !jobId) return;

    async function pollForecast() {
      try {
        const status = await getJobStatus(jobId!);
        if (status.status === "done") {
          const data = await getJobResults(jobId!);
          setResults(data);
          setForecastUpdating(false);
        } else {
          forecastPollingRef.current = setTimeout(pollForecast, 2000);
        }
      } catch {
        forecastPollingRef.current = setTimeout(pollForecast, 5000);
      }
    }

    forecastPollingRef.current = setTimeout(pollForecast, 2000);
    return () => { if (forecastPollingRef.current) clearTimeout(forecastPollingRef.current); };
  }, [forecastUpdating, jobId, setResults]);

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

  function handleEditSettings() {
    loadFromResults({ startDay });
    navigate("/");
  }

  async function handleSave() {
    if (!jobId || isSaved || isSaving) return;
    setIsSaving(true);
    try {
      const name = buildRouteName({ route, startDay } as unknown as JobResults, lang);
      const plannerSettings = {
        cities: plannerStore.cities,
        startCity: plannerStore.startCity,
        startDay,  // use the actual computed start day from results
        autoDetectStart: false,
        connections: plannerStore.connections,
        desiredDayTemp: plannerStore.desiredDayTemp,
        desiredNightTemp: plannerStore.desiredNightTemp,
        dayTempMin: plannerStore.dayTempMin,
        dayTempMax: plannerStore.dayTempMax,
        nightTempMin: plannerStore.nightTempMin,
        nightTempMax: plannerStore.nightTempMax,
        warmingFactor: plannerStore.warmingFactor,
        tempWeight: plannerStore.tempWeight,
        maxDailyKm: plannerStore.maxDailyKm,
        maxTravelDays: plannerStore.maxTravelDays,
        elevResolution: plannerStore.elevResolution,
        blockedCountries: plannerStore.blockedCountries,
        sortedInput: plannerStore.sortedInput,
        directOsrm: plannerStore.directOsrm,
      };
      await saveRoute(jobId, name, plannerSettings);
      setIsSaved(true);
    } finally {
      setIsSaving(false);
    }
  }

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
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <ResultsHeader />
        </div>
        <div className="mt-1 flex shrink-0 gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleEditSettings}
            className="gap-1.5"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {t.results.editSettings}
          </Button>
          <Button
            variant={isSaved ? "outline" : "secondary"}
            size="sm"
            onClick={handleSave}
            disabled={isSaving || isSaved}
            className="gap-1.5"
          >
            {isSaved ? (
              <><BookmarkCheck className="h-4 w-4" />{t.results.saved}</>
            ) : (
              <><Bookmark className="h-4 w-4" />{isSaving ? "..." : t.results.save}</>
            )}
          </Button>
        </div>
      </div>

      {forecastUpdating && (
        <div className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-foreground">
          {t.results.forecastUpdating}
        </div>
      )}

      {elevationComplete === false && (
        <div className="rounded-lg border border-chart-1/30 bg-chart-1/10 px-3 py-2 text-xs text-foreground">
          {t.results.elevationLoading}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="map" className="gap-1.5">
            <Map className="h-4 w-4" />
            {t.results.tabMap}
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
          <ForecastMap />
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
      </Tabs>
    </div>
  );
}
