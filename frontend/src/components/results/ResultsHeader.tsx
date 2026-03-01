import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { MapPin, Ruler, Calendar } from "lucide-react";
import { useResultsStore } from "@/stores/resultsStore";
import { dayOfYearToDate } from "@/utils/constants";
import { useT } from "@/i18n/useT";

export function ResultsHeader() {
  const { route, totalDistance, totalDays, startDay } = useResultsStore();
  const t = useT();

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-sm">
          <MapPin className="h-3.5 w-3.5" />
          <NumberTicker value={route.length} /> {t.results.stops}
        </Badge>
        <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-sm">
          <Ruler className="h-3.5 w-3.5" />
          <NumberTicker value={Math.round(totalDistance)} /> km
        </Badge>
        <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-sm">
          <Calendar className="h-3.5 w-3.5" />
          {dayOfYearToDate(startDay, 2025, t.dateLocale)} · <NumberTicker value={totalDays} /> {t.results.days}
        </Badge>
      </CardContent>
    </Card>
  );
}
