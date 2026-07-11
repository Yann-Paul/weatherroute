import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { Map, Mountain, Thermometer, CloudSun, List, Bookmark, BookmarkCheck, SlidersHorizontal } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ResultsHeader } from "./ResultsHeader";
import { ForecastMap } from "./ForecastMap";
import { ElevationChart } from "./ElevationChart";
import { TemperatureChart } from "./TemperatureChart";
import { WeatherGrid } from "./WeatherGrid";
import { RouteList } from "./RouteList";
import { ModelBadges } from "./ModelBadges";
import { useResultsStore } from "@/stores/resultsStore";
import { usePlannerStore } from "@/stores/plannerStore";
import { getJobResults, getJobStatus, saveRoute } from "@/api/client";
import { toast } from "sonner";
import { useT } from "@/i18n/useT";
import { useLangStore } from "@/i18n/store";
import { dayOfYearToDate } from "@/utils/constants";
import type { JobResults } from "@/api/types";
import { CLIENT_FALLBACK_NEEDED } from "@/api/types";

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
  const { setResults, updateElevation, activeTab, setActiveTab, setJobId, retryForecastViaBrowser } = useResultsStore();
  const elevationComplete = useResultsStore((s) => s.elevationComplete);
  const forecast = useResultsStore((s) => s.forecast);
  const forecastError = useResultsStore((s) => s.forecastError);
  const forecastFallbackStatus = useResultsStore((s) => s.forecastFallbackStatus);
  const elevation = useResultsStore((s) => s.elevation);
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
        setJobId(jobId!);
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

  // Server couldn't reach Open-Meteo (e.g. rate-limited outbound IP) - fetch
  // the forecast directly from the browser instead and hand the raw result
  // back to the backend to be parsed the same way as a normal fetch.
  useEffect(() => {
    if (forecastError === CLIENT_FALLBACK_NEEDED && forecastFallbackStatus === "idle") {
      retryForecastViaBrowser();
    }
  }, [forecastError, forecastFallbackStatus, retryForecastViaBrowser]);

  // Poll for forecast refresh (when restoring saved routes)
  useEffect(() => {
    if (!forecastUpdating || !jobId) return;

    async function pollForecast() {
      try {
        const status = await getJobStatus(jobId!);
        if (status.status === "done") {
          const data = await getJobResults(jobId!);
          setResults(data);
          setJobId(jobId!);
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
        distanceWeight: plannerStore.distanceWeight,
        tempWeight: plannerStore.tempWeight,
        windWeight: plannerStore.windWeight,
        rainWeight: plannerStore.rainWeight,
        maxDailyKm: plannerStore.maxDailyKm,
        maxTravelDays: plannerStore.maxTravelDays,
        elevResolution: plannerStore.elevResolution,
        blockedCountries: plannerStore.blockedCountries,
        sortedInput: plannerStore.sortedInput,
        directOsrm: plannerStore.directOsrm,
      };
      await saveRoute(jobId, name, plannerSettings);
      setIsSaved(true);
    } catch {
      toast.error(t.results.saveFailed ?? "Could not save route.");
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    if (loading || !route.length) return;
    const cities = route.map((s) => s.cityName);
    const label =
      cities.length <= 3
        ? cities.join(" → ")
        : `${cities[0]} → ${cities[cities.length - 1]}`;
    document.title = `WeatherRoute — ${label}`;
    return () => { document.title = "WeatherRoute"; };
  }, [loading, route]);

  if (loading) {
    return (
      <div className="space-y-4 p-4" role="status" aria-label={t.results.loading}>
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
    <div className="space-y-2 p-2 pb-16 sm:space-y-4 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <ResultsHeader />
        </div>
        <div className="mt-1 flex shrink-0 gap-1.5">
          <Button
            variant="default"
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
        <div aria-live="polite" className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-foreground">
          {t.results.forecastUpdating}
        </div>
      )}

      {elevationComplete === false && (
        <div aria-live="polite" className="rounded-lg border border-chart-1/30 bg-chart-1/10 px-3 py-2 text-xs text-foreground">
          {t.results.elevationLoading}
        </div>
      )}

      {forecastError === CLIENT_FALLBACK_NEEDED && forecastFallbackStatus === "loading" && (
        <div aria-live="polite" className="rounded-lg border border-chart-1/30 bg-chart-1/10 px-3 py-2 text-xs text-foreground">
          {t.results.forecastFallbackLoading}
        </div>
      )}

      {forecastFallbackStatus === "failed" && (
        <Alert variant="destructive">
          <AlertTitle>{t.results.errorTitle}</AlertTitle>
          <AlertDescription>{t.results.forecastFallbackFailed}</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-wrap items-center gap-2">
          <TabsList className="justify-start">
            <TabsTrigger value="map" className="gap-1.5" aria-label={t.results.tabMap}>
              <Map className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t.results.tabMap}</span>
            </TabsTrigger>
            <TabsTrigger value="elevation" className="gap-1.5" aria-label={t.results.tabElevation}>
              <Mountain className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t.results.tabElevation}</span>
            </TabsTrigger>
            <TabsTrigger value="temperature" className="gap-1.5" aria-label={t.results.tabTemperature}>
              <Thermometer className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t.results.tabTemperature}</span>
            </TabsTrigger>
            <TabsTrigger value="weather" className="gap-1.5" aria-label={t.results.tabWeather}>
              <CloudSun className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t.results.tabWeather}</span>
            </TabsTrigger>
            <TabsTrigger value="route" className="gap-1.5" aria-label={t.results.tabRoute}>
              <List className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t.results.tabRoute}</span>
            </TabsTrigger>
          </TabsList>
          {forecast && (
            <div className="ml-auto shrink-0">
              <ModelBadges forecast={forecast} totalKm={elevation?.totalKm} />
            </div>
          )}
        </div>

        <TabsContent value="map">
          <ForecastMap />
        </TabsContent>

        <TabsContent value="elevation">
          <ElevationChart />
        </TabsContent>

        <TabsContent value="temperature">
          <TemperatureChart />
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
