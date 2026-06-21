"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Settings page right-anchor TOC (table of contents).
 *
 * Behavior:
 *   - Sticky on the right side, only visible at lg+ — below 1024px it's hidden to avoid narrowing main content
 *   - Uses IntersectionObserver to monitor [data-settings-section] nodes,
 *     picks the section closest to the top of the viewport as active
 *   - Clicking a TOC item uses scrollIntoView({ behavior: "smooth", block: "start" })
 *     to scroll to the corresponding section; sections have scroll-mt-24 to account for sticky header
 *
 * TOC items are passed in by parent component to avoid hardcoding order —
 * reordering sections in the future won't require changes to TOC.
 */
export type TOCItem = { id: string; label: string };

export function SettingsTOC({ items }: { items: TOCItem[] }) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const targets = items
      .map((it) => document.querySelector(`[data-settings-section="${it.id}"]`))
      .filter((el): el is Element => Boolean(el));
    if (targets.length === 0) return;

    // rootMargin top -20% bottom -70%: compresses the "activation zone" to a narrow band
    // at ~20% from the top of the viewport; only one section is hit at a time during scroll,
    // preventing TOC from flickering between items
    const observer = new IntersectionObserver(
      (entries) => {
        // Get the topmost intersecting entry
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const id = visible[0].target.getAttribute("data-settings-section");
          if (id) setActiveId(id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [items]);

  const handleClick = (id: string) => {
    const el = document.querySelector(`[data-settings-section="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      // Immediately update highlight, don't wait for IO callback to avoid ~200ms delay between click and highlight
      setActiveId(id);
    }
  };

  return (
    <aside className="sticky top-24 hidden h-fit w-56 shrink-0 lg:block">
      <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">
        On this page
      </div>
      <nav className="mt-3 flex flex-col gap-0.5">
        {items.map((it) => {
          const active = it.id === activeId;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => handleClick(it.id)}
              className={cn(
                "group relative cursor-pointer rounded-md px-3 py-1.5 text-left text-sm transition-colors duration-150",
                "border-l-2",
                active
                  ? "border-stone-900 bg-stone-100/70 font-medium text-stone-900"
                  : "border-transparent text-stone-500 hover:bg-stone-100/50 hover:text-stone-800",
              )}
            >
              {it.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
