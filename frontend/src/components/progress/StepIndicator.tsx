import { Check, Loader2, X, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

type StepStatus = "waiting" | "active" | "done" | "error";

interface StepIndicatorProps {
  label: string;
  status: StepStatus;
  detail?: string;
  progress?: number;
}

export function StepIndicator({
  label,
  status,
  detail,
  progress,
}: StepIndicatorProps) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5">
        {status === "done" && (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary">
            <Check className="h-4 w-4 text-primary-foreground" />
          </div>
        )}
        {status === "active" && (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        )}
        {status === "error" && (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive">
            <X className="h-4 w-4 text-destructive-foreground" />
          </div>
        )}
        {status === "waiting" && (
          <div className="flex h-6 w-6 items-center justify-center">
            <Circle className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="flex-1 space-y-1">
        <p
          className={cn(
            "text-sm font-medium",
            status === "waiting" && "text-muted-foreground",
            status === "error" && "text-destructive"
          )}
        >
          {label}
        </p>
        {detail && (
          <p className="text-xs text-muted-foreground">{detail}</p>
        )}
        {progress != null && status === "active" && (
          <Progress value={progress} className="h-2" />
        )}
      </div>
    </div>
  );
}
