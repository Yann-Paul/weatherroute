import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MapPin } from "lucide-react";
import { useResultsStore } from "@/stores/resultsStore";
import { useT } from "@/i18n/useT";

export function RouteList() {
  const { route, totalDistance } = useResultsStore();
  const t = useT();

  return (
    <div className="space-y-2">
      {route.map((stop, i) => (
        <div key={stop.cityId + i}>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {i + 1}
              </div>
              <div className="flex-1">
                <p className="font-medium">{stop.cityName}</p>
                <p className="text-xs text-muted-foreground">
                  {t.routeList.day(stop.dayNumber)}
                  {stop.distanceFromPrev > 0 &&
                    ` · +${Math.round(stop.distanceFromPrev)} km`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {stop.restDays > 0 && (
                  <Badge variant="outline">{t.routeList.rest(stop.restDays)}</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {Math.round(stop.cumulativeDistance)} km
                </span>
              </div>
            </CardContent>
          </Card>
          {i < route.length - 1 && (
            <div className="flex justify-center py-1">
              <Separator orientation="vertical" className="h-4" />
            </div>
          )}
        </div>
      ))}

      <Card className="bg-muted/50">
        <CardContent className="flex items-center justify-center gap-2 p-4">
          <MapPin className="h-4 w-4 text-primary" />
          <span className="font-medium">
            {t.routeList.totalDistance(Math.round(totalDistance))}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
