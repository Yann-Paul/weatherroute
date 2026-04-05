import { useState, useEffect } from "react";
import { NumericInput } from "@/components/ui/numeric-input";
import { useNavigate } from "react-router";
import { Route as RouteIcon } from "lucide-react";
import { NewHereBanner } from "@/components/layout/NewHereBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShimmerButton } from "@/components/magicui/shimmer-button";
import { CityList } from "./CityList";
import { CityCombobox } from "./CityCombobox";
import { AdvancedPanel } from "./AdvancedPanel";
import { SavedRoutesList } from "./SavedRoutesList";
import { usePlannerStore } from "@/stores/plannerStore";
import { useJobStore } from "@/stores/jobStore";
import { submitJob, submitDestinationJob } from "@/api/client";
import { monthDayToDayOfYear } from "@/utils/constants";
import { useT } from "@/i18n/useT";
import { useLangStore } from "@/i18n/store";
import type { CitySearchResult } from "@/api/types";
import { Compass } from "lucide-react";

export function PlannerPage() {
  const store = usePlannerStore();
  const setJobId = useJobStore((s) => s.setJobId);
  const navigate = useNavigate();
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    document.title = lang === "de" ? "WeatherRoute — Route planen" : "WeatherRoute — Plan Route";
    return () => { document.title = "WeatherRoute"; };
  }, [lang]);
  const [submitting, setSubmitting] = useState(false);

  // Restore date from store if returning from results (loadFromResults sets startDay + autoDetectStart=false)
  const storedDate = !store.autoDetectStart && store.startDay != null
    ? new Date(new Date().getFullYear(), 0, store.startDay)
    : null;
  const [startMonth, setStartMonth] = useState(
    String(storedDate ? storedDate.getMonth() + 1 : new Date().getMonth() + 1)
  );
  const [startDay, setStartDay] = useState(
    String(storedDate ? storedDate.getDate() : new Date().getDate())
  );

  function validate(): string[] {
    const errs: string[] = [];
    if (store.mode === "destination") {
      if (!store.startCity) errs.push(t.planner.errors.noStartCity ?? "Startstadt ist erforderlich.");
      if (store.desiredNightTemp > store.desiredDayTemp) errs.push(t.planner.errors.nightExceedsDay);
      if (store.dayTempMin > store.dayTempMax) errs.push(t.planner.errors.dayTempRange);
      if (store.nightTempMin > store.nightTempMax) errs.push(t.planner.errors.nightTempRange);
    } else {
      const validCities = store.cities.filter((c) => c.id);
      if (validCities.length < 1) errs.push(t.planner.errors.minOneCity);
      if (store.desiredNightTemp > store.desiredDayTemp) errs.push(t.planner.errors.nightExceedsDay);
      if (store.dayTempMin > store.dayTempMax) errs.push(t.planner.errors.dayTempRange);
      if (store.nightTempMin > store.nightTempMax) errs.push(t.planner.errors.nightTempRange);
      for (const conn of store.connections) {
        if (!conn.fromId || !conn.toId) {
          errs.push(t.planner.errors.incompleteConnection);
          break;
        }
      }
    }
    return errs;
  }

  async function handleSubmit() {
    const errs = validate();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setSubmitting(true);

    try {
      const computedStartDay = monthDayToDayOfYear(parseInt(startMonth), parseInt(startDay));

      if (store.mode === "destination") {
        const { jobId } = await submitDestinationJob({
          startCity: store.startCity,
          startDay: computedStartDay,
          desiredDayTemp: store.desiredDayTemp,
          desiredNightTemp: store.desiredNightTemp,
          dayTempMin: store.dayTempMin,
          dayTempMax: store.dayTempMax,
          nightTempMin: store.nightTempMin,
          nightTempMax: store.nightTempMax,
          warmingFactor: store.warmingFactor,
          tempWeight: store.tempWeight,
          windWeight: store.windWeight,
          rainWeight: store.rainWeight,
          maxDailyKm: store.maxDailyKm,
          maxTravelDays: store.maxTravelDays,
          elevResolution: store.elevResolution,
          blockedCountries: store.blockedCountries,
          routingMode: store.routingMode,
          brouterProfile: store.brouterProfile,
          algorithm: store.destinationAlgorithm,
        });
        setJobId(jobId);
        navigate(`/progress/${jobId}`);
      } else {
        const { jobId } = await submitJob({
          ...store,
          startDay: store.autoDetectStart ? null : computedStartDay,
          cities: store.cities.filter((c) => c.id),
          connections: store.connections.filter((c) => c.fromId && c.toId),
          routingMode: store.routingMode,
          brouterProfile: store.brouterProfile,
        });
        setJobId(jobId);
        navigate(`/progress/${jobId}`);
      }
    } catch (err) {
      setErrors([err instanceof Error ? err.message : t.planner.errors.submissionFailed]);
    } finally {
      setSubmitting(false);
    }
  }

  const daysInMonth = new Date(new Date().getFullYear(), parseInt(startMonth), 0).getDate();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>{t.planner.validationError}</AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc space-y-1">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <NewHereBanner href="/wizard" />

      {/* Mode Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => store.setMode("route")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
            store.mode === "route"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          <RouteIcon className="h-4 w-4" />
          {t.planner.modeRoute ?? "Route planen"}
        </button>
        <button
          onClick={() => store.setMode("destination")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
            store.mode === "destination"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          <Compass className="h-4 w-4" />
          {t.planner.modeDestination ?? "Ziel finden"}
        </button>
      </div>

      {/* Route Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {store.mode === "destination" ? (
              <><Compass className="h-5 w-5 text-primary" />{t.planner.destinationHeading ?? "Ziel finden"}</>
            ) : (
              <><RouteIcon className="h-5 w-5 text-primary" />{t.planner.heading}</>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {store.mode === "route" && (
            <>
              <CityList />

              <div className="flex items-center gap-3">
                <Switch
                  id="sorted-input"
                  checked={store.sortedInput}
                  onCheckedChange={store.setSortedInput}
                />
                <Label htmlFor="sorted-input">{t.advanced.travel.sortedInput}</Label>
              </div>

              {/* Routing API selector */}
              <div className="space-y-3 rounded-xl border bg-card px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{t.planner.routingMode}</p>
                  <p className="text-xs text-muted-foreground">{t.planner.routingModeDesc}</p>
                </div>
                <Select value={store.routingMode} onValueChange={store.setRoutingMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="car">{t.planner.routingModes.car}</SelectItem>
                    <SelectItem value="brouter">{t.planner.routingModes.brouter}</SelectItem>
                  </SelectContent>
                </Select>
                {store.routingMode === "brouter" && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">{t.planner.brouterProfile}</p>
                    <Select value={store.brouterProfile} onValueChange={store.setBrouterProfile}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="trekking">{t.planner.brouterProfiles.trekking}</SelectItem>
                        <SelectItem value="fastbike">{t.planner.brouterProfiles.fastbike}</SelectItem>
                        <SelectItem value="mtb">{t.planner.brouterProfiles.mtb}</SelectItem>
                        <SelectItem value="safety">{t.planner.brouterProfiles.safety}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Direct route toggle */}
              <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
                <div>
                  <p className="text-sm font-medium" id="direct-osrm-label">{t.planner.directOsrm}</p>
                  <p className="text-xs text-muted-foreground">{t.planner.directOsrmDesc}</p>
                </div>
                <Switch
                  id="direct-osrm"
                  aria-labelledby="direct-osrm-label"
                  checked={store.directOsrm}
                  onCheckedChange={store.setDirectOsrm}
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label>{store.mode === "destination" ? (t.planner.startCityRequired ?? "Startstadt") : t.planner.startCity}</Label>
            <CityCombobox
              value={store.startCity}
              onSelect={(c: CitySearchResult) => store.setStartCity(c.name)}
              placeholder={store.mode === "destination" ? (t.planner.startCityRequiredPlaceholder ?? "Startstadt eingeben...") : t.planner.startCityPlaceholder}
              className="w-full"
            />
          </div>

          <div className="space-y-3">
            {store.mode === "route" && (
              <div className="flex items-center gap-3">
                <Switch
                  id="auto-detect-date"
                  checked={store.autoDetectStart}
                  onCheckedChange={store.setAutoDetectStart}
                />
                <Label htmlFor="auto-detect-date">{t.planner.autoDetectDate}</Label>
              </div>
            )}

            {(store.mode === "destination" || !store.autoDetectStart) && (
              <div className="flex items-center gap-2">
                <Select value={startMonth} onValueChange={setStartMonth}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {t.months.map((m, i) => (
                      <SelectItem key={i} value={String(i + 1)}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={startDay} onValueChange={setStartDay}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: daysInMonth }, (_, i) => (
                      <SelectItem key={i} value={String(i + 1)}>
                        {i + 1}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {store.mode === "destination" && (
            <>
              <div className="space-y-3 rounded-xl border bg-card px-4 py-3">
                <p className="text-sm font-medium">{t.planner.destinationTravelDays ?? "Reisetage"}</p>
                <NumericInput
                  min={1}
                  max={365}
                  value={store.maxTravelDays}
                  fallback={1}
                  onChange={(v) => store.setMaxTravelDays(v)}
                  className="w-24 rounded-md border bg-background px-3 py-1.5 text-sm"
                />
              </div>

              <div className="space-y-3 rounded-xl border bg-card px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{t.planner.destinationAlgorithm ?? "Suchalgorithmus"}</p>
                  <p className="text-xs text-muted-foreground">{t.planner.destinationAlgorithmDesc ?? ""}</p>
                </div>
                <Select value={store.destinationAlgorithm} onValueChange={store.setDestinationAlgorithm}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beam_search">{t.planner.destinationAlgorithms?.beam_search ?? "Beam-Search"}</SelectItem>
                    <SelectItem value="hierarchical">{t.planner.destinationAlgorithms?.hierarchical ?? "Hierarchische Wegpunktsuche"}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {store.destinationAlgorithm === "hierarchical"
                    ? t.planner.destinationAlgorithmDescs?.hierarchical
                    : t.planner.destinationAlgorithmDescs?.beam_search}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Advanced Settings */}
      <AdvancedPanel />

      {/* Submit */}
      <div className="flex justify-center pt-4">
        <ShimmerButton
          onClick={handleSubmit}
          disabled={submitting}
          className="px-8 py-3 text-base"
        >
          {submitting ? t.planner.submitting : (store.mode === "destination" ? (t.planner.submitDestination ?? "Ziel suchen") : t.planner.submit)}
        </ShimmerButton>
      </div>

      <SavedRoutesList />
    </div>
  );
}
