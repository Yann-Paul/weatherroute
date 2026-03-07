import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { FolderOpen, Trash2, Route as RouteIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useJobStore } from "@/stores/jobStore";
import { getSavedRoutes, deleteSavedRoute, restoreSavedRoute } from "@/api/client";
import { useT } from "@/i18n/useT";
import { dayOfYearToDate } from "@/utils/constants";
import { useLangStore } from "@/i18n/store";
import type { SavedRouteSummary } from "@/api/types";

export function SavedRoutesList() {
  const [routes, setRoutes] = useState<SavedRouteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const navigate = useNavigate();
  const setJobId = useJobStore((s) => s.setJobId);
  const t = useT();
  const lang = useLangStore((s) => s.lang);

  useEffect(() => {
    getSavedRoutes()
      .then(setRoutes)
      .catch(() => setRoutes([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleOpen(id: string) {
    setOpeningId(id);
    try {
      const { jobId } = await restoreSavedRoute(id);
      setJobId(jobId);
      navigate(`/progress/${jobId}`);
    } catch {
      setOpeningId(null);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteSavedRoute(id);
      setRoutes((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // ignore
    }
  }

  if (loading || routes.length === 0) {
    if (loading) return null;
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RouteIcon className="h-4 w-4 text-primary" />
          {t.savedRoutes.heading}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {routes.map((route) => {
          const locale = lang === "de" ? "de-DE" : "en-US";
          const dateStr = route.startDay ? dayOfYearToDate(route.startDay, undefined, locale) : "";
          return (
            <div
              key={route.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{route.name}</div>
                <div className="mt-0.5 flex gap-2 text-xs text-muted-foreground">
                  {dateStr && <span>{dateStr}</span>}
                  {route.totalDistance > 0 && (
                    <span>{Math.round(route.totalDistance)} {t.savedRoutes.km}</span>
                  )}
                  {route.totalDays > 0 && (
                    <span>{route.totalDays} {t.savedRoutes.days}</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleOpen(route.id)}
                  disabled={openingId === route.id}
                  className="gap-1"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t.savedRoutes.open}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(route.id)}
                  disabled={openingId === route.id}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
