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
import { MONTHS, monthDayToDayOfYear } from "@/utils/constants";
import type { CitySearchResult } from "@/api/types";

export function PlannerPage() {
  const store = usePlannerStore();
  const setJobId = useJobStore((s) => s.setJobId);
  const navigate = useNavigate();
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [startMonth, setStartMonth] = useState("4");
  const [startDay, setStartDay] = useState("15");

  function validate(): string[] {
    const errs: string[] = [];
    const validCities = store.cities.filter((c) => c.id);
    if (validCities.length < 1) {
      errs.push("Add at least one city to your route.");
    }
    if (store.desiredNightTemp > store.desiredDayTemp) {
      errs.push("Desired night temperature must not exceed day temperature.");
    }
    if (store.dayTempMin > store.dayTempMax) {
      errs.push("Day temperature minimum must not exceed maximum.");
    }
    if (store.nightTempMin > store.nightTempMax) {
      errs.push("Night temperature minimum must not exceed maximum.");
    }
    for (const conn of store.connections) {
      if (!conn.fromId || !conn.toId) {
        errs.push("All connections must have both from and to cities.");
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
      setErrors([err instanceof Error ? err.message : "Submission failed"]);
    } finally {
      setSubmitting(false);
    }
  }

  const daysInMonth = new Date(2025, parseInt(startMonth), 0).getDate();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Validation Error</AlertTitle>
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
            Route
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CityList />

          <div className="space-y-2">
            <Label>Start city (optional)</Label>
            <CityCombobox
              value={store.startCity}
              onSelect={(c: CitySearchResult) => store.setStartCity(c.name)}
              placeholder="Auto-detect start city..."
              className="w-full"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Switch
                checked={store.autoDetectStart}
                onCheckedChange={store.setAutoDetectStart}
              />
              <Label>Auto-detect best start date</Label>
            </div>

            {!store.autoDetectStart && (
              <div className="flex items-center gap-2">
                <Select value={startMonth} onValueChange={setStartMonth}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
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
          {submitting ? "Submitting..." : "Calculate Route"}
        </ShimmerButton>
      </div>
    </div>
  );
}
