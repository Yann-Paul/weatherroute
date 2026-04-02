import * as React from "react";
import { cn } from "@/lib/utils";

interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number;
  onChange: (value: number) => void;
  fallback: number;
  min?: number;
  max?: number;
}

/**
 * A controlled number input that allows the user to fully clear the field
 * while typing. The numeric value is only committed on blur; if the field is
 * empty or out-of-range the `fallback` value is applied instead.
 */
const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  ({ value, onChange, fallback, min, max, className, ...props }, ref) => {
    const [draft, setDraft] = React.useState<string | null>(null);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setDraft(e.target.value);
    };

    const handleBlur = () => {
      if (draft === null) return;
      let parsed = parseInt(draft, 10);
      if (isNaN(parsed)) {
        parsed = fallback;
      } else {
        if (min !== undefined) parsed = Math.max(min, parsed);
        if (max !== undefined) parsed = Math.min(max, parsed);
      }
      onChange(parsed);
      setDraft(null);
    };

    return (
      <input
        type="number"
        ref={ref}
        min={min}
        max={max}
        value={draft !== null ? draft : value}
        onChange={handleChange}
        onBlur={handleBlur}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);
NumericInput.displayName = "NumericInput";

export { NumericInput };
