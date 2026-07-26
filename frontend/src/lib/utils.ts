import { useEffect, useState } from "react";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The element currently in browser Fullscreen mode, if any. While an element
 * owns fullscreen, anything portaled to document.body (Radix popovers,
 * selects, dialogs) renders outside the painted subtree and becomes
 * invisible — Radix portals need this as their `container` to stay visible.
 */
export function useFullscreenContainer(): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(
    () => (document.fullscreenElement as HTMLElement | null) ?? null
  );

  useEffect(() => {
    const handler = () => setContainer((document.fullscreenElement as HTMLElement | null) ?? null);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  return container;
}
