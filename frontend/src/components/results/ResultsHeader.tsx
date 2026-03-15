import { Badge } from "@/components/ui/badge";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { MapPin, Ruler, Calendar } from "lucide-react";
import { useResultsStore } from "@/stores/resultsStore";
import { useT } from "@/i18n/useT";

export function ResultsHeader() {
  const { route, totalDistance, totalDays, startDay } = useResultsStore();
  const t = useT();

  const date = new Date(new Date().getFullYear(), 0);
  date.setDate(startDay);
  const dateStr = date.toLocaleDateString(t.dateLocale, { month: "numeric", day: "numeric" }).replace(/\.$/, "");

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="secondary" className="gap-1 px-2 py-0.5 text-xs">
        <MapPin className="h-3 w-3" />
        <NumberTicker value={route.length} /> {t.results.stops}
      </Badge>
      <Badge variant="secondary" className="gap-1 px-2 py-0.5 text-xs">
        <Ruler className="h-3 w-3" />
        <NumberTicker value={Math.round(totalDistance)} /> km
      </Badge>
      <Badge variant="secondary" className="gap-1 px-2 py-0.5 text-xs">
        <Calendar className="h-3 w-3" />
        {dateStr} · <NumberTicker value={totalDays} /> {t.results.days}
      </Badge>
    </div>
  );
}
