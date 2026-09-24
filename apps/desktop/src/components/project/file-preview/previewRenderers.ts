import { defineAsyncComponent } from "vue";
import { fileLanguage } from "@/lib/fileLanguage";
import ImagePreviewRenderer from "./ImagePreviewRenderer.vue";
import TextPreviewRenderer from "./TextPreviewRenderer.vue";
import VideoPreviewRenderer from "./VideoPreviewRenderer.vue";
import type { PreviewRenderer } from "./previewRenderer";

const noControls = { zoom: false, invert: false, renderToggle: false };
const documentControls = { zoom: true, invert: true, renderToggle: false };

/** Ordered built-in renderers. A new engine can replace one by registering first. */
export const previewRenderers: readonly PreviewRenderer[] = [
  {
    id: "text",
    component: TextPreviewRenderer,
    supports: (preview) => preview.kind === "text",
    capabilities: ({ filePath, mode }) => {
      const language = fileLanguage(filePath);
      const renderToggle = language === "markdown" || language === "html";
      return {
        zoom: language === "html" && mode === "rendered",
        invert: false,
        renderToggle,
      };
    },
  },
  {
    id: "pdf",
    component: defineAsyncComponent(() => import("./PdfPreviewRenderer.vue")),
    supports: (preview) => preview.kind === "pdf",
    capabilities: () => documentControls,
  },
  {
    id: "office",
    component: defineAsyncComponent(
      () => import("./OfficePreviewRenderer.vue"),
    ),
    supports: (preview) => preview.kind === "office",
    capabilities: () => documentControls,
  },
  {
    id: "image",
    component: ImagePreviewRenderer,
    supports: (preview) => preview.kind === "image",
    capabilities: () => ({ ...noControls, zoom: true }),
  },
  {
    id: "video",
    component: VideoPreviewRenderer,
    supports: (preview) => preview.kind === "video",
    capabilities: () => noControls,
  },
];
