"use client";

import { LoaderCircle, RotateCcw, Save } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useSettingsStore } from "../store";

/**
 * Settings page bottom floating save bar.
 *
 * Behavior:
 *   - Only appears when isDirty=true; takes no visual space in clean state
 *   - Centered fixed at bottom, sm: max-w-3xl aligns width with main content
 *   - "Discard changes" = re-fetch config to reset all dirty state
 *   - Save button is disabled during save to prevent double-click
 *
 * Advantages over "one save button per card":
 *   - When editing across multiple sections, only one commit is needed
 *   - Visual focus: user continuously sees a "you have unsaved changes" prompt
 */
export function FloatingSaveBar() {
  const isDirty = useSettingsStore((s) => s.isDirty);
  const isSaving = useSettingsStore((s) => s.isSavingConfig);
  const saveConfig = useSettingsStore((s) => s.saveConfig);
  const revertConfig = useSettingsStore((s) => s.revertConfig);

  if (!isDirty) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <div className="flex items-center gap-2 text-sm text-stone-700">
          <span className="inline-flex size-2 animate-pulse rounded-full bg-amber-500" />
          Unsaved changes
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-9 cursor-pointer rounded-xl border-stone-200 bg-white px-3 text-stone-700 hover:bg-stone-50"
            onClick={() => void revertConfig()}
            disabled={isSaving}
          >
            <RotateCcw className="size-4" />
            Discard
          </Button>
          <Button
            className="h-9 cursor-pointer rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800"
            onClick={() => void saveConfig()}
            disabled={isSaving}
          >
            {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
