"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Top route progress bar (same pattern as Vercel / GitHub / YouTube).
 *
 * How it works:
 *  - Listens to global click events, starts when a same-origin <a> link is hit (with a different target URL);
 *  - Listens to popstate (browser back/forward) to start;
 *  - After starting, uses setInterval to slowly creep toward 90%;
 *  - When usePathname changes, finishes to 100% then fades out;
 *  - Enforces a minimum visible duration to prevent the bar from flashing too briefly on fast local navigation.
 *
 * No third-party dependencies, follows --primary color scheme + blue glow.
 */
const MIN_VISIBLE_MS = 400;
const START_PROGRESS = 25;

export function RouteProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  const trickleTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const startedAtRef = useRef(0);
  const lastPathRef = useRef(pathname);

  const clearAll = useCallback(() => {
    if (trickleTimer.current) {
      clearInterval(trickleTimer.current);
      trickleTimer.current = null;
    }
    if (fadeTimer.current) {
      clearTimeout(fadeTimer.current);
      fadeTimer.current = null;
    }
    if (finishTimer.current) {
      clearTimeout(finishTimer.current);
      finishTimer.current = null;
    }
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    startedAtRef.current = Date.now();
    clearAll();
    setVisible(true);
    setProgress(START_PROGRESS);
    trickleTimer.current = setInterval(() => {
      setProgress((prev) => (prev >= 90 ? prev : prev + (90 - prev) * 0.12));
    }, 180);
  }, [clearAll]);

  const finish = useCallback(() => {
    if (!runningRef.current) return;
    const elapsed = Date.now() - startedAtRef.current;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);

    if (finishTimer.current) {
      clearTimeout(finishTimer.current);
    }
    finishTimer.current = setTimeout(() => {
      runningRef.current = false;
      if (trickleTimer.current) {
        clearInterval(trickleTimer.current);
        trickleTimer.current = null;
      }
      setProgress(100);
      fadeTimer.current = setTimeout(() => {
        setVisible(false);
        // Reset to 0 only after the bar has fully faded out, preventing a visible 100→0 snap on next start
        resetTimer.current = setTimeout(() => setProgress(0), 240);
      }, 220);
    }, wait);
  }, []);

  // Start on same-origin link clicks.
  // Note: Next.js <Link> calls preventDefault internally for client-side routing,
  // so we use capture phase to intercept before React's delegated handler,
  // otherwise event.defaultPrevented is already true and the logic gets bypassed.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
      if (!anchor) return;

      const targetAttr = anchor.getAttribute("target");
      if (targetAttr && targetAttr !== "_self") return;

      const href = anchor.getAttribute("href");
      if (!href) return;
      if (
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("#") ||
        anchor.hasAttribute("download")
      ) {
        return;
      }

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }

      start();
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [start]);

  // Browser back/forward
  useEffect(() => {
    const onPopState = () => start();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [start]);

  // Finish on pathname change
  useEffect(() => {
    if (lastPathRef.current !== pathname) {
      lastPathRef.current = pathname;
      finish();
    }
  }, [pathname, finish]);

  // Cleanup on unmount
  useEffect(() => clearAll, [clearAll]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[2px]"
      style={{
        opacity: visible ? 1 : 0,
        transition: visible ? "opacity 80ms linear" : "opacity 220ms 80ms linear",
      }}
    >
      <div
        className="h-full"
        style={{
          width: `${progress}%`,
          backgroundColor: "oklch(0.7 0.13 250)",
          transition:
            progress === 0
              ? "none"
              : progress >= 100
                ? "width 220ms ease-out"
                : "width 220ms cubic-bezier(0.22, 0.61, 0.36, 1)",
          boxShadow:
            progress > 0
              ? "0 0 10px oklch(0.7 0.13 250 / 0.55), 0 0 4px oklch(0.7 0.13 250 / 0.5)"
              : undefined,
        }}
      />
    </div>
  );
}
