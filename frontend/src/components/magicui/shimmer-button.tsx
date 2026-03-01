import React from "react";
import { cn } from "@/lib/utils";

interface ShimmerButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  shimmerColor?: string;
  shimmerSize?: string;
  borderRadius?: string;
  shimmerDuration?: string;
  background?: string;
}

const ShimmerButton = React.forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  (
    {
      shimmerColor = "hsl(var(--primary-foreground))",
      shimmerSize = "0.1em",
      shimmerDuration = "2s",
      borderRadius = "14px",
      background = "hsl(var(--primary))",
      className,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        style={
          {
            "--shimmer-color": shimmerColor,
            "--shimmer-size": shimmerSize,
            "--shimmer-duration": shimmerDuration,
            "--border-radius": borderRadius,
            "--bg": background,
          } as React.CSSProperties
        }
        className={cn(
          "group relative z-0 flex cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap px-6 py-3 text-sm font-medium text-primary-foreground [border-radius:var(--border-radius)] transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        {...props}
      >
        <div className="absolute inset-0 overflow-hidden [border-radius:var(--border-radius)]">
          <div className="absolute inset-0 [background:var(--bg)]" />
          <div
            className="animate-shimmer absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,var(--shimmer-color)_50%,transparent_75%)] bg-[length:250%_250%] opacity-20"
            style={{ animationDuration: "var(--shimmer-duration)" }}
          />
        </div>
        <span className="relative z-10 flex items-center gap-2">{children}</span>
      </button>
    );
  }
);
ShimmerButton.displayName = "ShimmerButton";

export { ShimmerButton };
