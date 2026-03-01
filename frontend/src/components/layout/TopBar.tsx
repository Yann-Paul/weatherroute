import { Link, useLocation } from "react-router";
import { MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TopBar() {
  const location = useLocation();
  const showNewRoute = location.pathname !== "/";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          <span className="font-sans text-xl font-medium">WeatherRoute</span>
        </Link>
        {showNewRoute && (
          <Button variant="outline" size="sm" asChild>
            <Link to="/">
              <Plus className="h-4 w-4" />
              New Route
            </Link>
          </Button>
        )}
      </div>
    </header>
  );
}
