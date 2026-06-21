"use client";

import { useState } from "react";
import {
  AlertCircle,
  Check,
  Clock3,
  Download,
  Info,
  LoaderCircle,
  Reply,
  RotateCcw,
  Share2,
  Sparkles,
  Trash2,
  WalletCards,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import type { ImageConversation, ImageTurnStatus, StoredImage, StoredReferenceImage } from "@/store/image-conversations";

export type ImageLightboxItem = {
  id: string;
  src: string;
  sizeLabel?: string;
  dimensions?: string;
};

/**
 * Publish state of a single image in the gallery.
 *  - idle: not published (default)
 *  - publishing: request in progress
 *  - published: already published
 *  - unsupported: local b64 image without image_rel, cannot publish to gallery (button disabled)
 */
export type ImagePublishState = "idle" | "publishing" | "published" | "unsupported";

type ImageResultsProps = {
  selectedConversation: ImageConversation | null;
  onOpenLightbox: (images: ImageLightboxItem[], index: number) => void;
  onContinueEdit: (conversationId: string, image: StoredImage | StoredReferenceImage) => void;
  onDeletePrompt: (conversationId: string, turnId: string) => void;
  onDeleteResults: (conversationId: string, turnId: string) => void;
  onReuseTurnConfig: (conversationId: string, turnId: string) => void | Promise<void>;
  onRegenerateTurn: (conversationId: string, turnId: string) => void | Promise<void>;
  onRetryImage: (conversationId: string, turnId: string, imageId: string) => void | Promise<void>;
  onReplyToTurn?: (conversationId: string, turnId: string, aiMessage: string) => void;
  /**
   * Publish a single image to gallery. Passes turnId + image together so parent component
   * can access turn.prompt / model / size to build the publish request body.
   * Parent uses publishState to determine the display state of each image.
   */
  onPublishImage?: (conversationId: string, turnId: string, image: StoredImage) => void | Promise<void>;
  /** Publish state indexed by image.id. Maintained as a Map by parent component. */
  publishStateOf?: (image: StoredImage) => ImagePublishState;
  formatConversationTime: (value: string) => string;
};

function getStoredImageSrc(image: StoredImage) {
  if (image.b64_json) {
    return `data:image/png;base64,${image.b64_json}`;
  }
  return image.url || "";
}

// Specifically identifies "insufficient quota" errors. These should not let users click "retry" or "reply" —
// retrying will just be rejected by the backend again, and the model didn't actually ask anything, so there's nothing to reply to.
// Shows a dedicated card with guidance to contact the administrator.
function isQuotaError(message: string | undefined | null) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes("quota") || lower.includes("used up");
}

async function downloadStoredImage(image: StoredImage, index: number) {
  let blob: Blob;
  if (image.b64_json) {
    const binary = atob(image.b64_json);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    blob = new Blob([bytes], { type: "image/png" });
  } else if (image.url) {
    const res = await fetch(image.url);
    blob = await res.blob();
  } else {
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `image-${index + 1}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Error card displays the full "model question/refusal" text directly,
// letting the card height adapt to content length, avoiding flickering/misalignment with tooltips.
// Rendered with react-markdown, overriding native tag styles to fit the card's small font context.
// Lists/code/links are compactly styled to avoid breaking the layout.
function ErrorMessageBlock({ message }: { message: string }) {
  return (
    <div
      className={cn(
        "text-[12px] leading-5 break-words text-stone-600 sm:text-[13px] sm:leading-6",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1 whitespace-pre-wrap">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-stone-800">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-stone-700 underline decoration-stone-300 underline-offset-2 transition hover:text-stone-900 hover:decoration-stone-500"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-4">{children}</ol>,
          li: ({ children }) => <li className="leading-5 sm:leading-6">{children}</li>,
          h1: ({ children }) => <h1 className="my-1 text-[13px] font-semibold text-stone-800 sm:text-sm">{children}</h1>,
          h2: ({ children }) => <h2 className="my-1 text-[13px] font-semibold text-stone-800 sm:text-sm">{children}</h2>,
          h3: ({ children }) => <h3 className="my-1 text-[12px] font-semibold text-stone-800 sm:text-[13px]">{children}</h3>,
          h4: ({ children }) => <h4 className="my-1 text-[12px] font-semibold text-stone-800 sm:text-[13px]">{children}</h4>,
          h5: ({ children }) => <h5 className="my-1 text-[12px] font-semibold text-stone-800 sm:text-[13px]">{children}</h5>,
          h6: ({ children }) => <h6 className="my-1 text-[12px] font-semibold text-stone-800 sm:text-[13px]">{children}</h6>,
          blockquote: ({ children }) => (
            <blockquote className="my-1 border-l-2 border-stone-200 pl-2 text-stone-500">{children}</blockquote>
          ),
          hr: () => <hr className="my-2 border-stone-200" />,
          code: ({ className, children, ...props }) => {
            const isInline = !/language-/.test(className || "");
            if (isInline) {
              return (
                <code
                  className="rounded bg-stone-100 px-1 py-0.5 text-[11px] font-mono text-stone-800 sm:text-[12px]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={cn("font-mono text-[11px] sm:text-[12px]", className)} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-1 overflow-x-auto rounded-lg bg-stone-100 px-2 py-1.5 text-[11px] leading-5 text-stone-800 sm:text-[12px]">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-1 overflow-x-auto">
              <table className="w-full border-collapse text-[11px] sm:text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-stone-200 bg-stone-50 px-2 py-1 text-left font-medium text-stone-700">{children}</th>
          ),
          td: ({ children }) => <td className="border border-stone-200 px-2 py-1">{children}</td>,
        }}
      >
        {message}
      </ReactMarkdown>
    </div>
  );
}

export function ImageResults({
  selectedConversation,
  onOpenLightbox,
  onContinueEdit,
  onDeletePrompt,
  onDeleteResults,
  onReuseTurnConfig,
  onRegenerateTurn,
  onRetryImage,
  onReplyToTurn,
  onPublishImage,
  publishStateOf,
  formatConversationTime,
}: ImageResultsProps) {
  const [imageDimensions, setImageDimensions] = useState<Record<string, string>>({});

  const updateImageDimensions = (id: string, width: number, height: number) => {
    const dimensions = formatImageDimensions(width, height);
    setImageDimensions((current) => {
      if (current[id] === dimensions) {
        return current;
      }
      return { ...current, [id]: dimensions };
    });
  };

  if (!selectedConversation) {
    return (
      <div className="relative flex h-full items-center justify-center text-center">
        {/* Decoration layer wrapped in fixed inset-0 + overflow-hidden,
            clipping spots that exceed the viewport to avoid scrollbars;
            inner spots use absolute, positioned relative to this viewport-sized container.
            z-0 keeps it below content, behind navbar (z-40), navbar backdrop-blur naturally softens what shows through. */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
          style={{
            // Ellipse feathering: fully preserved within center 18%, smoothly transitions outward to fully transparent,
            // no visible "light layer" outline at the edges.
            maskImage:
              "radial-gradient(ellipse 60% 70% at 50% 50%, #000 18%, rgba(0,0,0,0.6) 55%, transparent 95%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 60% 70% at 50% 50%, #000 18%, rgba(0,0,0,0.6) 55%, transparent 95%)",
          }}
        >
          {/* Aurora spots: cool blue + warm cream, offset floating, softer + larger radius, avoiding hard edges */}
          <div
            className="aurora-drift-a absolute top-[-10%] left-[-8%] size-[720px] blur-[130px]"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, oklch(0.74 0.11 250 / 0.40), transparent 70%)",
            }}
          />
          <div
            className="aurora-drift-b absolute right-[-8%] bottom-[-8%] size-[720px] blur-[130px]"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, oklch(0.80 0.09 60 / 0.36), transparent 70%)",
            }}
          />
          {/* Counter-corner accent, adding a thin layer to avoid "diagonal gaps" */}
          <div
            className="aurora-drift-b absolute top-[-6%] right-[8%] size-[520px] blur-[120px]"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, oklch(0.82 0.07 60 / 0.24), transparent 70%)",
            }}
          />
          <div
            className="aurora-drift-a absolute bottom-[-6%] left-[10%] size-[520px] blur-[120px]"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, oklch(0.76 0.09 250 / 0.26), transparent 70%)",
            }}
          />

          {/* Center slow-rotating conic ultra-faint halo, gives the scene "breathing" without forming boundaries */}
          <div
            className="aurora-spin absolute top-1/2 left-1/2 size-[960px] -translate-x-1/2 -translate-y-1/2 opacity-50 blur-2xl"
            style={{
              background:
                "conic-gradient(from 90deg at 50% 50%, transparent 0deg, oklch(0.85 0.06 250 / 0.18) 70deg, transparent 150deg, oklch(0.86 0.06 60 / 0.16) 250deg, transparent 330deg)",
            }}
          />
        </div>

        {/* Copy content */}
        <div className="relative w-full max-w-4xl px-6">
          {/* Eyebrow above title */}
          <div className="mb-5 flex items-center justify-center gap-3 sm:mb-6">
            <span className="h-px w-10 bg-stone-300" />
            <span className="font-data text-[10px] font-semibold tracking-[0.32em] text-stone-500 uppercase">
              Generative · Atelier
            </span>
            <span className="h-px w-10 bg-stone-300" />
          </div>

          <h1
            className="text-2xl font-semibold tracking-tight text-stone-950 sm:text-3xl md:text-5xl"
            style={{
              fontFamily: '"Palatino Linotype","Book Antiqua","URW Palladio L","Times New Roman",serif',
            }}
          >
            Turn ideas into images
          </h1>
          <p
            className="mx-auto mt-3 max-w-[280px] text-sm italic tracking-[0.01em] text-stone-500 sm:mt-4 sm:max-w-none sm:text-[15px]"
            style={{
              fontFamily: '"Palatino Linotype","Book Antiqua","URW Palladio L","Times New Roman",serif',
            }}
          >
            Retain local history and task state in the same window, and continue stateless editing from existing results.
          </p>

          {/* Number axis below title */}
          <div className="mt-7 flex items-center justify-center gap-3 sm:mt-9">
            <span className="font-data text-[10px] font-semibold tracking-[0.28em] text-stone-400 tabular-nums">
              01
            </span>
            <span className="h-px w-12 bg-stone-300/80" />
            <span className="font-data text-[10px] font-semibold tracking-[0.28em] text-stone-400 uppercase">
              Sketch → Render
            </span>
            <span className="h-px w-12 bg-stone-300/80" />
            <span className="font-data text-[10px] font-semibold tracking-[0.28em] text-stone-400 tabular-nums">
              02
            </span>
          </div>
        </div>
      </div>
    );
  }

  // All "successfully generated" images across the entire conversation (in turn order).
  // The lightbox's left thumbnail strip uses this list; reference images (user uploads) are not included.
  const allSuccessfulImages: ImageLightboxItem[] = selectedConversation.turns.flatMap((turn) =>
    turn.images.flatMap((image) => {
      const src = image.status === "success" ? getStoredImageSrc(image) : "";
      if (!src) return [];
      return [
        {
          id: image.id,
          src,
          sizeLabel: image.b64_json ? formatBase64ImageSize(image.b64_json) : undefined,
          dimensions: imageDimensions[image.id],
        },
      ];
    }),
  );

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5 sm:gap-8">
      {selectedConversation.turns.map((turn, turnIndex) => {
        const referenceLightboxImages = turn.referenceImages.map((image, index) => ({
          id: `${turn.id}-reference-${index}`,
          src: image.dataUrl,
        }));
        const hasRenderableImages = turn.images.some((image) => image.status === "success" || image.status === "error");
        const hasLoadingImages = turn.images.some((image) => image.status === "loading");
        const showImageGrid = hasRenderableImages || hasLoadingImages;

        return (
          <div key={turn.id} className="flex flex-col gap-3 sm:gap-4">
            {!turn.promptDeleted ? (
              <div className="flex justify-end">
                <div className="group max-w-[92%] sm:max-w-[78%]">
                  <div className="mb-1.5 flex flex-wrap justify-end gap-2 px-1 text-[11px] text-stone-400">
                    <span className="font-data tabular-nums">Turn {turnIndex + 1}</span>
                    <span>{turn.mode === "edit" ? "Image edit" : "Text-to-image"}</span>
                    <span>{formatConversationTime(turn.createdAt)}</span>
                  </div>
                  <div className="rounded-[22px] rounded-tr-md border border-stone-200/80 bg-white/90 px-4 py-3 text-left text-[14px] leading-6 text-stone-900 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_30px_-18px_rgba(15,23,42,0.22)] backdrop-blur sm:rounded-[26px] sm:rounded-tr-md sm:px-5 sm:py-3.5 sm:text-[15px] sm:leading-7">
                    <div className="whitespace-pre-wrap break-words">{turn.prompt}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5 opacity-80 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => void onReuseTurnConfig(selectedConversation.id, turn.id)}
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-white/80 px-2.5 text-[11px] font-medium text-stone-600 ring-1 ring-stone-200/80 transition hover:bg-stone-100 hover:text-stone-900"
                    >
                      Reuse config
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeletePrompt(selectedConversation.id, turn.id)}
                      className="inline-flex size-7 items-center justify-center rounded-full text-stone-300 transition hover:bg-stone-100 hover:text-stone-700"
                      aria-label="Delete prompt record"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {!turn.resultsDeleted ? (
              <div className="flex justify-start">
                <div className="w-full p-1">
                  {turn.referenceImages.length > 0 ? (
                    <div className="mb-4 flex flex-col items-start">
                      <div className="mb-2 text-[11px] font-medium text-stone-400 sm:text-xs">Reference images for this turn</div>
                      <div className="flex flex-wrap gap-2 sm:gap-3">
                        {turn.referenceImages.map((image, index) => (
                          <div key={`${turn.id}-${image.name}-${index}`} className="flex flex-col items-start gap-1.5">
                            <button
                              type="button"
                              onClick={() => onOpenLightbox(referenceLightboxImages, index)}
                              className="group relative size-20 overflow-hidden rounded-2xl border border-stone-200/80 bg-stone-50 transition hover:border-stone-300 sm:size-24"
                              aria-label={`Preview reference image ${image.name || index + 1}`}
                            >
                              <img
                                src={image.dataUrl}
                                alt={image.name || `Reference image ${index + 1}`}
                                className="absolute inset-0 h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => onContinueEdit(selectedConversation.id, image)}
                              className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600 transition hover:bg-stone-200 hover:text-stone-900"
                            >
                              <Sparkles className="size-3" />
                              Add to edit
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {showImageGrid ? (
                    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500 sm:mb-4 sm:gap-2 sm:text-xs">
                      <span className="rounded-full bg-stone-100 px-3 py-1">{turn.count} images</span>
                      <span className="rounded-full bg-stone-100 px-3 py-1">{getTurnStatusLabel(turn.status)}</span>
                      {turn.status === "queued" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1 text-stone-500">
                          <Clock3 className="size-3 text-stone-400" />
                          Waiting for previous tasks to complete
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {showImageGrid ? (
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      {turn.images.map((image, index) => {
                        const imageSrc = image.status === "success" ? getStoredImageSrc(image) : "";
                        if (image.status === "success" && imageSrc) {
                          const currentIndex = allSuccessfulImages.findIndex((item) => item.id === image.id);
                          const sizeLabel = image.b64_json ? formatBase64ImageSize(image.b64_json) : "";
                          const dimensions = imageDimensions[image.id];
                          const imageMeta = [sizeLabel, dimensions].filter(Boolean).join(" · ");

                          return (
                            <div key={image.id} className="break-inside-avoid">
                              <button
                                type="button"
                                onClick={() => onOpenLightbox(allSuccessfulImages, currentIndex)}
                                className="group block aspect-square w-full cursor-zoom-in overflow-hidden rounded-2xl"
                              >
                                <img
                                  src={imageSrc}
                                  alt={`Generated result ${index + 1}`}
                                  className="block h-full w-full object-cover transition duration-200 group-hover:brightness-90"
                                  onLoad={(event) => {
                                    updateImageDimensions(
                                      image.id,
                                      event.currentTarget.naturalWidth,
                                      event.currentTarget.naturalHeight,
                                    );
                                  }}
                                />
                              </button>
                              {/* Grid cell bottom: left side "Result N + size" truncated adaptively, right side always icon buttons.
                                  In 3-col grid each cell ≈ 1/3 viewport, stacking text labels won't fit at any breakpoint.
                                  Previously had vertical text bug with "Add to edit". Unified to icons + tooltip, buttons shrink-0 + nowrap as fallback. */}
                              <div className="flex items-center gap-2 px-0.5 py-1.5 text-[10px] sm:px-1 sm:py-2 sm:text-xs">
                                <div className="min-w-0 flex-1 truncate whitespace-nowrap text-stone-400">
                                  <span>Result {index + 1}</span>
                                  {imageMeta ? <span className="ml-2">{imageMeta}</span> : null}
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => onContinueEdit(selectedConversation.id, image)}
                                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600 transition hover:bg-stone-200 hover:text-stone-900"
                                    aria-label="Add to edit"
                                    title="Add to edit"
                                  >
                                    <Sparkles className="size-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void downloadStoredImage(image, index)}
                                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600 transition hover:bg-stone-200 hover:text-stone-900"
                                    aria-label="Download"
                                    title="Download"
                                  >
                                    <Download className="size-3.5" />
                                  </button>
                                  {/* Publish to gallery. State controls visuals and clickability:
                                      - idle: clickable, default outline button
                                      - publishing: disabled + spinning icon
                                      - published: disabled + checkmark, title shows "Published"
                                      - unsupported: disabled + grayed out, title shows reason (usually b64 response without url) */}
                                  {(() => {
                                    const state = publishStateOf?.(image) ?? "idle";
                                    const disabled = state !== "idle";
                                    const Icon =
                                      state === "publishing"
                                        ? LoaderCircle
                                        : state === "published"
                                          ? Check
                                          : Share2;
                                    const label =
                                      state === "publishing"
                                        ? "Publishing"
                                        : state === "published"
                                          ? "Published"
                                          : "Publish to gallery";
                                    return (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onPublishImage?.(selectedConversation.id, turn.id, image)
                                        }
                                        disabled={disabled}
                                        title={
                                          state === "unsupported"
                                            ? "Local images cannot be published to gallery"
                                            : state === "published"
                                              ? "Published to gallery"
                                              : "Publish to gallery"
                                        }
                                        className={cn(
                                          "inline-flex size-7 shrink-0 items-center justify-center rounded-full transition",
                                          state === "published"
                                            ? "bg-emerald-50 text-emerald-700"
                                            : state === "unsupported"
                                              ? "cursor-not-allowed bg-stone-50 text-stone-300"
                                              : "bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900",
                                          disabled && state !== "published" && "opacity-70",
                                        )}
                                        aria-label={label}
                                      >
                                        <Icon
                                          className={cn(
                                            "size-3.5",
                                            state === "publishing" && "animate-spin",
                                          )}
                                        />
                                      </button>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          );
                        }

                      if (image.status === "error") {
                        const errorMessage = image.error || "Generation failed";
                        // Insufficient quota is a "quota" issue not a "model question", retry/reply are meaningless.
                        // Shows a dedicated quiet card guiding user to contact administrator.
                        if (isQuotaError(errorMessage)) {
                          return (
                            <div
                              key={image.id}
                              className="relative break-inside-avoid rounded-xl border border-amber-200/70 bg-amber-50/60"
                            >
                              <button
                                type="button"
                                onClick={() => onDeleteResults(selectedConversation.id, turn.id)}
                                className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-full text-amber-500/70 transition hover:bg-white hover:text-rose-500"
                                aria-label="Delete generation results"
                              >
                                <Trash2 className="size-3" />
                              </button>
                              <div className="flex flex-col items-center gap-2 px-3 py-4 text-center sm:gap-3 sm:px-5 sm:py-5">
                                <span className="inline-flex size-7 items-center justify-center rounded-full bg-white text-amber-500 shadow-sm sm:size-8">
                                  <WalletCards className="size-3.5 sm:size-4" />
                                </span>
                                <p className="text-[12px] leading-5 font-medium text-amber-900 sm:text-[13px] sm:leading-6">
                                  {errorMessage}
                                </p>
                                <p className="text-[11px] leading-4 text-amber-700/80 sm:text-[12px] sm:leading-5">
                                  Please contact the administrator to add quota before continuing
                                </p>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={image.id}
                            className="break-inside-avoid rounded-xl border border-stone-200/80 bg-stone-50"
                          >
                            <div className="flex flex-col gap-2 px-3 py-4 sm:gap-3 sm:px-5 sm:py-5">
                              <div className="flex justify-center">
                                <span className="inline-flex size-7 items-center justify-center rounded-full bg-white text-stone-400 shadow-sm sm:size-8">
                                  <AlertCircle className="size-3.5 sm:size-4" />
                                </span>
                              </div>
                              <ErrorMessageBlock message={errorMessage} />
                              <div className="flex flex-wrap items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void onRetryImage(selectedConversation.id, turn.id, image.id)}
                                  className="inline-flex items-center gap-1 rounded-full bg-stone-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-stone-800 sm:px-3 sm:text-xs"
                                >
                                  <RotateCcw className="size-3" />
                                  Retry
                                </button>
                                {onReplyToTurn && image.error ? (
                                  <div className="relative inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => onReplyToTurn(selectedConversation.id, turn.id, image.error || "")}
                                      className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-stone-700 ring-1 ring-stone-200 transition hover:bg-stone-100 hover:text-stone-900 sm:px-3 sm:text-xs"
                                      aria-label="Continue replying based on this prompt"
                                    >
                                      <Reply className="size-3" />
                                      Reply
                                    </button>
                                    {/* Info tooltip: pure CSS peer-hover implementation.
                                        Shows on mouse hover / keyboard focus on the ! icon, hides on leave.
                                        Tooltip is pointer-events-none, won't intercept mouse events back,
                                        avoiding the previous "flickering between trigger area and card" issue. */}
                                    <span
                                      tabIndex={0}
                                      role="button"
                                      aria-label="Why do I need to click reply"
                                      className="peer inline-flex size-5 cursor-help items-center justify-center rounded-full text-stone-400 ring-1 ring-stone-200 transition hover:bg-white hover:text-stone-700 focus:bg-white focus:text-stone-700 focus:outline-none"
                                    >
                                      <Info className="size-3" />
                                    </span>
                                    <div
                                      role="tooltip"
                                      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-60 -translate-x-1/2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-left text-[11px] leading-5 text-stone-600 opacity-0 shadow-[0_2px_4px_rgba(15,23,42,0.04),0_12px_28px_-12px_rgba(15,23,42,0.25)] transition peer-hover:opacity-100 peer-focus:opacity-100 sm:text-[12px]"
                                    >
                                      <p className="mb-1 font-medium text-stone-800">Why click "Reply"?</p>
                                      <p>
                                        The image API has no context by itself. Clicking "Reply" sends this turn's prompt and reference images together to the model;
                                        if you type directly in the input box below, the model will treat it as a new image generation request without knowing you're responding to its question.
                                      </p>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      }

                        return (
                          <div
                            key={image.id}
                            className="relative aspect-square break-inside-avoid overflow-hidden rounded-2xl bg-stone-100/80"
                          >
                            {turn.status === "queued" ? (
                              <div className="flex h-full flex-col items-center justify-center gap-2 px-2 py-3 text-center text-stone-400">
                                <span className="inline-flex size-7 items-center justify-center rounded-full bg-white text-stone-400 shadow-sm sm:size-8">
                                  <Clock3 className="size-3.5 sm:size-4" />
                                </span>
                                <p className="text-[11px] leading-4 text-stone-500 sm:text-[13px]">Queued</p>
                              </div>
                            ) : (
                              <>
                                <div aria-hidden className="dot-grid-loader absolute inset-0" />
                                <div className="absolute top-2 left-3 text-[11px] font-medium text-stone-500 sm:top-3 sm:left-4 sm:text-xs">
                                  Creating image
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {turn.status === "error" && turn.error && !isQuotaError(turn.error) ? (
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-[11px] text-stone-500 sm:mt-4 sm:text-xs">
                      <AlertCircle className="size-3 text-stone-400" />
                      <span>{turn.error}</span>
                    </div>
                  ) : null}

                  {isQuotaError(turn.error) || !hasRenderableImages ? null : (
                    <div className="mt-3 flex items-center gap-1.5 text-[11px] sm:mt-4">
                      <button
                        type="button"
                        onClick={() => void onRegenerateTurn(selectedConversation.id, turn.id)}
                        className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 font-medium text-stone-500 transition hover:bg-stone-200 hover:text-stone-900"
                      >
                        <RotateCcw className="size-3" />
                        Regenerate all
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteResults(selectedConversation.id, turn.id)}
                        className="inline-flex size-6 items-center justify-center rounded-full text-stone-300 transition hover:bg-rose-50 hover:text-rose-500"
                        aria-label="Delete generation results"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function getTurnStatusLabel(status: ImageTurnStatus) {
  if (status === "queued") {
    return "Queued";
  }
  if (status === "generating") {
    return "Processing";
  }
  if (status === "success") {
    return "Completed";
  }
  return "Failed";
}

function formatBase64ImageSize(base64: string) {
  const normalized = base64.replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  const bytes = Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);

  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatImageDimensions(width: number, height: number) {
  return `${width} x ${height}`;
}
