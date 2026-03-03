import { useState } from "react";
import { useNavigate } from "react-router";
import { Route as RouteIcon } from "lucide-react";
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
import { usePlannerStore } from "@/stores/plannerStore";
import { useJobStore } from "@/stores/jobStore";
import { submitJob } from "@/api/client";
import { monthDayToDayOfYear } from "@/utils/constants";
import { useT } from "@/i18n/useT";
import type { CitySearchResult } from "@/api/types";

export function PlannerPage() {
  const store = usePlannerStore();
  const setJobId = useJobStore((s) => s.setJobId);
  const navigate = useNavigate();
  const t = useT();
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [startMonth, setStartMonth] = useState(String(new Date().getMonth() + 1));
  const [startDay, setStartDay] = useState(String(new Date().getDate()));

  function validate(): string[] {
    const errs: string[] = [];
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
      const computedStartDay =
        store.autoDetectStart
          ? null
          : monthDayToDayOfYear(parseInt(startMonth), parseInt(startDay));

      const { jobId } = await submitJob({
        ...store,
        startDay: computedStartDay,
        cities: store.cities.filter((c) => c.id),
        connections: store.connections.filter((c) => c.fromId && c.toId),
      });
      setJobId(jobId);
      navigate(`/progress/${jobId}`);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : t.planner.errors.submissionFailed]);
    } finally {
      setSubmitting(false);
    }
  }

  const daysInMonth = new Date(2025, parseInt(startMonth), 0).getDate();

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

      {/* Route Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RouteIcon className="h-5 w-5 text-primary" />
            {t.planner.heading}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CityList />

          <div className="space-y-2">
            <Label>{t.planner.startCity}</Label>
            <CityCombobox
              value={store.startCity}
              onSelect={(c: CitySearchResult) => store.setStartCity(c.name)}
              placeholder={t.planner.startCityPlaceholder}
              className="w-full"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Switch
                checked={store.autoDetectStart}
                onCheckedChange={store.setAutoDetectStart}
              />
              <Label>{t.planner.autoDetectDate}</Label>
            </div>

            {!store.autoDetectStart && (
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
          {submitting ? t.planner.submitting : t.planner.submit}
        </ShimmerButton>
      </div>
    </div>
  );
}
