import { useState } from "react";
import { useNavigate } from "react-router";
import { GraduationCap, X, ChevronRight } from "lucide-react";
import { useT } from "@/i18n/useT";

interface NewHereBannerProps {
  href: string;
}

export function NewHereBanner({ href }: NewHereBannerProps) {
  const [minimized, setMinimized] = useState(false);
  const navigate = useNavigate();
  const t = useT();
  const n = t.nav;

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="animate-fade-in-scale flex items-center gap-2 rounded-full border border-primary/30 bg-primary/8 px-4 py-2 text-sm font-medium text-primary transition-all hover:bg-primary/15"
      >
        <GraduationCap className="h-4 w-4" />
        {n.newHere}
      </button>
    );
  }

  return (
    <div className="animate-pop-in relative overflow-hidden rounded-2xl border-2 border-primary/20 bg-primary/5 p-5">
      {/* X button */}
      <button
        type="button"
        onClick={() => setMinimized(true)}
        aria-label="Minimieren"
        className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-4 pr-8">
        {/* Icon */}
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <GraduationCap className="h-6 w-6" />
        </div>

        {/* Text + CTA */}
        <div className="space-y-3">
          <div className="space-y-0.5">
            <p className="text-base font-semibold leading-snug">{n.newHere}</p>
            <p className="text-sm text-muted-foreground">{n.newHereDesc}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate(href)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <GraduationCap className="h-4 w-4" />
            {n.startGuidedSetup}
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
