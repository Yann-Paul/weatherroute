import { BrowserRouter, Routes, Route } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { TopBar } from "@/components/layout/TopBar";
import { PlannerPage } from "@/components/planner/PlannerPage";
import { ProgressPage } from "@/components/progress/ProgressPage";
import { ResultsPage } from "@/components/results/ResultsPage";
import { GpxPage } from "@/components/gpx/GpxPage";
import { GpxResultsPage } from "@/components/gpx/GpxResultsPage";

export default function App() {
  return (
    <BrowserRouter>
      <TooltipProvider>
        <div className="min-h-screen bg-background">
          <TopBar />
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:left-4 focus:top-20 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
          >
            Skip to content
          </a>
          <main id="main-content">
            <Routes>
              <Route path="/" element={<PlannerPage />} />
              <Route path="/progress/:jobId" element={<ProgressPage />} />
              <Route path="/results/:jobId" element={<ResultsPage />} />
              <Route path="/gpx" element={<GpxPage />} />
              <Route path="/gpx/results/:jobId" element={<GpxResultsPage />} />
            </Routes>
          </main>
        </div>
        <Toaster position="bottom-right" richColors />
      </TooltipProvider>
    </BrowserRouter>
  );
}
