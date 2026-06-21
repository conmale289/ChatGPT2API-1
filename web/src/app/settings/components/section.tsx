"use client";

import { ReactNode } from "react";

/**
 * Settings page generic section wrapper:
 *   - id serves as URL hash anchor + TOC jump target + IntersectionObserver unit
 *   - title / description follow unified type rhythm (text-xl / text-sm muted)
 *   - No Card wrapper per section — too many Cards on one page dilutes hierarchy;
 *     border-t + spacing is sufficient, similar to Linear / Vercel settings
 *   - scroll-mt-24: accounts for sticky header, scrollIntoView won't be covered by top bar
 */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-settings-section={id}
      className="scroll-mt-24 space-y-6 border-t border-stone-200/80 pt-10 first:border-t-0 first:pt-0"
    >
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-stone-900">{title}</h2>
        {description ? (
          <p className="text-sm leading-6 text-stone-500">{description}</p>
        ) : null}
      </header>
      <div>{children}</div>
    </section>
  );
}
