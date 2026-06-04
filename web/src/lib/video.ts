export type VideoInfo = {
  kind: "youtube";
  id: string;
  embedUrl: string;
  thumbUrl: string;
  watchUrl: string;
};

function makeYouTube(id: string): VideoInfo {
  return {
    kind: "youtube",
    id,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
    thumbUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    watchUrl: `https://www.youtube.com/watch?v=${id}`,
  };
}

export function parseVideoUrl(href: string): VideoInfo | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") {
    const id = url.pathname.replace(/^\//, "").split("/")[0];
    if (id) return makeYouTube(id);
    return null;
  }
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host.endsWith(".youtube-nocookie.com")) {
    const v = url.searchParams.get("v");
    if (v) return makeYouTube(v);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length >= 2 && ["embed", "shorts", "v"].includes(segments[0])) {
      return makeYouTube(segments[1]);
    }
  }
  return null;
}
