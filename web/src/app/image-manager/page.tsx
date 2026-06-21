"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, ImageIcon, LoaderCircle, Maximize2, Plus, RefreshCw, Search, Share2, Tag, Trash2, User, X } from "lucide-react";
import { toast } from "sonner";

import { DateRangeFilter } from "@/components/date-range-filter";
import { ImageLightbox } from "@/components/image-lightbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { deleteImageTag, deleteManagedImages, downloadImages, downloadSingleImage, fetchImageOwners, fetchImageTags, fetchManagedImages, getMyPublishedBatch, publishGalleryItem, setImageTags, type ImageOwner, type ManagedImage } from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";

const LONG_PRESS_MS = 800;

function formatSize(size: number) {
  return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(2)} MB` : `${Math.ceil(size / 1024)} KB`;
}

function imageKey(item: ManagedImage) {
  return item.rel || item.url;
}

// User filter dropdown. max-h capped at 320px, the list itself uses .scrollbar-fancy for custom thin scrollbar,
// visual style consistent with the global stone color scheme; empty state, unowned, and deleted users are explicitly indicated.
// Three semantic pinned items: All Users / Admin (__admin__) / Unowned (__unowned__), other specific users are searchable below the divider.
function OwnerFilter({
  value,
  owners,
  open,
  onOpenChange,
  onChange,
}: {
  value: string;
  owners: ImageOwner[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (next: string) => void;
}) {
  const [query, setQuery] = useState("");
  // Reset: clear search keyword every time the dropdown is reopened, to avoid persisting last filter state on next open.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const adminBucket = owners.find((item) => item.id === "__admin__") ?? null;
  const unownedBucket = owners.find((item) => item.id === "__unowned__") ?? null;
  const realOwners = owners.filter((item) => item.id !== "__admin__" && item.id !== "__unowned__");
  const normalized = query.trim().toLowerCase();
  const filteredOwners = normalized
    ? realOwners.filter(
        (item) =>
          item.name.toLowerCase().includes(normalized) || item.id.toLowerCase().includes(normalized),
      )
    : realOwners;

  const selected = owners.find((item) => item.id === value) ?? null;
  const buttonLabel = !value
    ? "All Users"
    : value === "__admin__"
      ? "Admin"
      : value === "__unowned__"
        ? "Unowned"
        : selected?.name || value;
  const totalCount =
    realOwners.reduce((sum, item) => sum + item.count, 0) +
    (adminBucket?.count ?? 0) +
    (unownedBucket?.count ?? 0);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 cursor-pointer rounded-xl border-stone-200 bg-white px-3 text-stone-700 hover:bg-stone-50"
        >
          <User className="size-4 text-stone-500" />
          <span className="max-w-[160px] truncate text-[13px]">{buttonLabel}</span>
          {selected ? (
            <span className="font-data tabular-nums rounded-md bg-stone-100 px-1.5 text-[10px] text-stone-500">
              {selected.count}
            </span>
          ) : null}
          <ChevronDown className="size-3.5 text-stone-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 overflow-hidden rounded-xl border-stone-200 bg-white p-0 shadow-[0_4px_20px_-4px_rgba(15,23,42,0.18)]"
      >
        <div className="border-b border-stone-100 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-stone-400" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search users"
              className="h-8 w-full rounded-lg border border-stone-200 bg-white pr-7 pl-7 text-[12.5px] text-stone-700 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-600"
                title="Clear search"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="scrollbar-fancy max-h-[320px] overflow-y-auto py-1">
          {/* Three fixed navigation items: All / Admin / Unowned. They remain visible even when query is non-empty,
              as they are navigation-type entries that should always be accessible. */}
          <OwnerOption
            label="All Users"
            hint={`${totalCount} images`}
            selected={!value}
            onClick={() => onChange("")}
          />
          {adminBucket ? (
            <OwnerOption
              label="Admin"
              hint={`${adminBucket.count} images`}
              special
              selected={value === "__admin__"}
              onClick={() => onChange("__admin__")}
            />
          ) : null}
          {unownedBucket ? (
            <OwnerOption
              label="Unowned"
              hint={`${unownedBucket.count} images`}
              special
              selected={value === "__unowned__"}
              onClick={() => onChange("__unowned__")}
            />
          ) : null}
          <div className="my-1 h-px bg-stone-100" />
          {realOwners.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-stone-400">No user keys yet</div>
          ) : filteredOwners.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-stone-400">No matching users</div>
          ) : (
            filteredOwners.map((item) => (
              <OwnerOption
                key={item.id}
                label={item.name}
                hint={`${item.count} images`}
                deleted={item.deleted}
                selected={value === item.id}
                onClick={() => onChange(item.id)}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OwnerOption({
  label,
  hint,
  selected,
  deleted,
  special,
  onClick,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  deleted?: boolean;
  special?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
        selected ? "bg-stone-100 text-stone-900" : "text-stone-700 hover:bg-stone-50"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`flex size-4 shrink-0 items-center justify-center rounded-full ${
            selected ? "bg-stone-900 text-white" : "bg-transparent text-transparent"
          }`}
        >
          <Check className="size-3" />
        </span>
        <span className={`truncate ${special ? "text-stone-500" : ""}`}>{label}</span>
        {deleted ? (
          <Badge variant="secondary" className="rounded-md bg-rose-50 px-1.5 py-0 text-[10px] text-rose-600">
            Deleted
          </Badge>
        ) : null}
      </span>
      {hint ? (
        <span className="font-data tabular-nums shrink-0 text-[11px] text-stone-400">{hint}</span>
      ) : null}
    </button>
  );
}

// Module-level cache. The component remounts every time user navigates back to image-manager,
// without cache, items start from [] with isLoading=true causing grid height to jump from 0 to N rows,
// visually the worst "jitter" page outside of settings.
type ImageManagerCache = {
  items: ManagedImage[];
  allTags: string[];
  owners: ImageOwner[];
  startDate: string;
  endDate: string;
  owner: string;
};
let cachedImageManager: ImageManagerCache | null = null;

function useLongPress(onLongPress: () => void, ms = LONG_PRESS_MS) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);

  const start = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    activeRef.current = true;
    timerRef.current = setTimeout(() => {
      if (activeRef.current) {
        onLongPress();
      }
    }, ms);
  }, [onLongPress, ms]);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    onMouseDown: start,
    onMouseUp: stop,
    onMouseLeave: stop,
    onTouchStart: start,
    onTouchEnd: stop,
  };
}

function ImageManagerContent() {
  // Use cache as initial state when available, to avoid grid collapsing to empty then expanding back on navigation.
  const [items, setItemsState] = useState<ManagedImage[]>(() => cachedImageManager?.items ?? []);
  const [startDate, setStartDate] = useState(() => cachedImageManager?.startDate ?? "");
  const [endDate, setEndDate] = useState(() => cachedImageManager?.endDate ?? "");
  const [owner, setOwner] = useState(() => cachedImageManager?.owner ?? "");
  const [owners, setOwnersState] = useState<ImageOwner[]>(() => cachedImageManager?.owners ?? []);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(() => cachedImageManager === null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedImage | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [allTags, setAllTagsState] = useState<string[]>(() => cachedImageManager?.allTags ?? []);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagEditTarget, setTagEditTarget] = useState<ManagedImage | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [dialogVisible, setDialogVisible] = useState(false);
  const deleteTargetRef = useRef<ManagedImage | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [deleteMode, setDeleteMode] = useState<"selected" | "filtered" | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Gallery publish state: rel → "publishing" | "published".
  // From admin perspective, it may not be published by the current account; marked "published" if any user has published it,
  // backend batch API automatically queries across users with check_any_publisher=True for admin requests.
  const [publishStates, setPublishStates] = useState<Map<string, "publishing" | "published">>(
    () => new Map(),
  );
  // Publisher display name: rel → publisher_name. Only used for published badge tooltip to show "Published by xx",
  // helps admin quickly identify who published it on the management page.
  const [publisherNames, setPublisherNames] = useState<Map<string, string>>(() => new Map());
  // When no prompt available, show dialog for manual input, reuses same pattern as works page
  const [pendingPublish, setPendingPublish] = useState<ManagedImage | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [publishingDialog, setPublishingDialog] = useState(false);

  // Sync cache when writing items / allTags, so next navigation back gets the latest values.
  // Supports both value and functional updater forms (legacy code heavily uses setItems(prev => ...)).
  const setItems = useCallback(
    (next: ManagedImage[] | ((prev: ManagedImage[]) => ManagedImage[])) => {
      setItemsState((prev) => {
        const value = typeof next === "function" ? (next as (p: ManagedImage[]) => ManagedImage[])(prev) : next;
        cachedImageManager = {
          items: value,
          allTags: cachedImageManager?.allTags ?? [],
          owners: cachedImageManager?.owners ?? [],
          startDate,
          endDate,
          owner,
        };
        return value;
      });
    },
    [startDate, endDate, owner],
  );
  const setAllTags = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      setAllTagsState((prev) => {
        const value = typeof next === "function" ? (next as (p: string[]) => string[])(prev) : next;
        cachedImageManager = {
          items: cachedImageManager?.items ?? [],
          allTags: value,
          owners: cachedImageManager?.owners ?? [],
          startDate,
          endDate,
          owner,
        };
        return value;
      });
    },
    [startDate, endDate, owner],
  );
  const setOwners = useCallback(
    (next: ImageOwner[]) => {
      // Safety guard: always write only arrays to state and cache. During dev Fast Refresh occasionally
      // passes stale state slots, which would crash subsequent `for..of`/`.find` operations; intercept at write point.
      const safe = Array.isArray(next) ? next : [];
      setOwnersState(safe);
      cachedImageManager = {
        items: cachedImageManager?.items ?? [],
        allTags: cachedImageManager?.allTags ?? [],
        owners: safe,
        startDate,
        endDate,
        owner,
      };
    },
    [startDate, endDate, owner],
  );

  const filteredItems = selectedTags.length > 0
    ? items.filter((item) => selectedTags.every((t) => (item.tags ?? []).includes(t)))
    : items;

  const lightboxImages = filteredItems.map((item) => ({
    id: item.name,
    src: item.url,
    sizeLabel: formatSize(item.size),
    dimensions: item.width && item.height ? `${item.width} x ${item.height}` : undefined,
  }));
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const currentRows = filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const ownerNameById = useMemo(() => {
    const map = new Map<string, string>();
    // dev Fast Refresh occasionally passes stale state slots here, guard against non-array scenario
    if (!Array.isArray(owners)) return map;
    for (const item of owners) {
      if (!item || typeof item !== "object") continue;
      map.set(item.id, item.name || item.id);
    }
    return map;
  }, [owners]);
  const selectedCount = deleteMode === "filtered" ? items.length : selectedPaths.length;
  const currentPageSelected = currentRows.length > 0 && currentRows.every((item) => selectedSet.has(imageKey(item)));
  const allSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedSet.has(imageKey(item)));

  const loadImages = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [data, tagsData, ownersData] = await Promise.all([
        fetchManagedImages({ start_date: startDate, end_date: endDate, owner }),
        fetchImageTags(),
        fetchImageOwners(),
      ]);
      setItems(data.items);
      setAllTags(tagsData.tags);
      setOwners(ownersData.items);
      setSelectedPaths((current) => current.filter((path) => data.items.some((item) => imageKey(item) === path)));
      setPage(1);
      // Seed publish states: admin perspective backend returns all published rels across users.
      // Non-blocking for main flow; silently fails, retry on next reload.
      const rels = data.items.map((it) => it.rel).filter(Boolean);
      if (rels.length > 0) {
        try {
          const { items: published } = await getMyPublishedBatch(rels);
          setPublishStates((prev) => {
            const next = new Map(prev);
            // Clear old states for this batch before writing new ones — prevents stale badges from remaining after someone unpublishes
            for (const rel of rels) next.delete(rel);
            for (const [rel, info] of Object.entries(published)) {
              if (info.published) next.set(rel, "published");
            }
            return next;
          });
          setPublisherNames((prev) => {
            const next = new Map(prev);
            for (const rel of rels) next.delete(rel);
            for (const [rel, info] of Object.entries(published)) {
              if (info.publisher_name) next.set(rel, info.publisher_name);
            }
            return next;
          });
        } catch {
          // Silent: failure to fetch publish states should not block the list
        }
      }
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : "Failed to load images");
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  const closeDialog = useCallback(() => {
    setDialogVisible(false);
    setTimeout(() => setDeleteTarget(null), 200);
  }, []);

  /**
   * Publish to gallery. Admin can publish any user's image; backend publish route skips owner validation for admin.
   *  - Has prompt: publish directly, passes content filter → success → green checkmark visual
   *  - No prompt: show dialog for admin to manually fill (can leave empty), publish on submit
   */
  const handlePublish = useCallback(
    async (item: ManagedImage, promptOverride?: string) => {
      const rel = item.rel;
      if (!rel) {
        toast.error("This image cannot be published");
        return;
      }
      let prompt: string;
      if (promptOverride !== undefined) {
        prompt = promptOverride.trim();
      } else {
        prompt = (item.prompt ?? "").trim();
        if (!prompt) {
          // Card itself has no prompt → show dialog for admin to decide whether to add one (empty is also fine)
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
        // Rollback state on failure to allow retry
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
    const text = promptDraft.trim();
    setPublishingDialog(true);
    try {
      await handlePublish(pendingPublish, text);
      setPendingPublish(null);
      setPromptDraft("");
    } finally {
      setPublishingDialog(false);
    }
  }, [handlePublish, pendingPublish, promptDraft]);

  const openDeleteDialog = useCallback((item: ManagedImage) => {
    deleteTargetRef.current = item;
    setDeleteTarget(item);
    setDialogVisible(true);
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteManagedImages({ paths: [deleteTarget.rel] });
      setItems((prev) => prev.filter((item) => item.rel !== deleteTarget.rel));
      setSelectedPaths((prev) => prev.filter((p) => p !== imageKey(deleteTarget)));
      toast.success("Image deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setIsDeleting(false);
      closeDialog();
    }
  };

  const handleSetTags = async (item: ManagedImage, tags: string[]) => {
    try {
      const result = await setImageTags(item.rel, tags);
      setItems((prev) => prev.map((i) => i.rel === item.rel ? { ...i, tags: result.tags } : i));
      const tagsData = await fetchImageTags();
      setAllTags(tagsData.tags);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to set tags");
    }
  };

  const handleAddTag = (item: ManagedImage) => {
    const tag = tagInput.trim();
    if (!tag) return;
    const current = item.tags ?? [];
    if (current.includes(tag)) {
      toast.error("Tag already exists");
      return;
    }
    void handleSetTags(item, [...current, tag]);
    setTagInput("");
  };

  const handleRemoveTag = (item: ManagedImage, tag: string) => {
    void handleSetTags(item, (item.tags ?? []).filter((t) => t !== tag));
  };

  const toggleFilterTag = (tag: string) => {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
    setPage(1);
  };

  const [pressingTag, setPressingTag] = useState<string | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tagDeleteTarget, setTagDeleteTarget] = useState<string | null>(null);

  const handleDeleteTag = async (tag: string) => {
    try {
      const result = await deleteImageTag(tag);
      setAllTags((prev) => prev.filter((t) => t !== tag));
      setSelectedTags((prev) => prev.filter((t) => t !== tag));
      setItems((prev) => prev.map((item) => ({
        ...item,
        tags: (item.tags ?? []).filter((t) => t !== tag),
      })));
      toast.success(`Tag "${tag}" deleted, affected ${result.removed_from} images`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete tag");
    }
  };

  const startTagPress = useCallback((tag: string) => {
    setPressingTag(tag);
    pressTimerRef.current = setTimeout(() => {
      setPressingTag(null);
      setTagDeleteTarget(tag);
    }, LONG_PRESS_MS);
  }, []);

  const stopTagPress = useCallback(() => {
    setPressingTag(null);
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  const clearFilters = () => {
    setStartDate("");
    setEndDate("");
    setOwner("");
    setSelectedTags([]);
  };

  const togglePaths = (paths: string[], checked: boolean) => {
    setSelectedPaths((current) => checked ? Array.from(new Set([...current, ...paths])) : current.filter((path) => !paths.includes(path)));
  };

  const confirmDelete = async () => {
    if (!deleteMode || selectedCount === 0) return;
    setIsDeleting(true);
    try {
      const data = await deleteManagedImages(
        deleteMode === "filtered"
          ? { start_date: startDate, end_date: endDate, owner, all_matching: true }
          : { paths: selectedPaths },
      );
      toast.success(`Deleted ${data.removed} images`);
      setDeleteMode(null);
      setSelectedPaths([]);
      await loadImages();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete images");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBatchDownload = async () => {
    const paths = deleteMode === "filtered" ? items.map((item) => item.rel) : selectedPaths;
    if (paths.length === 0) return;
    setIsDownloading(true);
    try {
      await downloadImages(paths);
      toast.success(`Downloaded ${paths.length} images`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSingleDownload = async (item: ManagedImage) => {
    await downloadSingleImage(item.rel);
  };

  // First mount with cache hit (filter matches cache) → silent refresh;
  // subsequent filter changes trigger effect with normal spinner.
  const isFirstRunRef = useRef(true);
  useEffect(() => {
    const isFirst = isFirstRunRef.current;
    isFirstRunRef.current = false;
    const cacheMatches =
      !!cachedImageManager &&
      cachedImageManager.startDate === startDate &&
      cachedImageManager.endDate === endDate &&
      cachedImageManager.owner === owner;
    void loadImages(isFirst && cacheMatches);
  }, [startDate, endDate, owner]);

  return (
    <section className="mt-4 space-y-5 sm:mt-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">Images</div>
          <h1 className="text-2xl font-semibold tracking-tight">Image Manager</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <DateRangeFilter startDate={startDate} endDate={endDate} onChange={(start, end) => { setStartDate(start); setEndDate(end); }} />
          <OwnerFilter
            value={owner}
            owners={owners}
            open={ownerPickerOpen}
            onOpenChange={setOwnerPickerOpen}
            onChange={(next) => {
              setOwner(next);
              setOwnerPickerOpen(false);
            }}
          />
          <Button variant="outline" onClick={clearFilters} className="h-10 rounded-xl border-stone-200 bg-white px-4 text-stone-700">
            Clear Filters
          </Button>
          <Button onClick={() => void loadImages()} disabled={isLoading} className="h-10 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800">
            {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
            Search
          </Button>
          <Button variant="outline" onClick={() => setDeleteMode("filtered")} disabled={isDeleting || items.length === 0 || (!startDate && !endDate && !owner)} className="h-10 rounded-xl border-rose-200 bg-white px-4 text-rose-600 hover:bg-rose-50">
            <Trash2 className="size-4" />
            Delete Matching Results
          </Button>
        </div>
      </div>

      {allTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-stone-500">
            <Tag className="mr-1 inline size-3.5" />
            Filter by Tag:
          </span>
          {allTags.map((tag) => {
            const isPressing = pressingTag === tag;
            return (
              <span
                key={tag}
                className="relative inline-flex items-center"
                onMouseDown={() => startTagPress(tag)}
                onMouseUp={stopTagPress}
                onMouseLeave={stopTagPress}
                onTouchStart={() => startTagPress(tag)}
                onTouchEnd={stopTagPress}
              >
                <button
                  type="button"
                  onClick={() => toggleFilterTag(tag)}
                >
                  <Badge
                    variant={selectedTags.includes(tag) ? "default" : "outline"}
                    className={`cursor-pointer rounded-md transition-all hover:opacity-80 ${isPressing ? "ring-2 ring-red-400 ring-offset-1" : ""}`}
                  >
                    {tag}
                  </Badge>
                </button>
                {isPressing ? (
                  <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
                    <span className="absolute inset-0 animate-[grow_800ms_linear_forwards] rounded-md bg-red-400/20" />
                  </span>
                ) : null}
              </span>
            );
          })}
          {selectedTags.length > 0 ? (
            <button type="button" onClick={() => setSelectedTags([])}>
              <Badge variant="secondary" className="cursor-pointer rounded-md">
                <X className="mr-0.5 size-3" />
                Clear
              </Badge>
            </button>
          ) : null}
        </div>
      ) : null}

      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
            <div className="flex flex-wrap items-center gap-3 text-sm text-stone-600">
              <ImageIcon className="size-4" />
              Total {filteredItems.length} images
              {selectedTags.length > 0 ? <span className="text-stone-400">(filtered from {items.length} images)</span> : null}
              <label className="flex items-center gap-2">
                <Checkbox checked={currentPageSelected} onCheckedChange={(checked) => togglePaths(currentRows.map(imageKey), Boolean(checked))} />
                Select Page
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={allSelected} onCheckedChange={(checked) => togglePaths(filteredItems.map(imageKey), Boolean(checked))} />
                Select All
              </label>
              {selectedPaths.length > 0 ? <span>{selectedPaths.length} selected</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" className="h-8 rounded-lg px-3 text-stone-500" onClick={() => void loadImages()} disabled={isLoading}>
                <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <button type="button" className="text-sm text-stone-500 hover:text-stone-900 disabled:text-stone-300" onClick={() => setSelectedPaths([])} disabled={selectedPaths.length === 0 || isDeleting}>
                Deselect
              </button>
              <Button variant="outline" className="h-8 rounded-lg border-stone-200 bg-white px-3 text-stone-600 hover:bg-stone-50" onClick={() => void handleBatchDownload()} disabled={selectedPaths.length === 0 || isDownloading || isDeleting}>
                {isDownloading ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                Download Selected
              </Button>
              <Button variant="outline" className="h-8 rounded-lg border-rose-200 bg-white px-3 text-rose-600 hover:bg-rose-50" onClick={() => setDeleteMode("selected")} disabled={selectedPaths.length === 0 || isDeleting}>
                <Trash2 className="size-4" />
                Delete Selected
              </Button>
            </div>
          </div>
          <div className="grid gap-0 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {currentRows.map((item) => {
              const imageIndex = filteredItems.findIndex((row) => row.url === item.url);
              const publishState = publishStates.get(item.rel);
              const publishedBy = publisherNames.get(item.rel);
              return (
              <div key={item.rel} className="group border-r border-b border-stone-100 p-4 transition hover:bg-stone-50">
                <div className="relative">
                  <button
                    type="button"
                    className="relative block aspect-square w-full cursor-zoom-in overflow-hidden rounded-lg bg-stone-100 text-left"
                    onClick={() => {
                      setLightboxIndex(imageIndex);
                      setLightboxOpen(true);
                    }}
                  >
                    <img
                      src={item.thumbnail_url || item.url}
                      alt={item.name}
                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                      onError={(event) => {
                        if (event.currentTarget.src !== item.url) {
                          event.currentTarget.src = item.url;
                        }
                      }}
                    />
                    <span className="absolute right-2 bottom-2 rounded-full bg-black/50 p-2 text-white opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                      <Maximize2 className="size-4" />
                    </span>
                  </button>
                  {/* Top-left "Published" badge: displayed if any user has published this image to the gallery.
                      Tooltip shows publisher name (backend attaches publisher_name for admin requests),
                      helps admin quickly identify who published it; regular login cannot access this page. */}
                  {publishState === "published" ? (
                    <div
                      className="absolute top-2 left-2 z-10 rounded-md bg-emerald-500/95 px-2 py-1 text-[10.5px] font-semibold text-white shadow-sm"
                      title={publishedBy ? `Published by ${publishedBy}` : "Published to gallery"}
                    >
                      Published
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="absolute top-2 right-2 z-10 inline-flex size-7 items-center justify-center rounded-full bg-black/50 text-white opacity-100 transition hover:bg-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                    title="Delete image"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDeleteDialog(item);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <div className="mt-3 space-y-2 text-xs text-stone-500">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex items-center gap-1 font-medium text-stone-700">
                        <CalendarDays className="size-3.5" />
                        {item.created_at}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Publish to gallery: when published, turns emerald solid and non-clickable; publishing shows spinner.
                          stopPropagation prevents bubbling to trigger card lightbox. */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`size-8 rounded-lg ${
                          publishState === "published"
                            ? "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                            : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handlePublish(item);
                        }}
                        disabled={publishState === "publishing" || publishState === "published"}
                        title={
                          publishState === "published"
                            ? publishedBy
                              ? `Published to gallery (${publishedBy})`
                              : "Published to gallery"
                            : "Publish to gallery"
                        }
                      >
                        {publishState === "publishing" ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <Share2 className="size-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                        onClick={() => void handleSingleDownload(item)}
                        title="Download image"
                      >
                        <Download className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                        onClick={() => {
                          void navigator.clipboard.writeText(item.url);
                          toast.success("Image URL copied");
                        }}
                      >
                        <Copy className="size-4" />
                      </Button>
                      <Checkbox checked={selectedSet.has(imageKey(item))} onCheckedChange={(checked) => togglePaths([imageKey(item)], Boolean(checked))} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>{formatSize(item.size)}</span>
                    <span>{item.width && item.height ? `${item.width} x ${item.height}` : "-"}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {item.owner_id ? (() => {
                      // Three source display rules:
                      // - admin (including legacy auth_key fixed id "admin"): uniformly display "Admin", don't expose specific key names
                      // - regular users: display username (covered by ownerNameById), fallback to truncated id if not found
                      // - true orphans (empty owner_id): already filtered out by the condition above
                      const isAdmin = item.is_admin_owner || item.owner_id === "admin";
                      const display = isAdmin ? "Admin" : (ownerNameById.get(item.owner_id) || item.owner_id);
                      return (
                        <Badge
                          variant="outline"
                          className="gap-0.5 rounded-md border-stone-200 bg-stone-50 px-1.5 py-0 text-[10px] font-medium text-stone-600"
                          title={`Generator: ${display}`}
                        >
                          <User className="size-2.5 text-stone-400" />
                          <span className="max-w-[88px] truncate">{display}</span>
                        </Badge>
                      );
                    })() : null}
                    {(item.tags ?? []).map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-0.5 rounded-md py-0 pr-0.5 text-[10px]">
                        {tag}
                        <button
                          type="button"
                          className="inline-flex size-3.5 items-center justify-center rounded-full hover:bg-stone-300"
                          onClick={() => handleRemoveTag(item, tag)}
                        >
                          <X className="size-2.5" />
                        </button>
                      </Badge>
                    ))}
                    <Popover open={tagEditTarget?.rel === item.rel} onOpenChange={(open) => { setTagEditTarget(open ? item : null); setTagInput(""); }}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex size-5 items-center justify-center rounded-full border border-dashed border-stone-300 text-stone-400 hover:border-stone-500 hover:text-stone-600"
                          title="Add tag"
                        >
                          <Plus className="size-3" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-56 p-2">
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-stone-500">Add Tag</div>
                          <div className="flex gap-1">
                            <Input
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              placeholder="Enter tag name"
                              className="h-8 text-xs"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleAddTag(item);
                                }
                              }}
                            />
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-8 shrink-0"
                              onClick={() => handleAddTag(item)}
                            >
                              <Plus className="size-3.5" />
                            </Button>
                          </div>
                          {allTags.filter((t) => !(item.tags ?? []).includes(t)).length > 0 ? (
                            <div className="flex flex-wrap gap-1 border-t border-stone-100 pt-2">
                              {allTags.filter((t) => !(item.tags ?? []).includes(t)).map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => {
                                    void handleSetTags(item, [...(item.tags ?? []), tag]);
                                    setTagEditTarget(null);
                                  }}
                                >
                                  <Badge variant="outline" className="cursor-pointer rounded-md text-[10px] hover:bg-stone-100">
                                    {tag}
                                  </Badge>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </div>
            )})}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-stone-100 px-4 py-3 text-sm text-stone-500">
            <span>Page {safePage} / {pageCount}, {filteredItems.length} images total</span>
            <Button variant="outline" size="icon" className="size-9 rounded-lg border-stone-200 bg-white" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="icon" className="size-9 rounded-lg border-stone-200 bg-white" disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          {!isLoading && filteredItems.length === 0 ? <div className="px-6 py-14 text-center text-sm text-stone-500">No images found</div> : null}
        </CardContent>
      </Card>

      <Dialog open={dialogVisible} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-sm overflow-hidden rounded-2xl">
          <DialogHeader>
            <DialogTitle className="pr-8">Confirm Delete</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-stone-600">
            Are you sure you want to delete this image? This action cannot be undone.
          </p>
          {deleteTarget ? (
            <div className="flex items-center gap-3 overflow-hidden rounded-xl border border-stone-200 bg-stone-50 p-3">
              <img
                src={deleteTarget.thumbnail_url || deleteTarget.url}
                alt=""
                className="size-16 shrink-0 rounded-lg object-cover"
                onError={(e) => { if (e.currentTarget.src !== deleteTarget.url) e.currentTarget.src = deleteTarget.url; }}
              />
              <div className="min-w-0 overflow-hidden text-xs text-stone-500">
                <div className="truncate font-medium text-stone-700">{deleteTarget.name}</div>
                <div className="truncate">{deleteTarget.created_at}</div>
                <div>{formatSize(deleteTarget.size)}</div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} className="rounded-xl">
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={isDeleting} className="rounded-xl">
              {isDeleting ? <LoaderCircle className="mr-1 size-4 animate-spin" /> : <Trash2 className="mr-1 size-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImageLightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />
      <Dialog open={Boolean(deleteMode)} onOpenChange={(open) => (!open ? setDeleteMode(null) : null)}>
        <DialogContent showCloseButton={false} className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>{deleteMode === "filtered" ? "Delete Matching Results" : "Delete Selected Images"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-stone-600">
            Are you sure you want to delete {selectedCount} images? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setDeleteMode(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button className="rounded-xl bg-rose-600 text-white hover:bg-rose-700" onClick={() => void confirmDelete()} disabled={isDeleting || selectedCount === 0}>
              {isDeleting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Confirm Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(tagDeleteTarget)} onOpenChange={(open) => { if (!open) setTagDeleteTarget(null); }}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Delete Tag</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-stone-600">
            Are you sure you want to delete the tag <span className="font-semibold">"{tagDeleteTarget}"</span>? It will be removed from all images.
          </p>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setTagDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-xl"
              onClick={() => {
                if (tagDeleteTarget) void handleDeleteTag(tagDeleteTarget);
                setTagDeleteTarget(null);
              }}
            >
              Confirm Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish to gallery: when the image itself has no saved prompt (early generation / image-to-image without text),
          this dialog lets admin decide whether to add one. Empty is allowed — backend publish supports empty prompt. */}
      <Dialog
        open={Boolean(pendingPublish)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingPublish(null);
            setPromptDraft("");
          }
        }}
      >
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Publish to Gallery</DialogTitle>
            <DialogDescription className="text-stone-500">
              This image has no saved prompt. You can add a description, or publish without one.
            </DialogDescription>
          </DialogHeader>
          {pendingPublish ? (
            <div className="flex items-center gap-3 overflow-hidden rounded-xl border border-stone-200 bg-stone-50 p-3">
              <img
                src={pendingPublish.thumbnail_url || pendingPublish.url}
                alt=""
                className="size-16 shrink-0 rounded-lg object-cover"
                onError={(e) => { if (e.currentTarget.src !== pendingPublish.url) e.currentTarget.src = pendingPublish.url; }}
              />
              <div className="min-w-0 overflow-hidden text-xs text-stone-500">
                <div className="truncate font-medium text-stone-700">{pendingPublish.name}</div>
                <div className="truncate">{pendingPublish.created_at}</div>
              </div>
            </div>
          ) : null}
          <Input
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            placeholder="Optional: add a prompt for this image"
            className="h-10 rounded-xl"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !publishingDialog) {
                e.preventDefault();
                void handleConfirmPendingPublish();
              }
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                setPendingPublish(null);
                setPromptDraft("");
              }}
              disabled={publishingDialog}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-stone-950 text-white hover:bg-stone-800"
              onClick={() => void handleConfirmPendingPublish()}
              disabled={publishingDialog}
            >
              {publishingDialog ? <LoaderCircle className="size-4 animate-spin" /> : <Share2 className="size-4" />}
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default function ImageManagerPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);
  if (isCheckingAuth || !session || session.role !== "admin") {
    return <div className="flex min-h-[40vh] items-center justify-center"><LoaderCircle className="size-5 animate-spin text-stone-400" /></div>;
  }
  return <ImageManagerContent />;
}
