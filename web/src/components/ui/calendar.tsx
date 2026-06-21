"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-1 text-sm", className)}
      classNames={{
        months: "flex flex-col gap-4 sm:flex-row",
        month: "relative",
        month_caption: "flex h-9 items-center justify-center font-medium",
        nav: "absolute inset-x-2 top-2 flex items-center justify-between",
        button_previous: "inline-flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-stone-100",
        button_next: "inline-flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-stone-100",
        weekdays: "mt-2 grid grid-cols-7 text-xs text-stone-400",
        weekday: "flex h-8 items-center justify-center font-normal",
        week: "grid grid-cols-7",
        day: "relative size-9 p-0 text-center",
        day_button: "size-9 cursor-pointer rounded-lg text-sm transition hover:bg-stone-100 disabled:cursor-not-allowed",
        today: "font-semibold text-stone-950",
        // Single day selected / range endpoints: dark button, white text.
        selected: "[&>button]:bg-stone-900 [&>button]:text-white [&>button]:hover:bg-stone-800",
        // Range middle: light gray fill, no border-radius on buttons, subtle hover darkening.
        // Using ! to force override selected's dark background, avoiding dependence on Tailwind class generation order.
        range_middle:
          "[&>button]:!rounded-none [&>button]:!bg-stone-100 [&>button]:!text-stone-900 [&>button]:hover:!bg-stone-200",
        // Remove border-radius on the side facing the middle segment, visually connecting endpoints to the range.
        range_start: "[&>button]:!rounded-r-none",
        range_end: "[&>button]:!rounded-l-none",
        outside: "text-stone-300",
        disabled: "text-stone-300 opacity-50",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />,
      }}
      {...props}
    />
  );
}

export { Calendar };
