import { useCallback, useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, RotateCcw, ExternalLink, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useImageViewerStore } from "../../stores/imageViewerStore";
import { copyFile } from "../../lib/claude-ipc";

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const WHEEL_STEP = 0.1;
const BTN_STEP = 0.25;

export default function ImageLightbox() {
  const { open, images, index, closeImage, next, prev } = useImageViewerStore();
  const current = images[index];
  const src = current?.src;
  const name = current?.name;
  const path = current?.path;
  const total = images.length;

  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const reset = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  // Reset on each open AND on image switch
  useEffect(() => {
    if (open) reset();
  }, [open, src, reset]);

  // Keyboard: Esc / + / - / 0 / ←→
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeImage();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setScale((s) => Math.min(MAX_SCALE, +(s + BTN_STEP).toFixed(2)));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setScale((s) => Math.max(MIN_SCALE, +(s - BTN_STEP).toFixed(2)));
      } else if (e.key === "0") {
        e.preventDefault();
        reset();
      } else if (e.key === "ArrowLeft" && total > 1) {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight" && total > 1) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, closeImage, reset, prev, next, total]);

  // Wheel zoom — only when Ctrl/Cmd is held (also matches macOS pinch gesture,
  // which the system reports as a wheel event with ctrlKey=true). Without the
  // modifier, let the browser scroll the lightbox container so tall images can
  // be browsed by scrolling without zooming.
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -WHEEL_STEP : WHEEL_STEP;
    setScale((s) => {
      const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, +(s + delta).toFixed(2)));
      if (nextScale <= 1) setTranslate({ x: 0, y: 0 });
      return nextScale;
    });
  };

  // Drag to pan (only when zoomed in)
  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: translate.x,
      origY: translate.y,
    };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setTranslate({
        x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
      });
    };
    const up = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [dragging]);

  // Double-click image: toggle 1x / 2x
  const onImageDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (scale === 1) {
      setScale(2);
    } else {
      reset();
    }
  };

  // Background click: close
  const onBackgroundClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) closeImage();
  };

  // Save to local disk via native dialog; copies the source file to preserve binary fidelity
  const handleSave = async () => {
    if (!path) return;
    const extFromName = name?.includes(".") ? name.split(".").pop()!.toLowerCase() : undefined;
    const ext = extFromName || "png";
    const dest = await saveDialog({
      defaultPath: name || `image.${ext}`,
      filters: [{ name: "Image", extensions: [ext] }],
    });
    if (!dest) return;
    try {
      await copyFile(path, dest);
    } catch (err) {
      console.error("Save image failed:", err);
    }
  };

  if (!open || !src) return null;

  const pct = Math.round(scale * 100);

  return (
    <>
      {/* Layer 1 — backdrop. Sits underneath everything; non-interactive so the
          scroll container above receives wheel/click events. Kept as its own
          element because `backdrop-filter` creates a containing block for any
          `fixed` descendants, which would re-anchor the toolbars to this layer
          and make them scroll along with tall images. */}
      <div className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-sm pointer-events-none" />

      {/* Layer 2 — scroll container holding the image */}
      <div
        className="fixed inset-0 z-[201] overflow-y-auto overflow-x-hidden select-none"
        onClick={onBackgroundClick}
        onWheel={onWheel}
      >
        <div
          className="min-h-full flex items-center justify-center px-4 py-16"
          onClick={onBackgroundClick}
        >
          <img
            src={src}
            alt={name || "preview"}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={onImageDoubleClick}
            onMouseDown={onMouseDown}
            className="max-w-[min(90vw,1200px)] h-auto shadow-2xl"
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              transformOrigin: "center top",
              transition: dragging ? "none" : "transform 150ms ease-out",
              cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in",
            }}
          />
        </div>
      </div>

      {/* Layer 3 — toolbars. Siblings of the scroll container so `fixed` stays viewport-relative. */}
      <div className="fixed top-4 right-4 flex items-center gap-2 z-[202]">
        {path && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSave();
            }}
            className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white/90 flex items-center justify-center
                       transition-colors backdrop-blur-md"
            title="保存到本地"
          >
            <Download size={16} />
          </button>
        )}
        {path && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              shellOpen(path).catch(() => {});
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20
                       text-white/90 text-xs transition-colors backdrop-blur-md"
            title="在系统中打开"
          >
            <ExternalLink size={14} />
            <span>在系统中打开</span>
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            closeImage();
          }}
          className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center
                     transition-colors backdrop-blur-md"
          title="关闭 (Esc)"
        >
          <X size={18} />
        </button>
      </div>

      <div className="fixed top-5 left-1/2 -translate-x-1/2 flex items-center gap-2 max-w-[50%] z-[202]">
        {name && (
          <div className="px-3 py-1.5 rounded-lg bg-white/10 backdrop-blur-md text-white/90 text-xs truncate">
            {name}
          </div>
        )}
        {total > 1 && (
          <div className="px-2.5 py-1.5 rounded-lg bg-white/10 backdrop-blur-md text-white/80 text-xs tabular-nums">
            {index + 1} / {total}
          </div>
        )}
      </div>

      {total > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            className="fixed left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20
                       text-white flex items-center justify-center transition-colors backdrop-blur-md z-[202]"
            title="上一张 (←)"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            className="fixed right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20
                       text-white flex items-center justify-center transition-colors backdrop-blur-md z-[202]"
            title="下一张 (→)"
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}

      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-xl
                   bg-white/10 backdrop-blur-md z-[202]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setScale((s) => Math.max(MIN_SCALE, +(s - BTN_STEP).toFixed(2)))}
          className="w-8 h-8 rounded-lg hover:bg-white/15 text-white/90 flex items-center justify-center transition-colors"
          title="缩小 (-)"
        >
          <ZoomOut size={16} />
        </button>
        <div className="min-w-[56px] text-center text-xs text-white/90 tabular-nums">{pct}%</div>
        <button
          onClick={() => setScale((s) => Math.min(MAX_SCALE, +(s + BTN_STEP).toFixed(2)))}
          className="w-8 h-8 rounded-lg hover:bg-white/15 text-white/90 flex items-center justify-center transition-colors"
          title="放大 (+)"
        >
          <ZoomIn size={16} />
        </button>
        <div className="w-px h-5 bg-white/15 mx-1" />
        <button
          onClick={reset}
          className="w-8 h-8 rounded-lg hover:bg-white/15 text-white/90 flex items-center justify-center transition-colors"
          title="重置 (0)"
        >
          <RotateCcw size={15} />
        </button>
      </div>
    </>
  );
}
