"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  ExternalLink,
  EyeOff,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchGalleryFeed,
  hideGalleryItem,
  unhideGalleryItem,
  unpublishGalleryItem,
  type GalleryItem,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

const PAGE_LIMIT = 24;
// Same sessionStorage key as /works page, consumed uniformly by /image page on mount
const REDRAW_HANDOFF_KEY = "chatgpt2api:redraw_handoff";

/**
 * Responsive breakpoints: [min width px, column count at that width], ordered large to small, first match wins.
 * Follows Pinterest's density tiers: mobile starts at 2 columns, 4K screen gets 6 columns.
 */
const COL_BREAKPOINTS: Array<[number, number]> = [
  [1536, 6],
  [1280, 5],
  [1024, 4],
  [768, 3],
  [0, 2],
];

function pickColCount(width: number): number {
  for (const [min, cols] of COL_BREAKPOINTS) {
    if (width >= min) return cols;
  }
  return 2;
}

/**
 * Distribute items into the "current shortest column" = Pinterest true masonry algorithm.
 * We don't have real rendered heights, but GalleryItem carries width/height (stored at publish time by backend),
 * using 1/ratio as relative unit height estimate is sufficient — all cards render at equal column width,
 * same ratio error scales uniformly across all cards, much more accurate than round-robin (i % cols).
 *
 * Old entries without width/height fall back to 1:1, doesn't affect overall balance.
 */
function distributeMasonry(items: GalleryItem[], cols: number): GalleryItem[][] {
  const buckets: GalleryItem[][] = Array.from({ length: cols }, () => []);
  const heights: number[] = Array(cols).fill(0);
  for (const item of items) {
    const ratio =
      item.width > 0 && item.height > 0 ? item.width / item.height : 1;
    const h = 1 / ratio;
    let minIdx = 0;
    for (let i = 1; i < cols; i++) {
      if (heights[i] < heights[minIdx]) minIdx = i;
    }
    buckets[minIdx].push(item);
    heights[minIdx] += h;
  }
  return buckets;
}

function formatRelativeTime(epochSeconds: number): string {
  if (!epochSeconds) return "";
  const diff = Date.now() / 1000 - epochSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} days ago`;
  const date = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function GalleryPageContent({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [cursor, setCursor] = useState<string>("");
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Admin only: whether to include hidden (unlisted) entries in the feed
  const [includeHidden, setIncludeHidden] = useState(false);
  // Detail dialog focus
  const [focused, setFocused] = useState<GalleryItem | null>(null);
  // Delete confirmation (hard unpublish)
  const [pendingDelete, setPendingDelete] = useState<GalleryItem | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Current column count: watch window width changes to pick breakpoint. During SSR window doesn't exist so default to 2 columns,
  // immediately correct based on real width after client mount.
  const [colCount, setColCount] = useState<number>(2);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setColCount(pickColCount(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const loadFirstPage = useCallback(async () => {
    setIsLoading(true);
    try {
      const resp = await fetchGalleryFeed({ limit: PAGE_LIMIT, includeHidden });
      setItems(resp.items);
      setCursor(resp.next_cursor || "");
      setHasMore(Boolean(resp.next_cursor));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load gallery";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [includeHidden]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || !cursor) return;
    setIsLoadingMore(true);
    try {
      const resp = await fetchGalleryFeed({
        cursor,
        limit: PAGE_LIMIT,
        includeHidden,
      });
      setItems((prev) => {
        const seen = new Set(prev.map((it) => it.id));
        const next = resp.items.filter((it) => !seen.has(it.id));
        return [...prev, ...next];
      });
      setCursor(resp.next_cursor || "");
      setHasMore(Boolean(resp.next_cursor));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load next page";
      toast.error(message);
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, hasMore, includeHidden, isLoadingMore]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  // IntersectionObserver triggers loadMore: when sentinel enters viewport, fetch next page
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMore();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  const handleCopyPrompt = async (text: string) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Prompt copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  /**
   * Remix this image: write gallery item's rel + url + prompt to sessionStorage, navigate to image page.
   * Reuses the /works page "redraw with this image" handoff chain: /image page consumes this key uniformly on mount.
   * - Prefer image_rel: /image page will construct `/images/<rel>` same-origin fetch, no CORS issues
   * - url as fallback: when rel is missing, use absolute URL — <img> can at least load (fetch may be blocked)
   * - prompt can be empty: gallery allows publishing with empty prompt, leave it blank on image page for user to write
   */
  const handleRedraw = (item: GalleryItem) => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        REDRAW_HANDOFF_KEY,
        JSON.stringify({
          rel: item.image_rel || "",
          url: item.url,
          prompt: item.prompt || "",
        }),
      );
    } catch {
      // Private mode / quota full — write failure doesn't block navigation, image page will handle fallback
    }
    window.location.assign("/image");
  };

  const handleAdminToggleHide = async (item: GalleryItem) => {
    try {
      if (item.status === "hidden") {
        await unhideGalleryItem(item.id);
        toast.success("Restored to visible");
      } else {
        await hideGalleryItem(item.id);
        toast.success("Unlisted");
      }
      // Partial update is better UX than reload, avoids cursor reset scrolling back to top
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id
            ? { ...it, status: it.status === "hidden" ? "visible" : "hidden" }
            : it,
        ),
      );
      setFocused((cur) =>
        cur?.id === item.id
          ? { ...cur, status: cur.status === "hidden" ? "visible" : "hidden" }
          : cur,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Operation failed";
      toast.error(message);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await unpublishGalleryItem(target.id);
      setItems((prev) => prev.filter((it) => it.id !== target.id));
      setFocused((cur) => (cur?.id === target.id ? null : cur));
      toast.success("Deleted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delete failed";
      toast.error(message);
    }
  };

  /**
   * Publisher self-unpublish. The backend unpublish route supports self-unpublish
   * (separate publisher_id == requester_id check outside the is_admin branch), so we reuse the same API here.
   * Same interface and semantics as admin "permanently delete" — unpublish = remove this entry from the gallery,
   * but the original image (image_owners) is untouched, the work remains in "My Works".
   */
  const handleSelfUnpublish = async (item: GalleryItem) => {
    try {
      await unpublishGalleryItem(item.id);
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      setFocused((cur) => (cur?.id === item.id ? null : cur));
      toast.success("Unpublished");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unpublish failed";
      toast.error(message);
    }
  };

  const visibleCount = useMemo(
    () => items.filter((it) => it.status === "visible").length,
    [items],
  );

  // When closing the dialog, setting focused to null immediately causes {focused ? ... : null} content to disappear from DOM instantly,
  // leaving an empty DialogContent that shrinks into a "white line in the center" during Radix fade-out animation.
  // Use lastFocused to cache the last content, continue rendering the same image/buttons before close transition completes,
  // so the whole block fades out together with the shell. Same approach as works page.
  const [lastFocused, setLastFocused] = useState<GalleryItem | null>(null);
  useEffect(() => {
    if (focused) setLastFocused(focused);
  }, [focused]);
  const focusedView = focused ?? lastFocused;

  return (
    <>
      <section className="mt-4 flex flex-col gap-4 sm:mt-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">
            Public Gallery
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Public Gallery</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Loading…"
              : items.length === 0
                ? "No one has published any works yet"
                : `${visibleCount} visible · Click a card to view prompt`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin ? (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-white/80 px-3 py-2 text-sm text-stone-700 hover:bg-white">
              <Checkbox
                checked={includeHidden}
                onCheckedChange={(v) => setIncludeHidden(Boolean(v))}
              />
              <span>Show unlisted</span>
            </label>
          ) : null}
          <Button
            variant="outline"
            className="h-10 rounded-xl border-stone-200 bg-white/80 px-4 text-stone-700 hover:bg-white"
            onClick={() => void loadFirstPage()}
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
            <p className="text-sm text-stone-500">Syncing works from gallery…</p>
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && items.length === 0 ? (
        <Card className="mt-6 rounded-2xl border-white/80 bg-white/90 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <div className="rounded-xl bg-stone-100 p-3 text-stone-500">
              <ImageIcon className="size-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-stone-700">The gallery is empty</p>
              <p className="text-sm text-stone-500">
                Go to &quot;My Works&quot;, open any work, and click &quot;Publish to Gallery&quot; to share
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* True masonry: manually bucket by "current shortest column cumulative height".
          CSS columns + column-fill: balance would balance column heights when content is sparse,
          putting two items into the first column — not a bug, it's the spec — so masonry must be done manually.
          Each column uses flex-col for sequential stacking, inter-column gap-3 on wrapper. */}
      <div className="mt-6 flex gap-3">
        {distributeMasonry(items, colCount).map((bucket, colIdx) => (
          <div key={colIdx} className="flex flex-1 flex-col gap-3">
            {bucket.map((item) => {
              const ratio =
                item.width > 0 && item.height > 0
                  ? item.width / item.height
                  : 1;
              const isHidden = item.status === "hidden";
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFocused(item)}
                  className={cn(
                    "group relative w-full cursor-pointer overflow-hidden rounded-2xl border border-stone-200/80 bg-stone-100 text-left shadow-sm transition hover:shadow-md",
                    isHidden && "opacity-60 hover:opacity-90",
                  )}
                  style={{ aspectRatio: String(ratio) }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.url}
                    alt={item.prompt.slice(0, 30) || "Work"}
                    loading="lazy"
                    className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                  />
                  {isHidden ? (
                    <div className="absolute top-2 left-2 rounded-md bg-rose-500/90 px-2 py-1 text-[10.5px] font-semibold text-white">
                      Unlisted
                    </div>
                  ) : null}
                  {/* Img2img badge: top-right to avoid "Unlisted" badge at top-left.
                      Not shown on pure text-to-image cards to reduce visual noise for regular users. */}
                  {item.is_edit ? (
                    <div className="pointer-events-none absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-amber-500/95 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                      <Wand2 className="size-3" />
                      Img2Img
                    </div>
                  ) : null}
                  {/* Show author/time only on hover, normally pure image — mimics Pinterest's static dense layout feel */}
                  <div className="pointer-events-none absolute right-0 bottom-0 left-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent p-2 text-[10.5px] text-white/90 opacity-0 transition group-hover:opacity-100">
                    <span className="truncate">{item.publisher_name || "Anonymous"}</span>
                    <span className="shrink-0">{formatRelativeTime(item.created_at)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Bottom scroll trigger */}
      <div ref={sentinelRef} className="mt-6 flex h-10 items-center justify-center text-xs text-stone-400">
        {isLoadingMore ? (
          <span className="inline-flex items-center gap-2">
            <LoaderCircle className="size-3 animate-spin" />
            Loading…
          </span>
        ) : hasMore ? (
          "Scroll down to load more"
        ) : items.length > 0 ? (
          "You've reached the end"
        ) : null}
      </div>

      {/* Detail Dialog */}
      <Dialog open={focused !== null} onOpenChange={(open) => (!open ? setFocused(null) : null)}>
        <DialogContent
          showCloseButton={false}
          className="hide-scrollbar max-h-[92vh] overflow-y-auto rounded-2xl p-0 sm:max-w-[760px]"
        >
          {focusedView ? (
            <div className="flex flex-col">
              {/* Image container: iOS Photos / Spotify style "self-blur background" —
                  - Same image as background-image cover filling entire container
                  - Overlay with backdrop-blur + semi-transparent dim to blur into just color atmosphere
                  - Actual image uses object-contain centered, max-h limited to 65vh so dialog fits in one screen
                  For portrait images the side "whitespace" becomes blurred extension of the original image, no longer harsh pure black/grey. */}
              <div
                className="relative overflow-hidden bg-stone-200"
                style={{
                  backgroundImage: `url(${focusedView.url})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              >
                <div className="absolute inset-0 bg-stone-950/35 backdrop-blur-2xl" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={focusedView.url}
                  alt={focusedView.prompt.slice(0, 30) || "Work"}
                  className="relative mx-auto block h-auto max-h-[65vh] w-full object-contain"
                />
              </div>
              <div className="flex flex-col gap-3 p-5">
                <DialogHeader className="gap-1.5 space-y-0">
                  <DialogTitle className="text-base font-semibold">
                    {focusedView.is_edit ? "Img2Img Work" : "Prompt"}
                  </DialogTitle>
                  <DialogDescription className="sr-only">Work details</DialogDescription>
                </DialogHeader>
                {/* Img2img: prompt is a modification instruction relative to reference image ("make it lighter", "add a hat"),
                    backend forces prompt to empty at publish time. Frontend shows amber info card,
                    telling viewer this prompt cannot be independently reused — prevents copying an abstract instruction
                    that produces completely different results. Copy button is also disabled accordingly. */}
                {focusedView.is_edit ? (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] leading-6 text-amber-900">
                    <Wand2 className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <span>
                      This is an img2img work. The prompt depends on the original reference image and cannot be reused independently. Click &quot;Remix&quot; to use this image as a reference for further creation.
                    </span>
                  </div>
                ) : (
                  <div className="rounded-xl bg-stone-50 p-3 text-[13px] leading-6 text-stone-800">
                    {focusedView.prompt || "—"}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  {focusedView.model ? (
                    <Badge variant="secondary" className="rounded-md font-medium">
                      {focusedView.model}
                    </Badge>
                  ) : null}
                  {focusedView.size ? (
                    <Badge variant="secondary" className="rounded-md font-medium">
                      {focusedView.size}
                    </Badge>
                  ) : null}
                  <span>· {focusedView.publisher_name || "Anonymous"}</span>
                  <span>· {formatRelativeTime(focusedView.created_at)}</span>
                  {focusedView.status === "hidden" ? (
                    <Badge className="rounded-md bg-rose-500 text-white">Unlisted</Badge>
                  ) : null}
                </div>

                {/* Main row: 3 CTAs available to all users, strong grid equal-split never wraps.
                    Copy / Remix / View original — View original as a general secondary action stays in main row,
                    avoids admin row being empty for regular users. */}
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Button
                    onClick={() => void handleCopyPrompt(focusedView.prompt)}
                    disabled={focusedView.is_edit || !focusedView.prompt?.trim()}
                    className="h-10 w-full rounded-xl bg-stone-950 px-2 text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500 disabled:hover:bg-stone-300"
                  >
                    <Copy className="size-4" />
                    Copy Prompt
                  </Button>
                  <Button
                    onClick={() => handleRedraw(focusedView)}
                    className="h-10 w-full rounded-xl bg-stone-950 px-2 text-white hover:bg-stone-800"
                  >
                    <Wand2 className="size-4" />
                    Remix
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 w-full rounded-xl border-stone-200 bg-white px-2"
                    onClick={() => window.open(focusedView.url, "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink className="size-4" />
                    View Original
                  </Button>
                </div>
                {/* Admin row: Unpublish (is_mine) / Unlist (admin) / Permanently delete (admin).
                    Dynamically calculate column count = number of matching conditions, so 1/2/3 buttons all equally split width,
                    neither squeezed nor causing "main row 4 + secondary row 1 alone" visual disconnect. */}
                {(() => {
                  const showSelfUnpublish = focusedView.is_mine;
                  const showAdminHide = isAdmin;
                  const showAdminDelete = isAdmin;
                  const cols = (showSelfUnpublish ? 1 : 0) + (showAdminHide ? 1 : 0) + (showAdminDelete ? 1 : 0);
                  if (cols === 0) return null;
                  const gridClass =
                    cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-2" : "grid-cols-3";
                  return (
                    <div className={`grid ${gridClass} gap-2`}>
                      {showSelfUnpublish ? (
                        <Button
                          variant="outline"
                          className="h-10 w-full rounded-xl border-rose-200 bg-white px-2 text-rose-600 hover:bg-rose-50"
                          onClick={() => void handleSelfUnpublish(focusedView)}
                        >
                          <Trash2 className="size-4" />
                          Unpublish
                        </Button>
                      ) : null}
                      {showAdminHide ? (
                        <Button
                          variant="outline"
                          className="h-10 w-full rounded-xl border-stone-200 bg-white px-2"
                          onClick={() => void handleAdminToggleHide(focusedView)}
                        >
                          <EyeOff className="size-4" />
                          {focusedView.status === "hidden" ? "Restore" : "Unlist"}
                        </Button>
                      ) : null}
                      {showAdminDelete ? (
                        <Button
                          className="h-10 w-full rounded-xl bg-rose-600 px-2 text-white hover:bg-rose-700"
                          onClick={() => setPendingDelete(focusedView)}
                        >
                          <Trash2 className="size-4" />
                          Delete Permanently
                        </Button>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Permanent delete confirmation (admin only) */}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => (!open ? setPendingDelete(null) : null)}
      >
        <DialogContent showCloseButton={false} className="rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle>Permanently delete gallery entry?</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              This only removes it from the gallery — the original image is not deleted (the publisher&apos;s &quot;My Works&quot; still retains it). If you just want to temporarily hide it, use &quot;Unlist&quot; instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => void handleConfirmDelete()}
            >
              Confirm Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish entry hint */}
      <div className="mt-12 flex items-center justify-center gap-2 text-xs text-stone-400">
        <Sparkles className="size-3" />
        <span>How to publish: Go to &quot;My Works&quot;, open any work → Publish to Gallery</span>
      </div>
    </>
  );
}

export default function GalleryPage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <GalleryPageContent isAdmin={session.role === "admin"} />;
}
