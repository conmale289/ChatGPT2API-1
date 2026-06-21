"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Lightweight fade-in animation for page content on route changes.
 *
 * Implementation: uses pathname as key to force React to discard the old subtree
 * and mount a new one on path change, triggering a CSS animation on mount.
 *
 * Does not break any fixed-position elements (TopNav / RouteProgress / Toaster
 * are all outside this container), nor affect the main scrollbar gutter.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-page-enter">
      {children}
    </div>
  );
}
