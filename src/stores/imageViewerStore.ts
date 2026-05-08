import { create } from "zustand";

export interface ImageItem {
  src: string;
  name?: string;
  path?: string;
}

interface ImageViewerState {
  open: boolean;
  images: ImageItem[];
  index: number;
  /** Open a single image (legacy, kept for non-gallery callers). */
  openImage: (src: string, name?: string, path?: string) => void;
  /** Open a gallery of images, optionally focused on `index`. */
  openImages: (images: ImageItem[], index?: number) => void;
  closeImage: () => void;
  next: () => void;
  prev: () => void;
  setIndex: (i: number) => void;
}

export const useImageViewerStore = create<ImageViewerState>((set, get) => ({
  open: false,
  images: [],
  index: 0,
  openImage: (src, name, path) =>
    set({ open: true, images: [{ src, name, path }], index: 0 }),
  openImages: (images, index = 0) => {
    if (!images.length) return;
    const clamped = Math.max(0, Math.min(index, images.length - 1));
    set({ open: true, images, index: clamped });
  },
  closeImage: () => set({ open: false, images: [], index: 0 }),
  next: () => {
    const { images, index } = get();
    if (images.length <= 1) return;
    set({ index: (index + 1) % images.length });
  },
  prev: () => {
    const { images, index } = get();
    if (images.length <= 1) return;
    set({ index: (index - 1 + images.length) % images.length });
  },
  setIndex: (i) => {
    const { images } = get();
    if (!images.length) return;
    const next = ((i % images.length) + images.length) % images.length;
    set({ index: next });
  },
}));
