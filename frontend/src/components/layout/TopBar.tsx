import { Link, useLocation } from "react-router";
import { MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLangStore } from "@/i18n/store";
import { useT } from "@/i18n/useT";

export function TopBar() {
  const location = useLocation();
  const showNewRoute = location.pathname !== "/";
  const { lang, setLang } = useLangStore();
  const t = useT();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          <span className="font-sans text-xl font-medium">WeatherRoute</span>
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border">
            <button
              onClick={() => setLang("de")}
              className={[
                "px-2.5 py-1 text-xs font-medium transition-colors",
                lang === "de"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted",
              ].join(" ")}
            >
              DE
            </button>
            <button
              onClick={() => setLang("en")}
              className={[
                "px-2.5 py-1 text-xs font-medium transition-colors",
                lang === "en"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted",
              ].join(" ")}
            >
              EN
            </button>
          </div>
          {showNewRoute && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/">
                <Plus className="h-4 w-4" />
                {t.nav.newRoute}
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
