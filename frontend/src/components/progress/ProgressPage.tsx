import { useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { StepIndicator } from "./StepIndicator";
import { PreviewMap } from "./PreviewMap";
import { ErrorCityMap } from "./ErrorCityMap";
import { useJobStore } from "@/stores/jobStore";
import { getJobStatus } from "@/api/client";
import { useT } from "@/i18n/useT";
import { useLangStore } from "@/i18n/store";

type StepStatus = "waiting" | "active" | "done" | "error";

function getStepStatus(
  currentStep: string,
  targetStep: string,
  isError: boolean,
  stepOrder: string[]
): StepStatus {
  if (isError) {
    const currentIdx = stepOrder.indexOf(currentStep);
    const targetIdx = stepOrder.indexOf(targetStep);
    if (currentIdx === targetIdx) return "error";
    if (currentIdx > targetIdx) return "done";
    return "waiting";
  }
  const currentIdx = stepOrder.indexOf(currentStep);
  const targetIdx = stepOrder.indexOf(targetStep);
  if (currentIdx > targetIdx) return "done";
  if (currentIdx === targetIdx) return "active";
  return "waiting";
}

export function ProgressPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const job = useJobStore();
  const t = useT();
  const lang = useLangStore((s) => s.lang);

  useEffect(() => {
    document.title = lang === "de" ? "WeatherRoute — Wird berechnet…" : "WeatherRoute — Computing…";
  }, [lang]);

  // Keep refs so the polling closure always sees the latest values
  // without needing to restart the effect when they change.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const jobRef = useJobStore;          // stable store reference (Zustand selector)
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!jobId) return;

    // This flag is set to false when this effect is cleaned up (jobId changed or
    // component unmounted). Every await checks it so stale in-flight requests
    // are discarded instead of writing to the shared store.
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;

    async function doPoll() {
      if (!active) return;
      try {
        const data = await getJobStatus(jobId!);

        // Discard result if this poll session was cancelled while awaiting
        if (!active) return;

        retries = 0;
        jobRef.getState().updateStatus({
          status: data.status,
          step: data.step,
          message: data.message,
          jobType: data.jobType ?? jobRef.getState().jobType,
          algorithm: data.algorithm ?? jobRef.getState().algorithm,
          osrmDone: data.osrmDone,
          osrmTotal: data.osrmTotal,
          roughMap: data.roughMap ?? jobRef.getState().roughMap,
          error: data.error,
          errorCities: data.errorCities ?? null,
          elevationBatchDone: data.elevationBatchDone ?? 0,
          elevationBatchTotal: data.elevationBatchTotal ?? 0,
          forecastDone: data.forecastDone ?? 0,
          forecastTotal: data.forecastTotal ?? 0,
          registeringDone: data.registeringDone ?? 0,
          registeringTotal: data.registeringTotal ?? 0,
          warnings: data.warnings ?? [],
        });

        if (data.status === "done" || data.status === "preview") {
          const jt = data.jobType ?? jobRef.getState().jobType;
          const target =
            jt === "gpx" ? `/gpx/results/${jobId}`
            : jt === "destination" ? `/destination/results/${jobId}`
            : `/results/${jobId}`;
          timeoutId = setTimeout(() => navigateRef.current(target), 600);
          return;
        }

        if (data.status === "error") return;

        timeoutId = setTimeout(doPoll, 900);
      } catch {
        if (!active) return;
        retries += 1;
        if (retries >= 5) {
          jobRef.getState().updateStatus({
            status: "error",
            error: tRef.current.progress.lostConnection,
          });
          toast.error(tRef.current.progress.toastError);
          return;
        }
        toast.warning(tRef.current.progress.toastWarning);
        const backoff = Math.min(1000 * Math.pow(2, retries), 10000);
        timeoutId = setTimeout(doPoll, backoff);
      }
    }

    doPoll();

    return () => {
      active = false;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [jobId]); // only restart when the job ID actually changes

  const isGpxJob = job.jobType === "gpx";
  const isWeatherRoute = job.jobType === "weather_route";
  const isDestination = job.jobType === "destination";
  const isHierarchical = isDestination && job.algorithm === "hierarchical";
  const hasRegistering = job.registeringTotal > 0;
  const destSearchStep = isHierarchical ? "hierarchical_search" : "beam_search";
  const stepOrder = isGpxJob
    ? ["elevation", "forecast"]
    : isDestination
    ? ["destination_search", destSearchStep, "building_routes", "done"]
    : isWeatherRoute
    ? hasRegistering ? ["registering", "osrm", "elevation", "forecast"] : ["osrm", "elevation", "forecast"]
    : hasRegistering ? ["registering", "route", "osrm", "elevation", "forecast"] : ["route", "osrm", "elevation", "forecast"];
  const defaultStep = isGpxJob ? "elevation" : isDestination ? "destination_search" : hasRegistering ? "registering" : isWeatherRoute ? "osrm" : "route";
  const isError = job.status === "error";
  const osrmProgress =
    job.osrmTotal > 0 ? (job.osrmDone / job.osrmTotal) * 100 : 0;

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{t.progress.heading}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1" aria-live="polite" aria-atomic="false">
          {isDestination ? (
            <>
              <StepIndicator
                label={t.progress.stepDestinationSearch}
                status={getStepStatus(job.step || defaultStep, "destination_search", isError, stepOrder)}
                detail={job.step === "destination_search" ? job.message : undefined}
              />
              <StepIndicator
                label={isHierarchical ? t.progress.stepHierarchical : t.progress.stepBeamSearch}
                status={getStepStatus(job.step || defaultStep, destSearchStep, isError, stepOrder)}
                detail={job.step === destSearchStep ? job.message : undefined}
              />
              <StepIndicator
                label={t.progress.stepBuildingRoutes}
                status={getStepStatus(job.step || defaultStep, "building_routes", isError, stepOrder)}
                detail={job.step === "building_routes" ? job.message : undefined}
              />
            </>
          ) : (
            <>
              {!isGpxJob && hasRegistering && (
                <StepIndicator
                  label={t.progress.stepRegistering}
                  status={getStepStatus(job.step || defaultStep, "registering", isError, stepOrder)}
                  detail={job.step === "registering" ? job.message : undefined}
                  progress={
                    job.step === "registering" && job.registeringTotal > 0
                      ? (job.registeringDone / job.registeringTotal) * 100
                      : undefined
                  }
                />
              )}
              {!isGpxJob && !isWeatherRoute && (
                <StepIndicator
                  label={t.progress.stepRoute}
                  status={getStepStatus(job.step || defaultStep, "route", isError, stepOrder)}
                  detail={job.step === "route" ? job.message : undefined}
                />
              )}
              {!isGpxJob && (
                <StepIndicator
                  label={t.progress.stepOsrm}
                  status={getStepStatus(job.step || defaultStep, "osrm", isError, stepOrder)}
                  detail={
                    job.step === "osrm" && job.osrmTotal > 0
                      ? t.progress.stepOsrmDetail(job.osrmDone, job.osrmTotal)
                      : undefined
                  }
                  progress={job.step === "osrm" ? osrmProgress : undefined}
                />
              )}
              <StepIndicator
                label={t.progress.stepElevation}
                status={getStepStatus(job.step || defaultStep, "elevation", isError, stepOrder)}
                detail={job.step === "elevation" ? job.message : undefined}
                progress={
                  job.step === "elevation" && job.elevationBatchTotal > 0
                    ? (job.elevationBatchDone / job.elevationBatchTotal) * 100
                    : undefined
                }
              />
              <StepIndicator
                label={t.progress.stepForecast}
                status={getStepStatus(job.step || defaultStep, "forecast", isError, stepOrder)}
                detail={
                  job.step === "forecast" && job.forecastTotal > 0
                    ? t.progress.stepForecastDetail(job.forecastDone, job.forecastTotal)
                    : undefined
                }
                progress={
                  job.step === "forecast" && job.forecastTotal > 0
                    ? (job.forecastDone / job.forecastTotal) * 100
                    : undefined
                }
              />
            </>
          )}

          {job.warnings && job.warnings.length > 0 && (
            <div className="mt-4 space-y-2">
              {job.warnings.map((w, i) => (
                <Alert key={i} className="border-yellow-400 bg-yellow-50 text-yellow-900 dark:border-yellow-600 dark:bg-yellow-950 dark:text-yellow-200">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                  <AlertTitle>{t.progress.warningTitle}</AlertTitle>
                  <AlertDescription>{w}</AlertDescription>
                </Alert>
              ))}
            </div>
          )}

          {isError && job.error && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t.progress.errorTitle}</AlertTitle>
              <AlertDescription>{job.error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {isError && job.errorCities ? (
        <div className="animate-fade-in-scale min-h-[400px] overflow-hidden rounded-3xl border border-destructive">
          <ErrorCityMap
            allCities={job.errorCities.all_cities}
            disconnectedCities={job.errorCities.disconnected_cities}
            label={t.progress.disconnectedCityMapLabel}
          />
        </div>
      ) : job.roughMap ? (
        <div className="animate-fade-in-scale min-h-[400px] overflow-hidden rounded-3xl border border-border">
          <PreviewMap data={job.roughMap} />
        </div>
      ) : null}
    </div>
  );
}
