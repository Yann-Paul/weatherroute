import { useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { StepIndicator } from "./StepIndicator";
import { PreviewMap } from "./PreviewMap";
import { useJobStore } from "@/stores/jobStore";
import { getJobStatus } from "@/api/client";
import { useT } from "@/i18n/useT";

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
  const pollingRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryCount = useRef(0);
  const t = useT();
  // Capture strings into ref so poll callback always sees latest lang
  const tRef = useRef(t);
  tRef.current = t;

  const poll = useCallback(async () => {
    if (!jobId) return;

    try {
      const data = await getJobStatus(jobId);
      retryCount.current = 0;

      job.updateStatus({
        status: data.status,
        step: data.step,
        message: data.message,
        jobType: data.jobType ?? job.jobType,
        osrmDone: data.osrmDone,
        osrmTotal: data.osrmTotal,
        roughMap: data.roughMap ?? job.roughMap,
        error: data.error,
        elevationBatchDone: data.elevationBatchDone ?? 0,
        elevationBatchTotal: data.elevationBatchTotal ?? 0,
        forecastDone: data.forecastDone ?? 0,
        forecastTotal: data.forecastTotal ?? 0,
      });

      if (data.status === "done" || data.status === "preview") {
        const isGpx = (data.jobType ?? job.jobType) === "gpx";
        setTimeout(() => navigate(isGpx ? `/gpx/results/${jobId}` : `/results/${jobId}`), 600);
        return;
      }

      if (data.status === "error") return;

      pollingRef.current = setTimeout(poll, 900);
    } catch {
      retryCount.current += 1;
      if (retryCount.current >= 5) {
        job.updateStatus({
          status: "error",
          error: tRef.current.progress.lostConnection,
        });
        toast.error(tRef.current.progress.toastError);
        return;
      }
      toast.warning(tRef.current.progress.toastWarning);
      const backoff = Math.min(1000 * Math.pow(2, retryCount.current), 10000);
      pollingRef.current = setTimeout(poll, backoff);
    }
  }, [jobId, navigate]);

  useEffect(() => {
    poll();
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, [poll]);

  const isGpxJob = job.jobType === "gpx";
  const isWeatherRoute = job.jobType === "weather_route";
  const stepOrder = isGpxJob
    ? ["elevation", "forecast"]
    : isWeatherRoute
    ? ["osrm", "elevation", "forecast"]
    : ["route", "osrm", "elevation", "forecast"];
  const defaultStep = isGpxJob ? "elevation" : isWeatherRoute ? "osrm" : "route";
  const isError = job.status === "error";
  const osrmProgress =
    job.osrmTotal > 0 ? (job.osrmDone / job.osrmTotal) * 100 : 0;

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{t.progress.heading}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
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

          {isError && job.error && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t.progress.errorTitle}</AlertTitle>
              <AlertDescription>{job.error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <AnimatePresence>
        {job.roughMap && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.33, 1, 0.68, 1] }}
            className="min-h-[400px] overflow-hidden rounded-3xl border border-border"
          >
            <PreviewMap data={job.roughMap} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
