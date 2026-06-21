"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { History, Infinity as InfinityIcon, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ImageComposer } from "@/app/image/components/image-composer";
import { ImageResults, type ImageLightboxItem, type ImagePublishState } from "@/app/image/components/image-results";
import { ImageSidebar } from "@/app/image/components/image-sidebar";
import { ImageLightbox } from "@/components/image-lightbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  createImageEditTask,
  createImageGenerationTask,
  cancelImageTasks,
  fetchImageTasks,
  fetchMyIdentity,
  publishGalleryItem,
  type ImageTask,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import {
  clearImageConversations,
  deleteImageConversation,
  getImageConversationStats,
  listImageConversations,
  renameImageConversation,
  saveImageConversation,
  saveImageConversations,
  type ImageConversation,
  type ImageConversationMode,
  type ImageTurn,
  type ImageTurnStatus,
  type StoredImage,
  type StoredReferenceImage,
} from "@/store/image-conversations";

const ACTIVE_CONVERSATION_STORAGE_KEY = "chatgpt2api:image_active_conversation_id";
const IMAGE_SIZE_STORAGE_KEY = "chatgpt2api:image_last_size";
const IMAGE_RESOLUTION_STORAGE_KEY = "chatgpt2api:image_last_resolution";
const IMAGE_COUNT_STORAGE_KEY = "chatgpt2api:image_last_count";
const HIGH_RESOLUTION_VALUES = new Set(["2k", "4k"]);
// Store scroll position per conversation separately. Using sessionStorage because this is "session-level" temporary positioning,
// starting from the bottom on browser restart feels more natural; switch to localStorage for cross-session persistence.
const SCROLL_POSITION_STORAGE_KEY = "chatgpt2api:image_scroll_positions";

function clampImageCount(value: string) {
  return String(Math.min(100, Math.max(1, Math.floor(Number(value) || 1))));
}

function isHighResolution(value: string | null | undefined) {
  return HIGH_RESOLUTION_VALUES.has(String(value || "").trim().toLowerCase());
}

const activeConversationQueueIds = new Set<string>();

function buildConversationTitle(prompt: string) {
  const trimmed = prompt.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return `${trimmed.slice(0, 12)}...`;
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatAvailableQuota() {
  // Deprecated: admin displays ∞ directly, no longer aggregates from account pool. Keeping shell to avoid breaking potential external calls.
  return "∞";
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read reference image"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl: string, fileName: string, mimeType?: string) {
  const [header, content] = dataUrl.split(",", 2);
  const matchedMimeType = header.match(/data:(.*?);base64/)?.[1];
  const binary = atob(content || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: mimeType || matchedMimeType || "image/png" });
}

function buildReferenceImageFromResult(image: StoredImage, fileName: string): StoredReferenceImage | null {
  if (!image.b64_json) {
    return null;
  }

  return {
    name: fileName,
    type: "image/png",
    dataUrl: `data:image/png;base64,${image.b64_json}`,
  };
}

async function fetchImageAsFile(url: string, fileName: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to read result image");
  }
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/png" });
}

async function buildReferenceImageFromStoredImage(image: StoredImage, fileName: string) {
  const direct = buildReferenceImageFromResult(image, fileName);
  if (direct) {
    return {
      referenceImage: direct,
      file: dataUrlToFile(direct.dataUrl, direct.name, direct.type),
    };
  }

  if (!image.url) {
    return null;
  }
  const file = await fetchImageAsFile(image.url, fileName);
  return {
    referenceImage: {
      name: file.name,
      type: file.type || "image/png",
      dataUrl: await readFileAsDataUrl(file),
    },
    file,
  };
}

function taskDataToStoredImage(image: StoredImage, task: ImageTask): StoredImage {
  if (task.status === "success") {
    const first = task.data?.[0];
    if (!first?.b64_json && !first?.url) {
      return {
        ...image,
        taskId: task.id,
        status: "error",
        error: "No image data returned",
      };
    }
    return {
      ...image,
      taskId: task.id,
      status: "success",
      b64_json: first.b64_json,
      url: first.url,
      revised_prompt: first.revised_prompt,
      error: undefined,
    };
  }

  if (task.status === "error") {
    return {
      ...image,
      taskId: task.id,
      status: "error",
      error: task.error || "Generation failed",
    };
  }

  if (task.status === "canceled") {
    return {
      ...image,
      taskId: task.id,
      status: "error",
      error: task.error || "Canceled",
    };
  }

  return {
    ...image,
    taskId: task.id,
    status: "loading",
    error: undefined,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function pickFallbackConversationId(conversations: ImageConversation[]) {
  const activeConversation = conversations.find((conversation) =>
    conversation.turns.some((turn) => turn.status === "queued" || turn.status === "generating"),
  );
  return activeConversation?.id ?? conversations[0]?.id ?? null;
}

function sortImageConversations(conversations: ImageConversation[]) {
  return [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function collectLoadingTaskIds(conversation: ImageConversation): string[] {
  const ids: string[] = [];
  for (const turn of conversation.turns) {
    if (turn.resultsDeleted) continue;
    for (const image of turn.images) {
      if (image.status === "loading" && image.taskId) {
        ids.push(image.taskId);
      }
    }
  }
  return ids;
}

function collectTurnLoadingTaskIds(turn: ImageTurn): string[] {
  if (turn.resultsDeleted) return [];
  return turn.images.flatMap((image) =>
    image.status === "loading" && image.taskId ? [image.taskId] : [],
  );
}

async function cancelTaskIdsSilently(ids: string[]) {
  if (ids.length === 0) return;
  try {
    await cancelImageTasks(ids);
  } catch {
    // Cancel failure won't block UI deletion flow; backend tasks will naturally terminate via retry/timeout
  }
}

function deriveTurnStatus(turn: ImageTurn): Pick<ImageTurn, "status" | "error"> {
  const loadingCount = turn.images.filter((image) => image.status === "loading").length;
  const failedCount = turn.images.filter((image) => image.status === "error").length;
  const successCount = turn.images.filter((image) => image.status === "success").length;
  if (loadingCount > 0) {
    return { status: turn.status === "queued" ? "queued" : "generating", error: undefined };
  }
  if (failedCount > 0) {
    return { status: "error", error: `${failedCount} image(s) failed to generate` };
  }
  if (successCount > 0) {
    return { status: "success", error: undefined };
  }
  return { status: "queued", error: undefined };
}

async function syncConversationImageTasks(items: ImageConversation[]) {
  const taskIds = Array.from(
    new Set(
      items.flatMap((conversation) =>
        conversation.turns.flatMap((turn) =>
          turn.resultsDeleted
            ? []
            : turn.images.flatMap((image) => (image.status === "loading" && image.taskId ? [image.taskId] : [])),
        ),
      ),
    ),
  );
  if (taskIds.length === 0) {
    return items;
  }

  let taskList: Awaited<ReturnType<typeof fetchImageTasks>>;
  try {
    taskList = await fetchImageTasks(taskIds);
  } catch {
    return items;
  }
  const taskMap = new Map(taskList.items.map((task) => [task.id, task]));
  let changed = false;
  const normalized = items.map((conversation) => {
    const turns = conversation.turns.map((turn) => {
      let turnChanged = false;
      const images = turn.images.map((image) => {
        if (image.status !== "loading" || !image.taskId) {
          return image;
        }
        const task = taskMap.get(image.taskId);
        if (!task) {
          return image;
        }
        const nextImage = taskDataToStoredImage(image, task);
        if (nextImage !== image) {
          turnChanged = true;
        }
        return nextImage;
      });
      if (!turnChanged) {
        return turn;
      }
      changed = true;
      const derived = deriveTurnStatus({ ...turn, images });
      return {
        ...turn,
        ...derived,
        images,
      };
    });
    if (turns === conversation.turns || !turns.some((turn, index) => turn !== conversation.turns[index])) {
      return conversation;
    }
    return {
      ...conversation,
      turns,
      updatedAt: new Date().toISOString(),
    };
  });

  if (changed) {
    await saveImageConversations(normalized);
  }
  return normalized;
}

async function recoverConversationHistory(items: ImageConversation[]) {
  let changed = false;
  const normalized = items.map((conversation) => {
    const turns = conversation.turns.map((turn) => {
      if (turn.status !== "queued" && turn.status !== "generating") {
        return turn;
      }

      let turnChanged = false;
      const images = turn.images.map((image) => {
        if (image.status !== "loading" || image.taskId) {
          return image;
        }
        turnChanged = true;
        return {
          ...image,
          status: "error" as const,
          error: "Page refreshed or task interrupted, no recoverable task ID found",
        };
      });
      const derived = deriveTurnStatus({ ...turn, images });
      if (!turnChanged && derived.status === turn.status && derived.error === turn.error) {
        return turn;
      }
      changed = true;
      return {
        ...turn,
        ...derived,
        images,
      };
    });

    if (!turns.some((turn, index) => turn !== conversation.turns[index])) {
      return conversation;
    }

    return {
      ...conversation,
      turns,
      updatedAt: new Date().toISOString(),
    };
  });

  if (changed) {
    await saveImageConversations(normalized);
  }

  return syncConversationImageTasks(normalized);
}


function ImagePageContent({ isAdmin }: { isAdmin: boolean }) {
  const didLoadQuotaRef = useRef(false);
  const initialLoadCompleteRef = useRef(false);
  const conversationsRef = useRef<ImageConversation[]>([]);
  const resultsViewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Scroll position: stored independently per conversation, refresh/page changes can return to last position
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const restoredConversationIdRef = useRef<string | null>(null);
  const lastTurnCountRef = useRef<number>(0);
  const lastActiveCountRef = useRef<number>(0);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [imagePrompt, setImagePrompt] = useState("");
  const [imageCount, setImageCount] = useState("1");
  const [imageSize, setImageSize] = useState("");
  const [imageResolution, setImageResolution] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [referenceImageFiles, setReferenceImageFiles] = useState<File[]>([]);
  const [referenceImages, setReferenceImages] = useState<StoredReferenceImage[]>([]);
  const [conversations, setConversations] = useState<ImageConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [availableQuota, setAvailableQuota] = useState("Loading...");
  const [canUseHighResolution, setCanUseHighResolution] = useState(isAdmin);
  const [lightboxImages, setLightboxImages] = useState<ImageLightboxItem[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  // Bottom fade bar only shows when "content exceeds viewport and not scrolled to bottom" —
  // no content, exactly fits, or already scrolled to bottom should not show the gray fog.
  const [showBottomFade, setShowBottomFade] = useState(false);
  // Context recorded when user clicks "Reply" on an error card, only for UI display + assembling API prompt on submit.
  // Won't enter turn.prompt or chat visible list, so user always only sees what they've said.
  const [replyTarget, setReplyTarget] = useState<{
    conversationId: string;
    sourceTurnId: string;
    sourcePrompt: string;
    aiMessage: string;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { type: "one"; id: string }
    | { type: "prompt"; conversationId: string; turnId: string }
    | { type: "results"; conversationId: string; turnId: string }
    | { type: "all" }
    | null
  >(null);

  const parsedCount = useMemo(() => Number(clampImageCount(imageCount)), [imageCount]);
  // Pre-submit optimistic quota check: prevent the double-toast where "sent conversation" success toast is immediately followed by "insufficient quota" error toast.
  // Admin/unlimited/no quota data cases all pass through, letting backend handle it.
  const ensureQuotaForRequest = useCallback(
    (count: number) => {
      if (isAdmin) return true;
      if (availableQuota === "∞") return true;
      if (availableQuota === "Loading..." || availableQuota === "--") return true;
      const remaining = Number(availableQuota);
      if (!Number.isFinite(remaining)) return true;
      if (remaining <= 0) {
        toast.error("Insufficient quota, please contact administrator to add more");
        return false;
      }
      if (remaining < count) {
        toast.error(`Only ${remaining} quota remaining, cannot generate ${count} images`);
        return false;
      }
      return true;
    },
    [availableQuota, isAdmin],
  );
  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );
  const activeTaskCount = useMemo(
    () =>
      conversations.reduce((sum, conversation) => {
        const stats = getImageConversationStats(conversation);
        return sum + stats.queued + stats.running;
      }, 0),
    [conversations],
  );
  const deleteConfirmTitle =
    deleteConfirm?.type === "all"
      ? "Clear History"
      : deleteConfirm?.type === "prompt"
        ? "Delete Prompt Record"
        : deleteConfirm?.type === "results"
          ? "Delete Generation Results"
          : deleteConfirm?.type === "one"
            ? "Delete Conversation"
            : "";
  const deleteConfirmDescription =
    deleteConfirm?.type === "all"
      ? "Are you sure you want to delete all image history? This cannot be undone."
      : deleteConfirm?.type === "prompt"
        ? "Are you sure you want to delete this prompt record? The generation results will be preserved."
        : deleteConfirm?.type === "results"
          ? "Are you sure you want to delete these generation results? The prompt record will be preserved."
          : deleteConfirm?.type === "one"
            ? "Are you sure you want to delete this image conversation? This cannot be undone."
            : "";

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // /works page "Redraw with this image" writes { rel, url, prompt } to sessionStorage then navigates here.
  // On mount, read once: fetch image → convert to File + dataUrl → put in reference image area, prompt fills input box.
  // Clear key immediately after reading to avoid re-triggering on next page refresh.
  // Prefer using rel to build `/images/${rel}` same-origin fetch, avoiding CORS issues when item.url is a backend absolute address
  // (browsers allow <img> cross-origin load but block fetch; old version passing url directly would throw "Failed to fetch" here)
  // ---
  // Reason for not using cancelled guard: dev mode Strict Mode runs effect twice:
  //   1) First: reads payload, removeItem, starts fetch
  //   2) First cleanup: cancelled=true
  //   3) Second: reads sessionStorage as null, returns directly (no new fetch)
  //   4) First fetch completes → cancelled=true → result discarded, state never set
  // Result is "no error but no image". Using ref sentinel ensures global single consumption, and cleanup won't block result persistence.
  const redrawHandoffConsumedRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (redrawHandoffConsumedRef.current) return;
    redrawHandoffConsumedRef.current = true;
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem("chatgpt2api:redraw_handoff");
      if (raw) window.sessionStorage.removeItem("chatgpt2api:redraw_handoff");
    } catch {
      return;
    }
    if (!raw) return;
    let payload: { rel?: string; url?: string; prompt?: string } | null = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const rel = payload?.rel?.trim().replace(/^\/+/, "");
    // Prefer rel → same-origin /images/<rel>, fallback to url (old handoff format)
    const sourceUrl = rel ? `/images/${rel}` : payload?.url?.trim();
    if (!sourceUrl) return;

    void (async () => {
      try {
        const file = await fetchImageAsFile(sourceUrl, `redraw-${Date.now()}.png`);
        const dataUrl = await readFileAsDataUrl(file);
        setReferenceImages((prev) => [
          ...prev,
          { name: file.name, type: file.type || "image/png", dataUrl },
        ]);
        setReferenceImageFiles((prev) => [...prev, file]);
        // Prompt handled separately: may be empty (old data / user didn't fill), if present fill it in, otherwise leave empty for user to write
        if (payload?.prompt && payload.prompt.trim()) {
          setImagePrompt(payload.prompt);
        }
        toast.success("Reference image added. Adjust description and regenerate");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to read reference image";
        toast.error(message);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        const storedSize = typeof window !== "undefined" ? window.localStorage.getItem(IMAGE_SIZE_STORAGE_KEY) : null;
        const storedResolution =
          typeof window !== "undefined" ? window.localStorage.getItem(IMAGE_RESOLUTION_STORAGE_KEY) : null;
        const storedCount = typeof window !== "undefined" ? window.localStorage.getItem(IMAGE_COUNT_STORAGE_KEY) : null;
        setImageSize(storedSize || "");
        setImageResolution(storedResolution || "");
        setImageCount(storedCount ? clampImageCount(storedCount) : "1");

        // Scroll position table only loaded once on browser side on first entry
        if (typeof window !== "undefined") {
          try {
            const raw = window.sessionStorage.getItem(SCROLL_POSITION_STORAGE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === "object") {
                scrollPositionsRef.current = Object.fromEntries(
                  Object.entries(parsed as Record<string, unknown>).filter(
                    ([, value]) => typeof value === "number" && Number.isFinite(value),
                  ),
                ) as Record<string, number>;
              }
            }
          } catch {
            // Parse failure treated as non-existent
          }
        }

        const items = await listImageConversations();
        const normalizedItems = await recoverConversationHistory(items);
        if (cancelled) {
          return;
        }

        conversationsRef.current = normalizedItems;
        setConversations(normalizedItems);
        const storedConversationId =
          typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY) : null;
        let nextSelectedConversationId: string | null;
        if (storedConversationId === "") {
          // User actively entered empty state via "New", preserve empty state after refresh
          nextSelectedConversationId = null;
        } else if (
          storedConversationId &&
          normalizedItems.some((conversation) => conversation.id === storedConversationId)
        ) {
          nextSelectedConversationId = storedConversationId;
        } else {
          nextSelectedConversationId = pickFallbackConversationId(normalizedItems);
        }
        setSelectedConversationId(nextSelectedConversationId);
        initialLoadCompleteRef.current = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load conversation history";
        toast.error(message);
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadQuota = useCallback(async () => {
    if (isAdmin) {
      // Admin key is fully unlimited at the key level; the real bottleneck for image generation is the account pool, not key quota.
      // The top display shows "my own key's image quota", so directly show ∞ —
      // account pool availability has a more accurate view on the "Pool Management" page.
      setCanUseHighResolution(true);
      setAvailableQuota("∞");
      return;
    }
    // Normal user: show remaining image quota for their key. If any of the three tiers (daily/monthly/total) is unlimited, treat as ∞,
    // otherwise take the minimum remaining as available image count — this keeps button disable state consistent with upstream 402 branch.
    try {
      const { identity } = await fetchMyIdentity();
      const canHighResolution = Boolean(
        identity.role === "admin" ||
          identity.can_use_high_resolution ||
          identity.can_use_paid_image_accounts ||
          identity.account_tier === "premium",
      );
      setCanUseHighResolution(canHighResolution);
      if (!canHighResolution) {
        setImageResolution((prev) => (isHighResolution(prev) ? "" : prev));
      }
      const candidates: number[] = [];
      if (!identity.image_daily_unlimited) {
        candidates.push(
          identity.image_daily_remaining ??
            Math.max(0, identity.image_daily_quota - identity.image_daily_used),
        );
      }
      if (!identity.image_monthly_unlimited) {
        candidates.push(
          identity.image_monthly_remaining ??
            Math.max(0, identity.image_monthly_quota - identity.image_monthly_used),
        );
      }
      if (!identity.image_total_unlimited) {
        candidates.push(
          identity.image_total_remaining ??
            Math.max(0, identity.image_total_quota - identity.image_total_used),
        );
      }
      if (candidates.length === 0) {
        setAvailableQuota("∞");
      } else {
        setAvailableQuota(String(Math.min(...candidates)));
      }
    } catch {
      setAvailableQuota((prev) => (prev === "Loading..." ? "--" : prev));
    }
  }, [isAdmin]);

  useEffect(() => {
    if (didLoadQuotaRef.current) {
      return;
    }
    didLoadQuotaRef.current = true;

    const handleFocus = () => {
      void loadQuota();
    };

    void loadQuota();
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [isAdmin, loadQuota]);

  // Scroll behavior:
  // 1) Switch/open conversation first frame → sync to last remembered scrollTop (fallback to bottom, no animation)
  // 2) User submits new turn (turns.length increases) or current turn completes (active count from >0 → 0) → smooth scroll to bottom
  // 3) Other times (image status polling, conversation content fine-tuning) no longer force scroll, user can scroll up to view history
  useLayoutEffect(() => {
    const viewport = resultsViewportRef.current;
    if (!viewport) {
      return;
    }

    // Entering "empty state" (clicked New / deleted all conversations): clear previous conversation's residual scrollTop,
    // otherwise h-full aurora visual center will be pushed up by previous scroll position.
    if (!selectedConversation) {
      viewport.scrollTo({ top: 0, behavior: "auto" });
      restoredConversationIdRef.current = null;
      lastTurnCountRef.current = 0;
      lastActiveCountRef.current = 0;
      setShowBottomFade(false);
      return;
    }

    const conversationId = selectedConversation.id;
    const turnsLength = selectedConversation.turns.length;
    const stats = getImageConversationStats(selectedConversation);
    const activeCount = stats.queued + stats.running;

    // First time seeing this conversation: restore scroll position
    if (restoredConversationIdRef.current !== conversationId) {
      restoredConversationIdRef.current = conversationId;
      const savedTop = scrollPositionsRef.current[conversationId];
      if (typeof savedTop === "number" && Number.isFinite(savedTop)) {
        // Content may not be fully laid out yet, jump once then fix on next frame
        viewport.scrollTo({ top: savedTop, behavior: "auto" });
        requestAnimationFrame(() => {
          viewport.scrollTo({ top: savedTop, behavior: "auto" });
        });
      } else {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
      }
      lastTurnCountRef.current = turnsLength;
      lastActiveCountRef.current = activeCount;
      return;
    }

    const turnAdded = turnsLength > lastTurnCountRef.current;
    const finishedGenerating = lastActiveCountRef.current > 0 && activeCount === 0;

    if (turnAdded || finishedGenerating) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }

    // Recalculate fade on content change: scroll events won't fire automatically on turn add/remove,
    // must manually measure during layout phase, otherwise gray fog won't appear when new content is hidden by composer.
    const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setShowBottomFade(remaining > 8);

    lastTurnCountRef.current = turnsLength;
    lastActiveCountRef.current = activeCount;
  }, [selectedConversation]);

  // Save current scroll position to storage immediately when switching away from conversation, to avoid losing it before next save
  useEffect(() => {
    return () => {
      const viewport = resultsViewportRef.current;
      const conversationId = restoredConversationIdRef.current;
      if (viewport && conversationId) {
        scrollPositionsRef.current[conversationId] = viewport.scrollTop;
        if (typeof window !== "undefined") {
          try {
            window.sessionStorage.setItem(
              SCROLL_POSITION_STORAGE_KEY,
              JSON.stringify(scrollPositionsRef.current),
            );
          } catch {
            // Silently fail when storage is full or disabled
          }
        }
      }
    };
  }, [selectedConversationId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    // Don't write before initial load completes, to avoid overwriting existing valid local value
    if (!initialLoadCompleteRef.current) {
      return;
    }

    if (selectedConversationId) {
      window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, selectedConversationId);
    } else {
      // Empty string as marker for "user actively entered empty state", distinct from never-set null
      window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, "");
    }
  }, [selectedConversationId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (imageSize) {
      window.localStorage.setItem(IMAGE_SIZE_STORAGE_KEY, imageSize);
      return;
    }
    window.localStorage.removeItem(IMAGE_SIZE_STORAGE_KEY);
  }, [imageSize]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!canUseHighResolution && isHighResolution(imageResolution)) {
      window.localStorage.removeItem(IMAGE_RESOLUTION_STORAGE_KEY);
      return;
    }
    if (imageResolution) {
      window.localStorage.setItem(IMAGE_RESOLUTION_STORAGE_KEY, imageResolution);
      return;
    }
    window.localStorage.removeItem(IMAGE_RESOLUTION_STORAGE_KEY);
  }, [canUseHighResolution, imageResolution]);

  useEffect(() => {
    if (!canUseHighResolution && isHighResolution(imageResolution)) {
      setImageResolution("");
    }
  }, [canUseHighResolution, imageResolution]);

  useEffect(() => {
    if (typeof window !== "undefined" && parsedCount > 0) {
      window.localStorage.setItem(IMAGE_COUNT_STORAGE_KEY, String(parsedCount));
    }
  }, [parsedCount]);

  useEffect(() => {
    if (selectedConversationId && !conversations.some((conversation) => conversation.id === selectedConversationId)) {
      setSelectedConversationId(pickFallbackConversationId(conversations));
    }
  }, [conversations, selectedConversationId]);

  const persistConversation = async (conversation: ImageConversation) => {
    const nextConversations = sortImageConversations([
      conversation,
      ...conversationsRef.current.filter((item) => item.id !== conversation.id),
    ]);
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    await saveImageConversation(conversation);
  };

  const updateConversation = useCallback(
    async (
      conversationId: string,
      updater: (current: ImageConversation | null) => ImageConversation,
      options: { persist?: boolean } = {},
    ) => {
      const current = conversationsRef.current.find((item) => item.id === conversationId) ?? null;
      if (!current) {
        // Conversation was deleted (or never existed), don't write back, avoid polling tasks "reviving" deleted data
        return;
      }
      const nextConversation = updater(current);
      const nextConversations = sortImageConversations([
        nextConversation,
        ...conversationsRef.current.filter((item) => item.id !== conversationId),
      ]);
      conversationsRef.current = nextConversations;
      setConversations(nextConversations);
      if (options.persist !== false) {
        await saveImageConversation(nextConversation);
      }
    },
    [],
  );

  const clearComposerInputs = useCallback(() => {
    setImagePrompt("");
    setImageResolution((prev) => (!canUseHighResolution && isHighResolution(prev) ? "" : prev));
    setReferenceImageFiles([]);
    setReferenceImages([]);
    setReplyTarget(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [canUseHighResolution]);

  const resetComposer = useCallback(() => {
    clearComposerInputs();
  }, [clearComposerInputs]);

  const handleCreateDraft = () => {
    setSelectedConversationId(null);
    resetComposer();
    textareaRef.current?.focus();
  };

  const handleDeleteConversation = async (id: string) => {
    const target = conversationsRef.current.find((item) => item.id === id);
    const taskIdsToCancel = target ? collectLoadingTaskIds(target) : [];

    const nextConversations = conversations.filter((item) => item.id !== id);
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    if (selectedConversationId === id) {
      setSelectedConversationId(pickFallbackConversationId(nextConversations));
      resetComposer();
    }

    void cancelTaskIdsSilently(taskIdsToCancel);

    try {
      await deleteImageConversation(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete conversation";
      toast.error(message);
      const items = await listImageConversations();
      conversationsRef.current = items;
      setConversations(items);
    }
  };

  const handleDeleteTurnPart = async (conversationId: string, turnId: string, part: "prompt" | "results") => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    if (!conversation) {
      return;
    }

    const taskIdsToCancel =
      part === "results"
        ? collectTurnLoadingTaskIds(conversation.turns.find((turn) => turn.id === turnId) ?? ({ images: [] } as unknown as ImageTurn))
        : [];

    const turns = conversation.turns
      .map((turn) => {
        if (turn.id !== turnId) {
          return turn;
        }
        const nextTurn = {
          ...turn,
          prompt: part === "prompt" ? "" : turn.prompt,
          promptDeleted: part === "prompt" ? true : turn.promptDeleted,
          resultsDeleted: part === "results" ? true : turn.resultsDeleted,
          status: part === "results" && turn.status === "generating" ? "error" as const : turn.status,
          images:
            part === "results"
              ? turn.images.map((image) => ({ id: image.id, status: "error" as const, error: "Generation results deleted" }))
              : turn.images,
        };
        return nextTurn.promptDeleted && nextTurn.resultsDeleted ? null : nextTurn;
      })
      .filter((turn): turn is ImageTurn => Boolean(turn));

    void cancelTaskIdsSilently(taskIdsToCancel);

    if (turns.length === 0) {
      await handleDeleteConversation(conversationId);
      return;
    }

    const nextConversation = {
      ...conversation,
      updatedAt: new Date().toISOString(),
      turns,
    };
    await persistConversation(nextConversation);
  };

  const handleClearHistory = async () => {
    const taskIdsToCancel = conversationsRef.current.flatMap(collectLoadingTaskIds);

    try {
      await clearImageConversations();
      conversationsRef.current = [];
      setConversations([]);
      setSelectedConversationId(null);
      resetComposer();
      void cancelTaskIdsSilently(taskIdsToCancel);
      toast.success("History cleared");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to clear history";
      toast.error(message);
    }
  };

  const handleRenameConversation = async (id: string, title: string) => {
    const nextConversations = conversations.map((item) =>
      item.id === id ? { ...item, title, updatedAt: new Date().toISOString() } : item,
    );
    conversationsRef.current = sortImageConversations(nextConversations);
    setConversations(conversationsRef.current);
    try {
      await renameImageConversation(id, title);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Rename failed";
      toast.error(message);
    }
  };

  const openDeleteConversationConfirm = (id: string) => {
    setIsHistoryOpen(false);
    setDeleteConfirm({ type: "one", id });
  };

  const openDeletePromptConfirm = (conversationId: string, turnId: string) => {
    setDeleteConfirm({ type: "prompt", conversationId, turnId });
  };

  const openDeleteResultsConfirm = (conversationId: string, turnId: string) => {
    setDeleteConfirm({ type: "results", conversationId, turnId });
  };

  const openClearHistoryConfirm = () => {
    setIsHistoryOpen(false);
    setDeleteConfirm({ type: "all" });
  };

  const handleConfirmDelete = async () => {
    const target = deleteConfirm;
    setDeleteConfirm(null);
    if (!target) {
      return;
    }
    if (target.type === "all") {
      await handleClearHistory();
      return;
    }
    if (target.type === "prompt" || target.type === "results") {
      await handleDeleteTurnPart(target.conversationId, target.turnId, target.type);
      return;
    }
    await handleDeleteConversation(target.id);
  };

  const appendReferenceImages = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    try {
      const previews = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type || "image/png",
          dataUrl: await readFileAsDataUrl(file),
        })),
      );

      setReferenceImageFiles((prev) => [...prev, ...files]);
      setReferenceImages((prev) => [...prev, ...previews]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read reference image";
      toast.error(message);
    }
  }, []);

  const handleReferenceImageChange = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      await appendReferenceImages(files);
    },
    [appendReferenceImages],
  );

  const handleRemoveReferenceImage = useCallback((index: number) => {
    setReferenceImageFiles((prev) => {
      const next = prev.filter((_, currentIndex) => currentIndex !== index);
      if (next.length === 0 && fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return next;
    });
    setReferenceImages((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  }, []);

  const handleContinueEdit = useCallback(
    async (conversationId: string, image: StoredImage | StoredReferenceImage) => {
      try {
        const nextReference =
          "dataUrl" in image
            ? {
                referenceImage: image,
                file: dataUrlToFile(image.dataUrl, image.name, image.type),
              }
            : await buildReferenceImageFromStoredImage(image, `conversation-${conversationId}-${Date.now()}.png`);
        if (!nextReference) {
          return;
        }

        setSelectedConversationId(conversationId);

        setReferenceImages((prev) => [...prev, nextReference.referenceImage]);
        setReferenceImageFiles((prev) => [...prev, nextReference.file]);
        setImagePrompt("");
        textareaRef.current?.focus();
        toast.success("Added to reference images. Enter a description to continue editing");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to read result image";
        toast.error(message);
      }
    },
    [],
  );

  // Single image publish to gallery state machine: image.id → state.
  // Using Map<string, ImagePublishState> instead of array for O(1) lookup;
  // Not persisted to localforage, refreshing page falls back to "not published" — whether published is determined by the "Gallery" page,
  // this is just visual feedback within a session to prevent duplicate clicks.
  const [publishStates, setPublishStates] = useState<Map<string, ImagePublishState>>(
    () => new Map(),
  );

  const publishStateOf = useCallback(
    (image: StoredImage): ImagePublishState => {
      // Prefer recorded state; otherwise determine by whether the image can be published:
      //   - Has url (http(s)): can publish, initial idle
      //   - Only b64_json: local edit product / not addressable remotely, cannot use image_rel primary key → unsupported
      const recorded = publishStates.get(image.id);
      if (recorded) return recorded;
      if (image.url && /^https?:\/\//i.test(image.url)) return "idle";
      return "unsupported";
    },
    [publishStates],
  );

  /**
   * Extract image_rel from generation result url:
   *   http://host:8000/images/2026/05/21/xxx.png?t=123 → 2026/05/21/xxx.png
   * Uses the same rel primary key as backend image_owners.json / gallery_service.
   */
  const extractImageRel = useCallback((url: string | undefined): string | null => {
    if (!url) return null;
    const marker = "/images/";
    const idx = url.indexOf(marker);
    if (idx < 0) return null;
    const tail = url.substring(idx + marker.length);
    const cut = tail.search(/[?#]/);
    const rel = (cut >= 0 ? tail.substring(0, cut) : tail).replace(/^\/+/, "").trim();
    return rel || null;
  }, []);

  const handlePublishImage = useCallback(
    async (conversationId: string, turnId: string, image: StoredImage) => {
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      const turn = conversation?.turns.find((t) => t.id === turnId);
      if (!conversation || !turn) return;

      const rel = extractImageRel(image.url);
      if (!rel) {
        toast.error("This image cannot be published to gallery");
        setPublishStates((prev) => {
          const next = new Map(prev);
          next.set(image.id, "unsupported");
          return next;
        });
        return;
      }

      // Enter publishing: button shows spinner on UI
      setPublishStates((prev) => {
        const next = new Map(prev);
        next.set(image.id, "publishing");
        return next;
      });

      try {
        await publishGalleryItem({
          image_rel: rel,
          prompt: turn.prompt || "",
          model: turn.model || "",
          size: turn.size || "",
        });
        setPublishStates((prev) => {
          const next = new Map(prev);
          next.set(image.id, "published");
          return next;
        });
        toast.success("Published to gallery");
      } catch (error) {
        // Publish failure rolls back to idle, letting user retry
        setPublishStates((prev) => {
          const next = new Map(prev);
          next.set(image.id, "idle");
          return next;
        });
        const message = error instanceof Error ? error.message : "Publish failed";
        toast.error(message);
      }
    },
    [extractImageRel],
  );

  // When model asks a question/refuses, clicking "Reply". Stores AI question + previous turn prompt into replyTarget,
  // but doesn't modify input box text — what's in the input box is always what the user said.
  // On submit, handleSubmit / runConversationQueue silently prepends this context to the prompt sent to the model.
  const handleReplyToTurn = useCallback((conversationId: string, turnId: string, aiMessage: string) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    const sourceTurn = conversation?.turns.find((turn) => turn.id === turnId);
    if (!conversation || !sourceTurn) {
      return;
    }

    setSelectedConversationId(conversationId);
    setReplyTarget({
      conversationId,
      sourceTurnId: turnId,
      sourcePrompt: sourceTurn.prompt,
      aiMessage,
    });

    // Bring over reference images from the current turn as well, otherwise model will be answering into thin air.
    if (sourceTurn.referenceImages.length > 0) {
      setReferenceImages(sourceTurn.referenceImages);
      setReferenceImageFiles(
        sourceTurn.referenceImages.map((image) => dataUrlToFile(image.dataUrl, image.name, image.type)),
      );
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const length = textarea.value.length;
      textarea.setSelectionRange(length, length);
    });
  }, []);

  const handleReuseTurnConfig = useCallback(async (conversationId: string, turnId: string) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    const turn = conversation?.turns.find((item) => item.id === turnId);
    if (!conversation || !turn || !turn.prompt.trim()) {
      return;
    }

    setSelectedConversationId(conversationId);
    setImagePrompt(turn.prompt);
    setImageCount(String(Math.max(1, turn.count || turn.images.length || 1)));
    setImageSize(turn.size);
    setImageResolution(!canUseHighResolution && isHighResolution(turn.resolution) ? "" : turn.resolution || "");
    setReferenceImages(turn.referenceImages);
    setReferenceImageFiles(
      turn.referenceImages.map((image) => dataUrlToFile(image.dataUrl, image.name, image.type)),
    );
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    textareaRef.current?.focus();
    toast.success("Prompt configuration reused");
  }, [canUseHighResolution]);

  const openLightbox = useCallback((images: ImageLightboxItem[], index: number) => {
    if (images.length === 0) {
      return;
    }

    setLightboxImages(images);
    setLightboxIndex(Math.max(0, Math.min(index, images.length - 1)));
    setLightboxOpen(true);
  }, []);

  const createLoadingImages = (turnId: string, count: number) =>
    Array.from({ length: count }, (_, index) => {
      const imageId = `${turnId}-${index}`;
      return {
        id: imageId,
        taskId: imageId,
        status: "loading" as const,
      };
    });

  /* eslint-disable react-hooks/preserve-manual-memoization */
  const runConversationQueue = useCallback(
    async (conversationId: string) => {
      if (activeConversationQueueIds.has(conversationId)) {
        return;
      }

      const snapshot = conversationsRef.current.find((conversation) => conversation.id === conversationId);
      const activeTurn = snapshot?.turns.find(
        (turn) =>
          (turn.status === "queued" || turn.status === "generating") &&
          turn.images.some((image) => image.status === "loading"),
      );
      if (!snapshot || !activeTurn) {
        return;
      }

      activeConversationQueueIds.add(conversationId);
      const applyTasks = async (tasks: ImageTask[]) => {
        const taskMap = new Map(tasks.map((task) => [task.id, task]));
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          const turns = conversation.turns.map((turn) => {
            if (turn.id !== activeTurn.id) {
              return turn;
            }
            const images = turn.images.map((image) => {
              const taskId = image.taskId || image.id;
              const task = taskMap.get(taskId);
              return task ? taskDataToStoredImage({ ...image, taskId }, task) : image;
            });
            const derived = deriveTurnStatus({ ...turn, status: "generating", images });
            return {
              ...turn,
              ...derived,
              images,
            };
          });
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns,
          };
        });
      };

      try {
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns: conversation.turns.map((turn) =>
              turn.id === activeTurn.id
                ? {
                    ...turn,
                    status: "generating",
                    error: undefined,
                    images: turn.images.map((image) =>
                      image.status === "loading" ? { ...image, taskId: image.taskId || image.id } : image,
                    ),
                  }
                : turn,
            ),
          };
        });

        const referenceFiles = activeTurn.referenceImages.map((image, index) =>
          dataUrlToFile(image.dataUrl, image.name || `${activeTurn.id}-${index + 1}.png`, image.type),
        );
        if (activeTurn.mode === "edit" && referenceFiles.length === 0) {
          throw new Error("No reference image found for continued editing");
        }

        // What's in turn.prompt for the user is always only what they said;
        // but when calling the model, we need to prepend previous turn prompt + AI question for context.
        const apiPrompt = (() => {
          const ctx = activeTurn.replyContext;
          if (!ctx) {
            return activeTurn.prompt;
          }
          const lines: string[] = [];
          if (ctx.sourcePrompt.trim()) {
            lines.push(`[My previous request] ${ctx.sourcePrompt.trim()}`);
          }
          if (ctx.aiMessage.trim()) {
            lines.push(`[Your previous question] ${ctx.aiMessage.trim()}`);
          }
          lines.push(`[My reply] ${activeTurn.prompt}`);
          return lines.join("\n");
        })();

        const pendingImages = activeTurn.images.filter((image) => image.status === "loading");
        const submitted = await Promise.all(
          pendingImages.map((image) => {
            const taskId = image.taskId || image.id;
            return activeTurn.mode === "edit"
              ? createImageEditTask(taskId, referenceFiles, apiPrompt, activeTurn.model, activeTurn.size, activeTurn.resolution)
              : createImageGenerationTask(taskId, apiPrompt, activeTurn.model, activeTurn.size, activeTurn.resolution);
          }),
        );
        await applyTasks(submitted);

        while (true) {
          const latestConversation = conversationsRef.current.find((conversation) => conversation.id === conversationId);
          const latestTurn = latestConversation?.turns.find((turn) => turn.id === activeTurn.id);
          const loadingTaskIds =
            latestTurn?.images.flatMap((image) =>
              image.status === "loading" && image.taskId ? [image.taskId] : [],
            ) || [];
          if (loadingTaskIds.length === 0) {
            break;
          }

          await sleep(2000);
          const taskList = await fetchImageTasks(loadingTaskIds);
          if (taskList.items.length > 0) {
            await applyTasks(taskList.items);
          }
          if (taskList.missing_ids.length > 0 && latestTurn) {
            const missingImages = latestTurn.images.filter(
              (image) => image.status === "loading" && image.taskId && taskList.missing_ids.includes(image.taskId),
            );
            const resubmitted = await Promise.all(
              missingImages.map((image) =>
                activeTurn.mode === "edit"
                  ? createImageEditTask(image.taskId || image.id, referenceFiles, apiPrompt, activeTurn.model, activeTurn.size, activeTurn.resolution)
                  : createImageGenerationTask(image.taskId || image.id, apiPrompt, activeTurn.model, activeTurn.size, activeTurn.resolution),
              ),
            );
            if (resubmitted.length > 0) {
              await applyTasks(resubmitted);
            }
          }
        }

        await loadQuota();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image generation failed";
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns: conversation.turns.map((turn) =>
              turn.id === activeTurn.id
                ? {
                    ...turn,
                    status: "error",
                    error: message,
                    images: turn.images.map((image) =>
                      image.status === "loading" ? { ...image, status: "error", error: message } : image,
                    ),
                  }
                : turn,
            ),
          };
        });
        toast.error(message);
      } finally {
        activeConversationQueueIds.delete(conversationId);
        for (const conversation of conversationsRef.current) {
          if (
            !activeConversationQueueIds.has(conversation.id) &&
            conversation.turns.some(
              (turn) =>
                (turn.status === "queued" || turn.status === "generating") &&
                turn.images.some((image) => image.status === "loading"),
            )
          ) {
            void runConversationQueue(conversation.id);
          }
        }
      }
    },
    [loadQuota, updateConversation],
  );
  /* eslint-enable react-hooks/preserve-manual-memoization */

  const handleRegenerateTurn = useCallback(
    async (conversationId: string, turnId: string) => {
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      const sourceTurn = conversation?.turns.find((turn) => turn.id === turnId);
      if (!conversation || !sourceTurn || !sourceTurn.prompt.trim()) {
        return;
      }

      const count = Math.max(1, sourceTurn.count || sourceTurn.images.length || 1);
      if (!ensureQuotaForRequest(count)) {
        return;
      }

      const now = new Date().toISOString();
      const nextTurnId = createId();
      const nextTurn: ImageTurn = {
        id: nextTurnId,
        prompt: sourceTurn.prompt,
        model: sourceTurn.model,
        mode: sourceTurn.mode,
        referenceImages: sourceTurn.referenceImages,
        count,
        size: sourceTurn.size,
        images: createLoadingImages(nextTurnId, count),
        createdAt: now,
        status: "queued",
        // Preserve original turn's reply context during regeneration, otherwise model loses previous turn's dialogue context.
        replyContext: sourceTurn.replyContext,
      };
      const nextConversation = {
        ...conversation,
        updatedAt: now,
        turns: [...conversation.turns, nextTurn],
      };

      setSelectedConversationId(conversationId);
      await persistConversation(nextConversation);
      void runConversationQueue(conversationId);
      toast.success("Added to regeneration queue");
    },
    [ensureQuotaForRequest, runConversationQueue],
  );

  const handleRetryImage = useCallback(
    async (conversationId: string, turnId: string, imageId: string) => {
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      if (!conversation) {
        return;
      }

      if (!ensureQuotaForRequest(1)) {
        return;
      }

      const now = new Date().toISOString();
      const retryImageId = `${turnId}-${createId()}`;
      const nextConversation = {
        ...conversation,
        updatedAt: now,
        turns: conversation.turns.map((turn) => {
          if (turn.id !== turnId) {
            return turn;
          }
          if (!turn.prompt.trim()) {
            return turn;
          }

          const images = turn.images.map((image) =>
            image.id === imageId
              ? {
                  id: retryImageId,
                  taskId: retryImageId,
                  status: "loading" as const,
                }
              : image,
          );
          const derived = deriveTurnStatus({ ...turn, status: "queued", images });
          return {
            ...turn,
            ...derived,
            images,
          };
        }),
      };

      setSelectedConversationId(conversationId);
      await persistConversation(nextConversation);
      void runConversationQueue(conversationId);
    },
    [ensureQuotaForRequest, runConversationQueue],
  );

  useEffect(() => {
    for (const conversation of conversations) {
      if (
        !activeConversationQueueIds.has(conversation.id) &&
        conversation.turns.some(
          (turn) =>
            !turn.resultsDeleted &&
            (turn.status === "queued" || turn.status === "generating") &&
            turn.images.some((image) => image.status === "loading"),
        )
      ) {
        void runConversationQueue(conversation.id);
      }
    }
  }, [conversations, runConversationQueue]);

  const handleSubmit = async () => {
    const prompt = imagePrompt.trim();
    if (!prompt) {
      toast.error("Please enter a prompt");
      return;
    }

    if (!ensureQuotaForRequest(parsedCount)) {
      return;
    }

    const effectiveImageMode: ImageConversationMode = referenceImageFiles.length > 0 ? "edit" : "generate";

    const targetConversation = selectedConversationId
      ? conversationsRef.current.find((conversation) => conversation.id === selectedConversationId) ?? null
      : null;
    const now = new Date().toISOString();
    const conversationId = targetConversation?.id ?? createId();
    const turnId = createId();
    // Only attach context when reply target belongs to current conversation, avoid replyTarget leaking after switching conversations.
    const activeReplyContext =
      replyTarget && replyTarget.conversationId === conversationId
        ? {
            sourceTurnId: replyTarget.sourceTurnId,
            sourcePrompt: replyTarget.sourcePrompt,
            aiMessage: replyTarget.aiMessage,
          }
        : undefined;
    const draftTurn: ImageTurn = {
      id: turnId,
      prompt,
      model: "gpt-image-2",
      mode: effectiveImageMode,
      referenceImages: effectiveImageMode === "edit" ? referenceImages : [],
      count: parsedCount,
      size: imageSize,
      resolution: canUseHighResolution || !isHighResolution(imageResolution) ? imageResolution : "",
      images: createLoadingImages(turnId, parsedCount),
      createdAt: now,
      status: "queued",
      replyContext: activeReplyContext,
    };

    const baseConversation: ImageConversation = targetConversation
      ? {
          ...targetConversation,
          updatedAt: now,
          turns: [...targetConversation.turns, draftTurn],
        }
      : {
          id: conversationId,
          title: buildConversationTitle(prompt),
          createdAt: now,
          updatedAt: now,
          turns: [draftTurn],
        };

    setSelectedConversationId(conversationId);
    clearComposerInputs();

    await persistConversation(baseConversation);
    void runConversationQueue(conversationId);

    // No longer showing "sent / created / added to queue" toast:
    // User just clicked the send button, the canvas below will immediately show a "processing" placeholder card,
    // state change is already visible, popping another toast would break the rhythm.
  };

  return (
    <>
      <section className="relative mx-auto flex h-[calc(100dvh-3.5rem)] min-h-0 w-full max-w-[1380px] flex-col gap-2 overflow-hidden px-0 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:h-[calc(100dvh-4rem)] sm:gap-3 sm:px-3 sm:pb-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-2 pt-2 sm:px-4 sm:pt-3">
          <div className="pointer-events-auto flex items-center gap-2">
          <Button
            variant="outline"
            className="group h-9 cursor-pointer rounded-lg border-border bg-card/90 px-3 text-foreground shadow-[0_4px_16px_-6px_rgba(15,23,42,0.18)] backdrop-blur"
            onClick={() => setIsHistoryOpen(true)}
          >
            <History className="size-4 text-muted-foreground" />
            <span className="max-w-[180px] truncate text-[13px] font-medium sm:max-w-[260px]">
              History
            </span>
            <span className="font-data text-[10px] text-muted-foreground">{conversations.length}</span>
          </Button>
          <Button
            className="h-9 cursor-pointer rounded-lg bg-foreground px-3 text-background shadow-[0_4px_16px_-6px_rgba(15,23,42,0.35)] hover:bg-foreground/90"
            onClick={handleCreateDraft}
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline text-[13px]">New</span>
          </Button>
          <Button
            variant="outline"
            className="h-9 cursor-pointer rounded-lg border-border bg-card/90 px-2 text-muted-foreground shadow-[0_4px_16px_-6px_rgba(15,23,42,0.18)] backdrop-blur hover:text-rose-500"
            onClick={openClearHistoryConfirm}
            disabled={conversations.length === 0}
            title="Clear history"
          >
            <Trash2 className="size-4" />
          </Button>
          </div>
          <div className="pointer-events-auto ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-md border border-border bg-card/90 px-2 py-1 shadow-[0_4px_16px_-6px_rgba(15,23,42,0.18)] backdrop-blur sm:inline-flex">
              <span className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Quota</span>
              {availableQuota === "∞" ? (
                <InfinityIcon className="size-3.5 text-foreground" strokeWidth={2.25} aria-label="Unlimited quota" />
              ) : (
                <span className="font-data tabular-nums text-[12px] font-semibold text-foreground">{availableQuota}</span>
              )}
            </span>
            <span className="hidden items-center gap-1.5 rounded-md border border-border bg-card/90 px-2 py-1 shadow-[0_4px_16px_-6px_rgba(15,23,42,0.18)] backdrop-blur sm:inline-flex">
              <span className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Active</span>
              <span className="font-data tabular-nums text-[12px] font-semibold text-foreground">{activeTaskCount}</span>
            </span>
          </div>
        </div>

        <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
          <DialogContent className="flex h-[min(82dvh,720px)] w-[92vw] max-w-[440px] flex-col overflow-hidden rounded-[24px] bg-background p-0">
            <DialogHeader className="shrink-0 border-b border-border/50 px-6 py-4">
              <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
                <History className="size-[17px] text-muted-foreground" strokeWidth={2} />
                History
                <span className="ml-1 font-data text-[11px] font-medium text-muted-foreground/70">
                  {conversations.length}
                </span>
              </DialogTitle>
            </DialogHeader>
            <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
              <ImageSidebar
                conversations={conversations}
                isLoadingHistory={isLoadingHistory}
                selectedConversationId={selectedConversationId}
                onCreateDraft={() => {
                  handleCreateDraft();
                  setIsHistoryOpen(false);
                }}
                onClearHistory={openClearHistoryConfirm}
                onSelectConversation={(id) => {
                  setSelectedConversationId(id);
                  setIsHistoryOpen(false);
                }}
                onDeleteConversation={openDeleteConversationConfirm}
                onRenameConversation={handleRenameConversation}
                formatConversationTime={formatConversationTime}
                hideActionButtons
              />
            </div>
          </DialogContent>
        </Dialog>

        <div className="flex min-h-0 flex-1 flex-col">

          <div
            ref={resultsViewportRef}
            onScroll={(event) => {
              const target = event.currentTarget;
              // Sync bottom fade: only show when remaining scrollable distance exceeds one line height,
              // hide when scrolled to bottom / no overflow, avoiding gray fog persisting when there's no content.
              const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
              setShowBottomFade(remaining > 8);
              const conversationId = restoredConversationIdRef.current;
              if (!conversationId) return;
              scrollPositionsRef.current[conversationId] = target.scrollTop;
              if (scrollSaveTimerRef.current) {
                clearTimeout(scrollSaveTimerRef.current);
              }
              scrollSaveTimerRef.current = setTimeout(() => {
                if (typeof window === "undefined") return;
                try {
                  window.sessionStorage.setItem(
                    SCROLL_POSITION_STORAGE_KEY,
                    JSON.stringify(scrollPositionsRef.current),
                  );
                } catch {
                  // Silently fail when storage is full or disabled
                }
              }, 200);
            }}
            className={`hide-scrollbar min-h-0 flex-1 overscroll-contain px-1 pt-14 pb-6 sm:px-4 sm:pt-16 sm:pb-8 ${selectedConversation ? "overflow-y-auto" : "overflow-hidden"}`}
          >
            {isLoadingHistory ? (
              // Placeholder before history finishes loading, avoiding the "empty state"
              // aurora big screen flashing briefly then jumping away visual jitter when selectedConversation === null.
              <div aria-hidden className="h-full" />
            ) : (
              <ImageResults
                selectedConversation={selectedConversation}
                onOpenLightbox={openLightbox}
                onContinueEdit={handleContinueEdit}
                onDeletePrompt={openDeletePromptConfirm}
                onDeleteResults={openDeleteResultsConfirm}
                onReuseTurnConfig={handleReuseTurnConfig}
                onRegenerateTurn={handleRegenerateTurn}
                onRetryImage={handleRetryImage}
                onReplyToTurn={handleReplyToTurn}
                onPublishImage={handlePublishImage}
                publishStateOf={publishStateOf}
                formatConversationTime={formatConversationTime}
              />
            )}
          </div>

          <div className="relative shrink-0 px-1 sm:px-4">
            {selectedConversation && showBottomFade ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-full h-10 bg-gradient-to-b from-transparent to-background sm:h-14"
              />
            ) : null}
            <div className="mx-auto w-full max-w-[820px]">
            <ImageComposer
              prompt={imagePrompt}
              imageCount={imageCount}
              imageSize={imageSize}
              imageResolution={imageResolution}
              canUseHighResolution={canUseHighResolution}
              availableQuota={availableQuota}
              activeTaskCount={activeTaskCount}
              referenceImages={referenceImages}
              textareaRef={textareaRef}
              fileInputRef={fileInputRef}
              replyTarget={
                replyTarget && replyTarget.conversationId === selectedConversationId
                  ? { sourcePrompt: replyTarget.sourcePrompt, aiMessage: replyTarget.aiMessage }
                  : null
              }
              onCancelReply={() => {
                // Reference images during reply were automatically added by handleReplyToTurn,
                // clear them together when user cancels reply, avoiding thumbnails "resurrecting".
                setReplyTarget(null);
                setReferenceImages([]);
                setReferenceImageFiles([]);
                if (fileInputRef.current) {
                  fileInputRef.current.value = "";
                }
              }}
              onPromptChange={setImagePrompt}
              onImageCountChange={(value) => setImageCount(value ? clampImageCount(value) : "")}
              onImageSizeChange={setImageSize}
              onImageResolutionChange={setImageResolution}
              onSubmit={handleSubmit}
              onPickReferenceImage={() => fileInputRef.current?.click()}
              onReferenceImageChange={handleReferenceImageChange}
              onRemoveReferenceImage={handleRemoveReferenceImage}
            />
            </div>
          </div>
        </div>
      </section>

      <ImageLightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />

      {deleteConfirm ? (
        <Dialog open onOpenChange={(open) => (!open ? setDeleteConfirm(null) : null)}>
          <DialogContent showCloseButton={false} className="rounded-2xl p-6">
            <DialogHeader className="gap-2">
              <DialogTitle>{deleteConfirmTitle}</DialogTitle>
              <DialogDescription className="text-sm leading-6">
                {deleteConfirmDescription}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button className="bg-rose-600 text-white hover:bg-rose-700" onClick={() => void handleConfirmDelete()}>
                Confirm Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export default function ImagePage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <ImagePageContent isAdmin={session.role === "admin"} />;
}
