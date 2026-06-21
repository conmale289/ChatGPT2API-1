"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  Download,
  ImageIcon,
  Images,
  LoaderCircle,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteManagedImages,
  downloadSingleImage,
  fetchMyWorks,
  getMyPublishedBatch,
  publishGalleryItem,
  type ManagedImage,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

/**
 * sessionStorage key handed off to the image page.
 * Format: { url: string; prompt: string }
 * The image page reads it once on mount and clears it immediately to avoid re-triggering on next refresh.
 */
const REDRAW_HANDOFF_KEY = "chatgpt2api:redraw_handoff";

function imageKey(item: ManagedImage) {
  return item.rel || item.url;
}

function formatRelative(value: string) {
  if (!value) return "";
  const ts = new Date(value.replace(" ", "T")).getTime();
  if (Number.isNaN(ts)) return value;
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} days ago`;
  return value.slice(0, 10);
}

function WorksPageContent() {
  const [items, setItems] = useState<ManagedImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [focused, setFocused] = useState<ManagedImage | null>(null);

  // Pinterest-style masonry: column width flex-1 edge-to-edge equal-split container (no whitespace), column count follows container width.
  //   - Column count = round((container width + gap) / (target column width 240 + gap))
  //   - Key is round not floor: floor requires filling full integer columns before adding a new one,
  //     often stays at N columns when at N+0.9, making single columns very wide (~1.7x target width), looking like big cards not masonry;
  //     round jumps to N+1 columns at N+0.5, keeping single column width stable at [0.7, 1.3]x target width,
  //     when crossing column count boundary single column width only changes ~15% (not as hard as breakpoint 25-33% sudden change)
  //   - Mobile (<480px) fallback to 2 columns, avoiding single large image filling the screen
  //   - Column count change uses CSS transition for smoothing
  // ResizeObserver watches container, more accurate than window.resize (also responds to sidebar toggle);
  // rAF throttle avoids high-frequency setState jitter during drag.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState(0); // 0 = not measured yet
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const TARGET_W = 240;
    const GAP = 16;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const w = el.clientWidth;
      if (!w) return;
      let n: number;
      if (w < 360) n = 1;
      else if (w < 520) n = 2;
      else n = Math.max(2, Math.round((w + GAP) / (TARGET_W + GAP)));
      setColumnCount((prev) => (prev === n ? prev : n));
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(calc);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Publish to gallery dialog: when an image has no prompt (old data), let user fill it in before publishing.
  // pendingPublish holds the target being published, promptDraft is the input text.
  const [pendingPublish, setPendingPublish] = useState<ManagedImage | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [publishing, setPublishing] = useState(false);
  // Single image publish state visual feedback: rel → "publishing" | "published"
  const [publishStates, setPublishStates] = useState<Map<string, "publishing" | "published">>(
    () => new Map(),
  );

  // Delete confirmation
  const [pendingDelete, setPendingDelete] = useState<ManagedImage | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const resp = await fetchMyWorks();
      setItems(resp.items);
      // Seed publishStates: after page refresh the publishStates Map resets to empty,
      // published badges would be lost. On reload, batch-query the backend for "which of these rels have I published",
      // write matches back to state, avoiding per-image single /api/gallery/published requests overwhelming concurrency.
      const rels = resp.items.map((it) => it.rel).filter(Boolean) as string[];
      if (rels.length > 0) {
        try {
          const { items: published } = await getMyPublishedBatch(rels);
          setPublishStates((prev) => {
            const next = new Map(prev);
            for (const [rel, info] of Object.entries(published)) {
              if (info.published) {
                next.set(rel, "published");
              }
            }
            return next;
          });
        } catch {
          // Silent failure: unable to fetch publish status doesn't block list loading, retry on next reload
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load works";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Redraw with this image: write rel + prompt to sessionStorage, navigate to image page.
   * Intentionally pass rel not item.url: the backend-constructed item.url is an absolute address (with http://...:port),
   * which is cross-origin with the frontend page — <img> can load it but fetch gets blocked by CORS reporting "Failed to fetch".
   * The image page uses `/images/${rel}` same-origin fetch with the rel, never hitting CORS.
   * The url field is kept as fallback (old handoff format when rel is missing).
   */
  const handleRedraw = useCallback((item: ManagedImage) => {
    if (typeof window === "undefined") return;
    const rel = item.rel || item.path || "";
    try {
      window.sessionStorage.setItem(
        REDRAW_HANDOFF_KEY,
        JSON.stringify({
          rel,
          url: item.url, // fallback: use absolute URL when rel is unavailable
          prompt: item.prompt || "",
        }),
      );
    } catch {
      // sessionStorage write failure is typically private mode / quota full, don't block navigation
    }
    window.location.assign("/image");
  }, []);

  const handleCopyPrompt = useCallback(async (text: string) => {
    if (!text.trim()) {
      toast.error("No prompt saved for this image");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Prompt copied");
    } catch {
      toast.error("Copy failed");
    }
  }, []);

  const handleDownload = useCallback(async (item: ManagedImage) => {
    const path = item.rel || item.path;
    if (!path) {
      toast.error("This image cannot be downloaded");
      return;
    }
    try {
      await downloadSingleImage(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download failed";
      toast.error(message);
    }
  }, []);

  /**
   * Publish button entry point.
   *  - Has prompt: directly call publish API, pass content filter → success → show green check visual
   *  - No prompt: show dialog for user to fill in, then call publish on submit
   */
  const handlePublish = useCallback(
    async (item: ManagedImage, promptOverride?: string) => {
      const rel = item.rel || item.path;
      if (!rel) {
        toast.error("This image cannot be published");
        return;
      }
      // promptOverride !== undefined means user has confirmed via the fill-in dialog (even if empty string),
      // respect user's choice and publish directly; undefined means clicked publish button directly from card.
      let prompt: string;
      if (promptOverride !== undefined) {
        prompt = promptOverride.trim();
      } else {
        prompt = (item.prompt ?? "").trim();
        if (!prompt) {
          // Card itself has no prompt → show dialog for user to decide whether to add one (optional, can publish empty)
          setPendingPublish(item);
          setPromptDraft("");
          return;
        }
      }
      setPublishStates((prev) => new Map(prev).set(rel, "publishing"));
      try {
        await publishGalleryItem({
          image_rel: rel,
          prompt,
          model: "",
          size: "",
          width: item.width || 0,
          height: item.height || 0,
        });
        setPublishStates((prev) => new Map(prev).set(rel, "published"));
        toast.success("Published to gallery");
      } catch (error) {
        // Rollback state on failure so user can retry
        setPublishStates((prev) => {
          const next = new Map(prev);
          next.delete(rel);
          return next;
        });
        const message = error instanceof Error ? error.message : "Publish failed";
        toast.error(message);
      }
    },
    [],
  );

  const handleConfirmPendingPublish = useCallback(async () => {
    if (!pendingPublish) return;
    // Allow empty prompt — whether to fill in is the user's decision, backend supports empty value publishing
    const text = promptDraft.trim();
    setPublishing(true);
    try {
      await handlePublish(pendingPublish, text);
      setPendingPublish(null);
      setPromptDraft("");
    } finally {
      setPublishing(false);
    }
  }, [handlePublish, pendingPublish, promptDraft]);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const path = pendingDelete.rel || pendingDelete.path;
    if (!path) {
      setPendingDelete(null);
      return;
    }
    setDeleting(true);
    try {
      const resp = await deleteManagedImages({ paths: [path] });
      if (!resp.removed) {
        toast.error("Delete failed: this image is not under your account or no longer exists");
      } else {
        toast.success("Deleted");
        const key = imageKey(pendingDelete);
        setItems((prev) => prev.filter((it) => imageKey(it) !== key));
        if (focused && imageKey(focused) === key) setFocused(null);
      }
      setPendingDelete(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delete failed";
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }, [focused, pendingDelete]);

  const visibleCount = items.length;

  // When closing the dialog, setting focused to null immediately causes {focused ? ... : null} content to disappear from DOM instantly,
  // leaving an empty DialogContent that shrinks into a white line in the center during Radix's 200ms fade-out animation (user-reported "white line flash in the middle").
  // Use lastFocused to cache the last content, continue rendering the same image/buttons before close transition completes,
  // so the whole block fades out together with the shell, instead of emptying first.
  const [lastFocused, setLastFocused] = useState<ManagedImage | null>(null);
  useEffect(() => {
    if (focused) setLastFocused(focused);
  }, [focused]);
  const focusedView = focused ?? lastFocused;

  const focusedPublishState = focused ? publishStates.get(imageKey(focused)) : undefined;

  return (
    <>
      <section className="mt-4 flex flex-col gap-4 sm:mt-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">
            My Works
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">My Works</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Loading…"
              : visibleCount === 0
                ? "No images generated yet"
                : `${visibleCount} images · Click a card to view full size`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-10 rounded-xl border-stone-200 bg-white/80 px-4 text-stone-700 hover:bg-white"
            onClick={() => void reload()}
            disabled={isLoading}
          >
            <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </section>

      {isLoading && items.length === 0 ? (
        <Card className="mt-6 rounded-2xl border-white/80 bg-white/90 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <div className="rounded-xl bg-stone-100 p-3 text-stone-500">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
            <p className="text-sm text-stone-500">Fetching your images from cloud…</p>
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && items.length === 0 ? (
        <Card className="mt-6 rounded-2xl border-white/80 bg-white/90 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <div className="rounded-xl bg-stone-100 p-3 text-stone-500">
              <Images className="size-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-stone-700">Nothing here yet</p>
              <p className="text-sm text-stone-500">Go to the image page to generate your first one</p>
            </div>
            <Button
              variant="outline"
              className="mt-2 h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700 hover:bg-stone-50"
              onClick={() => window.location.assign("/image")}
            >
              <Sparkles className="size-4" />
              Generate
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Pinterest-style masonry: column width flex-1 edge-to-edge equal-split container, no whitespace.
          - Column count change only shifts single column width ~15%, softer than fixed-width "side whitespace sudden change"
          - "Shortest column first" bucketing within columns, short cards stack tightly
          - columnCount === 0 means not measured yet, don't render to avoid SSR/CSR inconsistency flicker
          - Cards remove border/default overlay, let the image itself speak; prompt + time only appear on hover
          - Don't depend on real image height, only use aspectRatio to estimate "cumulative height in column" for bucketing
        */}
      <div
        ref={containerRef}
        className="mt-6 flex gap-3"
        style={{ alignItems: "flex-start" }}
      >
        {columnCount > 0 && (() => {
          const cols = columnCount;
          const buckets: ManagedImage[][] = Array.from({ length: cols }, () => []);
          // Cumulative "height" approximation within column: use 1/ratio (= height/width) as relative height per unit column width
          const heights = new Array(cols).fill(0);
          for (const item of items) {
            const w = item.width && item.width > 0 ? item.width : 1;
            const h = item.height && item.height > 0 ? item.height : 1;
            const relativeH = h / w;
            // Pick the current shortest column
            let target = 0;
            for (let i = 1; i < cols; i++) {
              if (heights[i] < heights[target]) target = i;
            }
            buckets[target].push(item);
            heights[target] += relativeH;
          }
          return buckets.map((bucket, colIdx) => (
            <div
              key={colIdx}
              className="flex flex-1 flex-col gap-3"
              style={{ minWidth: 0 }}
            >
              {bucket.map((item) => {
                const ratio =
                  item.width && item.height && item.width > 0 && item.height > 0
                    ? item.width / item.height
                    : 1;
                const state = publishStates.get(imageKey(item));
                return (
                  <button
                    key={imageKey(item)}
                    type="button"
                    onClick={() => setFocused(item)}
                    className="group relative w-full cursor-pointer overflow-hidden rounded-2xl bg-stone-100 text-left transition-shadow duration-200 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 focus-visible:outline-none"
                    style={{ aspectRatio: String(ratio) }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.url}
                      alt={item.prompt?.slice(0, 30) || item.name}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    {state === "published" ? (
                      <div className="absolute top-2 left-2 rounded-md bg-emerald-500/95 px-2 py-1 text-[10.5px] font-semibold text-white shadow-sm">
                        Published
                      </div>
                    ) : null}
                    {/* Pinterest style: clean image by default, prompt + meta only appear on hover */}
                    <div className="pointer-events-none absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      <p className="line-clamp-2 text-[12.5px] leading-snug">
                        {item.prompt?.trim() || "—"}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10.5px] text-white/80">
                        <span>{formatRelative(item.created_at)}</span>
                        {item.width && item.height ? (
                          <span className="shrink-0 font-data">
                            {item.width}×{item.height}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ));
        })()}
      </div>

      {/* Detail Dialog */}
      <Dialog open={focused !== null} onOpenChange={(open) => (!open ? setFocused(null) : null)}>
        <DialogContent
          showCloseButton={false}
          className="hide-scrollbar max-h-[92vh] overflow-y-auto rounded-2xl p-0 sm:max-w-[760px]"
        >
          {focusedView ? (
            <div className="flex flex-col">
              {/* Image + top-right floating actions (close/download/delete).
                  Secondary actions tucked in corner, bottom only has 3 main CTAs, avoiding button wrapping.
                  Container background uses stone-900 as fallback; image fills container width, height expands naturally by ratio,
                  tall images handled by outer DialogContent's max-h-[92vh] + overflow-y-auto scroll. */}
              <div className="relative bg-stone-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={focusedView.url}
                  alt={focusedView.prompt?.slice(0, 30) || focusedView.name}
                  className="block h-auto w-full"
                />
                <div className="absolute top-3 right-3 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleDownload(focusedView)}
                    aria-label="Download"
                    title="Download"
                    className="grid size-9 cursor-pointer place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75"
                  >
                    <Download className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(focusedView)}
                    aria-label="Delete"
                    title="Delete"
                    className="grid size-9 cursor-pointer place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-rose-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFocused(null)}
                    aria-label="Close"
                    title="Close"
                    className="grid size-9 cursor-pointer place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-3 p-5">
                <DialogHeader className="gap-1.5 space-y-0">
                  <DialogTitle className="text-base font-semibold">Work Details</DialogTitle>
                  <DialogDescription className="sr-only">Prompt and actions for a single work</DialogDescription>
                </DialogHeader>

                {focusedView.prompt ? (
                  <div className="rounded-xl bg-stone-50 p-3 text-[13px] leading-6 text-stone-800">
                    {focusedView.prompt}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50/70 p-3 text-[12px] leading-6 text-stone-500">
                    No prompt was saved for this image (likely generated by an earlier version). You can add one when publishing to the gallery.
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  <span>{formatRelative(focusedView.created_at)}</span>
                  {focusedView.width && focusedView.height ? (
                    <span className="font-data">
                      · {focusedView.width}×{focusedView.height}
                    </span>
                  ) : null}
                </div>

                {/* Bottom 3 main CTAs equally split width, never wrap;
                    download/delete already moved to top-right floating buttons on image. */}
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Button
                    onClick={() => handleRedraw(focusedView)}
                    className="h-10 w-full rounded-xl bg-stone-950 px-3 text-white hover:bg-stone-800"
                  >
                    <Sparkles className="size-4" />
                    Redraw
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 w-full rounded-xl border-stone-200 bg-white px-3"
                    onClick={() => void handleCopyPrompt(focusedView.prompt || "")}
                    disabled={!focusedView.prompt}
                  >
                    <Copy className="size-4" />
                    Copy Prompt
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 w-full rounded-xl border-stone-200 bg-white px-3"
                    onClick={() => void handlePublish(focusedView)}
                    disabled={focusedPublishState === "publishing" || focusedPublishState === "published"}
                  >
                    {focusedPublishState === "publishing" ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Share2 className="size-4" />
                    )}
                    {focusedPublishState === "published" ? "Published" : "Publish to Gallery"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Old data / img2img without prompt — optionally add a description before publishing (optional, can publish empty) */}
      <Dialog
        open={pendingPublish !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingPublish(null);
            setPromptDraft("");
          }
        }}
      >
        <DialogContent showCloseButton={false} className="rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle>Add a prompt for this image (optional)</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              No prompt was saved for this image. Adding a description helps other users reuse the prompt, but you can also publish without one.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={promptDraft}
            onChange={(event) => setPromptDraft(event.target.value)}
            placeholder="e.g.: A cat in a spacesuit sitting on the moon's surface"
            className="mt-2 min-h-[120px] rounded-xl"
          />
          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              onClick={() => {
                setPendingPublish(null);
                setPromptDraft("");
              }}
              disabled={publishing}
            >
              Cancel
            </Button>
            <Button
              className="bg-stone-950 text-white hover:bg-stone-800"
              onClick={() => void handleConfirmPendingPublish()}
              disabled={publishing}
            >
              {publishing ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Confirm Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => (!open ? setPendingDelete(null) : null)}
      >
        <DialogContent showCloseButton={false} className="rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle>Delete this work?</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              The image on the server will be deleted, and any corresponding gallery entry will also be removed. Locally downloaded copies are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => void handleConfirmDelete()}
              disabled={deleting}
            >
              {deleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Confirm Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function WorksPage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <WorksPageContent />;
}
