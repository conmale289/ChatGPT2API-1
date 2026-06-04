"use client";

import { useState } from "react";
import { Play } from "lucide-react";

import { cn } from "@/lib/utils";
import type { VideoInfo } from "@/lib/video";

type VideoCardProps = {
  video: VideoInfo;
  label?: string;
  className?: string;
};

export function VideoCard({ video, label, className }: VideoCardProps) {
  const [playing, setPlaying] = useState(false);
  return (
    <span
      className={cn(
        "my-2 inline-flex w-full max-w-[420px] flex-col overflow-hidden rounded-xl border border-border/60 bg-card align-middle shadow-sm",
        className,
      )}
    >
      <span className="relative block aspect-video w-full bg-stone-100 dark:bg-stone-900">
        {playing ? (
          <iframe
            src={video.embedUrl}
            title="video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 flex h-full w-full cursor-pointer items-center justify-center"
            aria-label="播放视频"
          >
            <img
              src={video.thumbUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 bg-black/20 transition-opacity group-hover:bg-black/30" />
            <span className="absolute flex size-12 items-center justify-center rounded-full bg-white/90 text-foreground shadow-lg transition-transform group-hover:scale-110">
              <Play className="ml-0.5 size-5 fill-current" />
            </span>
            {label ? (
              <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 font-data text-[10px] font-medium text-white">
                {label}
              </span>
            ) : null}
          </button>
        )}
      </span>
      <span className="flex items-center justify-between gap-2 px-3 py-2 text-[12px] text-muted-foreground">
        <span className="truncate">YouTube</span>
        <a
          href={video.watchUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0 text-primary hover:underline"
        >
          在 YouTube 打开
        </a>
      </span>
    </span>
  );
}
