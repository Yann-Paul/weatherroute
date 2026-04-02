import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { MapPin, Route as RouteIcon, Layers, ArrowRight, Wind, CloudRain } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Map as MapView,
  MapControls,
  MapMarker,
  MapRoute,
  MarkerContent,
  MarkerPopup,
} from "@/components/ui/map";
import { getDestinationResults, submitDestinationDetailJob } from "@/api/client";
import { useJobStore } from "@/stores/jobStore";
import { usePlannerStore } from "@/stores/plannerStore";
import { useIsDark } from "@/stores/themeStore";
import { useLangStore } from "@/i18n/store";
import { dayOfYearToDate } from "@/utils/constants";
import { tempToRgb } from "@/utils/tempColor";
import type {
  DestinationJobResults,
  DestinationRoute,
  DestinationCity,
  DestinationRouteCity,
} from "@/api/types";


function TempBadge({ tmin, tmax, desired, isDark = true }: { tmin: number | null; tmax: number | null; desired: number; isDark?: boolean }) {
  if (tmin == null || tmax == null) return null;
  const avg = (tmin + tmax) / 2;
  const color = tempToRgb(avg, desired, isDark);
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono font-medium"
      style={{ background: color + "33", color }}>
      {tmin}° / {tmax}°
    </span>
  );
}

export function DestinationResultsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const setJobId = useJobStore((s) => s.setJobId);
  const plannerStore = usePlannerStore();
  const isDark = useIsDark();
  const lang = useLangStore((s) => s.lang);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DestinationJobResults | null>(null);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [detailLoading, setDetailLoading] = useState<number | null>(null);

  useEffect(() => {
    document.title = lang === "de" ? "WeatherRoute — Zielsuche" : "WeatherRoute — Destination Finder";
  }, [lang]);

  useEffect(() => {
    if (!jobId) return;
    (async () => {
      try {
        const data = await getDestinationResults(jobId);
        setResults(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load results");
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId]);

  async function handleDetailCalc(route: DestinationRoute) {
    setDetailLoading(route.routeIndex);
    try {
      const cityIds = route.cities.map((c) => c.cityId);
      const { jobId: newJobId } = await submitDestinationDetailJob({
        cityIds,
        startDay: route.startDay,
        desiredDayTemp: results!.desiredHigh,
        desiredNightTemp: results!.desiredLow,
        dayTempMin: plannerStore.dayTempMin,
        dayTempMax: plannerStore.dayTempMax,
        nightTempMin: plannerStore.nightTempMin,
        nightTempMax: plannerStore.nightTempMax,
        warmingFactor: plannerStore.warmingFactor,
        tempWeight: plannerStore.tempWeight,
        windWeight: plannerStore.windWeight,
        rainWeight: plannerStore.rainWeight,
        distanceWeight: plannerStore.distanceWeight,
        maxDailyKm: plannerStore.maxDailyKm,
        maxTravelDays: plannerStore.maxTravelDays,
        elevResolution: plannerStore.elevResolution,
        blockedCountries: plannerStore.blockedCountries,
        routingMode: plannerStore.routingMode,
        brouterProfile: plannerStore.brouterProfile,
      });
      setJobId(newJobId);
      navigate(`/progress/${newJobId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fehler");
    } finally {
      setDetailLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (error || !results) {
    return (
      <div className="mx-auto max-w-4xl p-4">
        <Alert variant="destructive">
          <AlertTitle>Fehler</AlertTitle>
          <AlertDescription>{error ?? "Keine Ergebnisse"}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const startDate = dayOfYearToDate(results.startDay, undefined, lang === "de" ? "de-DE" : "en-US");
  const route = results.routes[selectedRoute];

  // Map center: midpoint of selected route
  const mapCenter: [number, number] = route && route.cities.length > 0
    ? [
        route.cities[Math.floor(route.cities.length / 2)].lon,
        route.cities[Math.floor(route.cities.length / 2)].lat,
      ]
    : [10, 50];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">
          {lang === "de" ? "Zielsuche — Ergebnisse" : "Destination Finder — Results"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {lang === "de"
            ? `Start: ${startDate} · ${results.routes.length} Routen`
            : `Start: ${startDate} · ${results.routes.length} routes`}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Left column: route list + destinations */}
        <div className="space-y-3">
          {/* Route selector */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <RouteIcon className="h-4 w-4 text-primary" />
                {lang === "de" ? "Routen" : "Routes"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {results.routes.map((r: DestinationRoute, i: number) => (
                <button
                  key={i}
                  onClick={() => setSelectedRoute(i)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selectedRoute === i
                      ? "border-primary bg-primary/10"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Route {i + 1}</span>
                    <span className="text-xs text-muted-foreground">{r.totalDays}d · {Math.round(r.totalAirKm)} km</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.cities[0]?.cityName} → {r.cities[r.cities.length - 1]?.cityName}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Destination cities */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4 text-primary" />
                {lang === "de" ? "Zielregionen" : "Target Regions"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {results.destinations.map((dest: DestinationCity) => (
                <div key={dest.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-muted/40">
                  <div>
                    <p className="font-medium">{dest.name}</p>
                    <p className="text-muted-foreground">{Math.round(dest.distance)} km</p>
                  </div>
                  {dest.tmin != null && dest.tmax != null && (
                    <TempBadge tmin={dest.tmin} tmax={dest.tmax} desired={results.desiredHigh} isDark={isDark} />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right column: map + detail */}
        <div className="space-y-3">
          {/* Map */}
          <div className="h-[420px] overflow-hidden rounded-xl border">
            <MapView
              center={mapCenter}
              zoom={5}
              theme={isDark ? "dark" : "light"}
              className="h-full w-full"
            >
              <MapControls />

              {/* All routes as faint background lines */}
              {results.routes.map((r: DestinationRoute, ri: number) =>
                ri !== selectedRoute
                  ? r.segments.map((seg, si) => (
                      <MapRoute
                        key={`bg-${ri}-${si}`}
                        id={`bg-${ri}-${si}`}
                        coordinates={seg.coordinates as [number, number][]}
                        color={isDark ? "#444" : "#bbb"}
                        width={1.5}
                        opacity={0.4}
                        interactive={false}
                      />
                    ))
                  : null
              )}

              {/* Selected route segments (colored by score) */}
              {route?.segments.map((seg, si) => (
                <MapRoute
                  key={`sel-${si}`}
                  id={`sel-${si}`}
                  coordinates={seg.coordinates as [number, number][]}
                  color={seg.color}
                  width={3}
                  opacity={0.9}
                />
              ))}

              {/* Destination city markers (stars) */}
              {results.destinations.map((dest: DestinationCity) => (
                <MapMarker key={`dest-${dest.id}`} longitude={dest.lon} latitude={dest.lat}>
                  <MarkerContent>
                    <div
                      className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-yellow-400 bg-yellow-400/20 text-[10px] font-bold text-yellow-500"
                      title={dest.name}
                    >
                      ★
                    </div>
                  </MarkerContent>
                  <MarkerPopup>
                    <div className="min-w-[120px] p-2 text-xs">
                      <p className="font-semibold">{dest.name}</p>
                      {dest.tmin != null && <p>{dest.tmin}° / {dest.tmax}°</p>}
                      <p className="text-muted-foreground">{Math.round(dest.distance)} km</p>
                    </div>
                  </MarkerPopup>
                </MapMarker>
              ))}

              {/* City markers for selected route */}
              {route?.cities.map((city: DestinationRouteCity, ci: number) => {
                const isFirst = ci === 0;
                const isLast = ci === route.cities.length - 1;
                const avg = city.tmin != null && city.tmax != null ? (city.tmin + city.tmax) / 2 : null;
                const bg = avg != null ? tempToRgb(avg, results.desiredHigh, isDark) : "#888";
                return (
                  <MapMarker key={`city-${ci}`} longitude={city.lon} latitude={city.lat}>
                    <MarkerContent>
                      <div
                        className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-[9px] font-bold text-white shadow"
                        style={{ background: bg, borderColor: isFirst || isLast ? "#fff" : bg + "aa" }}
                      >
                        {Math.ceil(city.dayNumber)}
                      </div>
                    </MarkerContent>
                    <MarkerPopup>
                      <div className="min-w-[140px] space-y-0.5 p-2 text-xs">
                        <p className="font-semibold">{city.cityName}</p>
                        <p className="text-muted-foreground">{lang === "de" ? "Tag" : "Day"} {Math.ceil(city.dayNumber)}</p>
                        {city.tmin != null && <p>🌡 {city.tmin}° / {city.tmax}°</p>}
                        {city.prcp != null && <p className="flex items-center gap-1"><CloudRain className="h-3 w-3" />{city.prcp} mm</p>}
                        {city.wspd != null && <p className="flex items-center gap-1"><Wind className="h-3 w-3" />{city.wspd} km/h</p>}
                      </div>
                    </MarkerPopup>
                  </MapMarker>
                );
              })}
            </MapView>
          </div>

          {/* Selected route details */}
          {route && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Layers className="h-4 w-4 text-primary" />
                    Route {selectedRoute + 1} — {lang === "de" ? "Städte" : "Cities"}
                  </CardTitle>
                  <Button
                    size="sm"
                    onClick={() => handleDetailCalc(route)}
                    disabled={detailLoading === route.routeIndex}
                    className="gap-1.5"
                  >
                    {detailLoading === route.routeIndex ? (
                      lang === "de" ? "Wird berechnet…" : "Computing…"
                    ) : (
                      <>
                        {lang === "de" ? "Detailliert berechnen" : "Full calculation"}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {route.totalDays} {lang === "de" ? "Tage" : "days"} ·{" "}
                  ~{Math.round(route.totalAirKm)} km {lang === "de" ? "Luftlinie" : "air distance"} ·{" "}
                  Score: {route.score}
                </p>
              </CardHeader>
              <CardContent>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background text-left">
                      <tr className="border-b">
                        <th className="px-2 py-1.5 font-medium">{lang === "de" ? "Tag" : "Day"}</th>
                        <th className="px-2 py-1.5 font-medium">{lang === "de" ? "Stadt" : "City"}</th>
                        <th className="px-2 py-1.5 font-medium">Temp</th>
                        <th className="px-2 py-1.5 font-medium">
                          <CloudRain className="inline h-3.5 w-3.5" />
                        </th>
                        <th className="px-2 py-1.5 font-medium">
                          <Wind className="inline h-3.5 w-3.5" />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {route.cities.map((city: DestinationRouteCity, ci: number) => (
                        <tr
                          key={ci}
                          className={`border-b last:border-0 ${ci === 0 || ci === route.cities.length - 1 ? "bg-muted/30 font-medium" : ""}`}
                        >
                          <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{Math.ceil(city.dayNumber)}</td>
                          <td className="px-2 py-1.5">{city.cityName}</td>
                          <td className="px-2 py-1.5">
                            <TempBadge tmin={city.tmin} tmax={city.tmax} desired={results.desiredHigh} isDark={isDark} />
                          </td>
                          <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                            {city.prcp != null ? `${city.prcp}` : "—"}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                            {city.wspd != null ? `${city.wspd}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
