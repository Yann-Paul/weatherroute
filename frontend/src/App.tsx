import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { TopBar } from "@/components/layout/TopBar";
import { PlannerPage } from "@/components/planner/PlannerPage";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/useT";

const ProgressPage = lazy(() =>
  import("@/components/progress/ProgressPage").then((m) => ({ default: m.ProgressPage }))
);
const ResultsPage = lazy(() =>
  import("@/components/results/ResultsPage").then((m) => ({ default: m.ResultsPage }))
);
const GpxPage = lazy(() =>
  import("@/components/gpx/GpxPage").then((m) => ({ default: m.GpxPage }))
);
const GpxResultsPage = lazy(() =>
  import("@/components/gpx/GpxResultsPage").then((m) => ({ default: m.GpxResultsPage }))
);
const WizardPage = lazy(() =>
  import("@/components/wizard/WizardPage").then((m) => ({ default: m.WizardPage }))
);
const GpxWizardPage = lazy(() =>
  import("@/components/wizard/GpxWizardPage").then((m) => ({ default: m.GpxWizardPage }))
);
const DestinationResultsPage = lazy(() =>
  import("@/components/results/DestinationResultsPage").then((m) => ({ default: m.DestinationResultsPage }))
);

export default function App() {
  const t = useT();
  return (
    <BrowserRouter>
      <TooltipProvider>
        <div className="min-h-screen bg-background">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:left-4 focus:top-4 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
          >
            {t.nav.skipToContent}
          </a>
          <TopBar />
          <main id="main-content">
            <Suspense
              fallback={
                <div className="space-y-4 p-4">
                  <Skeleton className="h-16 w-full rounded-3xl" />
                  <Skeleton className="h-[400px] w-full rounded-3xl" />
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<PlannerPage />} />
                <Route path="/progress/:jobId" element={<ProgressPage />} />
                <Route path="/results/:jobId" element={<ResultsPage />} />
                <Route path="/gpx" element={<GpxPage />} />
                <Route path="/gpx/results/:jobId" element={<GpxResultsPage />} />
                <Route path="/wizard" element={<WizardPage />} />
                <Route path="/gpx/wizard" element={<GpxWizardPage />} />
                <Route path="/destination/results/:jobId" element={<DestinationResultsPage />} />
              </Routes>
            </Suspense>
          </main>
        </div>
        <Toaster position="bottom-right" richColors />
      </TooltipProvider>
    </BrowserRouter>
  );
}
