import { useState, useEffect } from "react";
import type { ContentBlock } from "../../lib/stream-parser";
import { readImageBase64 } from "../../lib/claude-ipc";
import { useImageViewerStore } from "../../stores/imageViewerStore";

const IMAGE_PATH_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;

function getResultText(result: ContentBlock | undefined): string {
  if (!result?.content) return "";
  if (typeof result.content === "string") return result.content;
  return result.content
    .map((c) => (typeof c === "string" ? c : c.text || ""))
    .join("\n");
}

/**
 * Detect the `{ "saved_paths": [...] }` JSON convention emitted by image-
 * generation skills (gpt-image, qwen-image, etc.) and pull out paths whose
 * extension looks like an image. The check is intentionally strict — the body
 * must be a single JSON object — so unrelated text containing a stray brace
 * won't accidentally match.
 */
export function extractGeneratedImagePaths(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return [];
  try {
    const parsed = JSON.parse(trimmed) as { saved_paths?: unknown };
    const paths = parsed.saved_paths;
    if (!Array.isArray(paths)) return [];
    return paths.filter(
      (p): p is string => typeof p === "string" && IMAGE_PATH_RE.test(p)
    );
  } catch {
    return [];
  }
}

export function getGeneratedImagePaths(
  result: ContentBlock | undefined
): string[] {
  return extractGeneratedImagePaths(getResultText(result));
}

/**
 * Inline gallery rendered for tool results that produced images. Layout
 * mirrors the user-attachment album in MessageBubble (single large preview
 * for one image, 2-column square grid with `+N` overlay for multiple), so
 * generated images feel like a first-class chat block instead of an
 * afterthought tucked under a tool card.
 */
export default function GeneratedImagesGallery({ paths }: { paths: string[] }) {
  const [items, setItems] = useState<{ path: string; dataUrl: string }[]>([]);
  const openImages = useImageViewerStore((s) => s.openImages);
  const key = paths.join("\n");

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      paths.map(async (p) => {
        try {
          const dataUrl = await readImageBase64(p);
          return { path: p, dataUrl };
        } catch {
          return null;
        }
      })
    ).then((results) => {
      if (cancelled) return;
      setItems(
        results.filter(
          (r): r is { path: string; dataUrl: string } => r !== null
        )
      );
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (items.length === 0) return null;

  const galleryItems = items.map((it) => ({
    src: it.dataUrl,
    name: it.path.split(/[\\/]/).pop(),
    path: it.path,
  }));
  const openAt = (idx: number) => openImages(galleryItems, idx);

  // Single image — large preview
  if (items.length === 1) {
    const it = items[0];
    const fileName = it.path.split(/[\\/]/).pop() || it.path;
    return (
      <div className="px-1">
        <div
          className="inline-block relative rounded-xl overflow-hidden border border-border/50
                     hover:border-accent/40 transition-colors shadow-sm cursor-pointer"
          onClick={() => openAt(0)}
          title={`${it.path}\n点击查看`}
        >
          <img
            src={it.dataUrl}
            alt={fileName}
            className="max-w-[320px] max-h-[240px] object-cover"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
            <span className="text-[11px] text-white/90 truncate block">
              {fileName}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // 2+ images — compact 2-column album grid; "+N" overlay on the 4th when there are more
  const VISIBLE = 4;
  const visible = items.slice(0, VISIBLE);
  const hidden = items.length - VISIBLE;
  return (
    <div className="px-1">
      <div className="grid grid-cols-2 gap-1.5 max-w-[320px]">
        {visible.map((it, i) => {
          const isLast = i === VISIBLE - 1 && hidden > 0;
          const fileName = it.path.split(/[\\/]/).pop() || it.path;
          return (
            <div
              key={it.path}
              className="relative aspect-square rounded-lg overflow-hidden border border-border/50
                         hover:border-accent/40 transition-colors shadow-sm cursor-pointer"
              onClick={() => openAt(i)}
              title={`${it.path}\n点击查看`}
            >
              <img
                src={it.dataUrl}
                alt={fileName}
                className="w-full h-full object-cover"
              />
              {isLast && (
                <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
                  <span className="text-white text-lg font-medium tabular-nums">
                    +{hidden}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
