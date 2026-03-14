import { Link, useLocation } from "react-router";
import { MapPin, Plus, FileUp, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLangStore } from "@/i18n/store";
import { useT } from "@/i18n/useT";
import { useThemeStore, useIsDark } from "@/stores/themeStore";

export function TopBar() {
  const location = useLocation();
  const showNewRoute = location.pathname !== "/";
  const showGpx = !location.pathname.startsWith("/gpx");
  const { lang, setLang } = useLangStore();
  const t = useT();
  const { setMode } = useThemeStore();
  const isDark = useIsDark();

  function toggleTheme() {
    setMode(isDark ? "light" : "dark");
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-sm">
      <div className="flex h-14 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          <span className="font-sans text-xl font-medium">WeatherRoute</span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            aria-label={isDark ? t.nav.toggleLight : t.nav.toggleDark}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
          <div role="group" aria-label="Language" className="flex overflow-hidden rounded-md border border-border">
            <button
              onClick={() => setLang("de")}
              aria-pressed={lang === "de"}
              className={[
                "px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                lang === "de"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted",
              ].join(" ")}
            >
              DE
            </button>
            <button
              onClick={() => setLang("en")}
              aria-pressed={lang === "en"}
              className={[
                "px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                lang === "en"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted",
              ].join(" ")}
            >
              EN
            </button>
          </div>
          {showGpx && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/gpx">
                <FileUp className="h-4 w-4" />
                <span className="hidden sm:inline">{t.nav.gpx}</span>
              </Link>
            </Button>
          )}
          {showNewRoute && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t.nav.newRoute}</span>
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
