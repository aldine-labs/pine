import { defineComponent } from "vue";
import { describe, expect, it } from "vitest";
import { resolvePreviewRenderer } from "../previewRenderer";
import type { PreviewRenderer } from "../previewRenderer";
import { previewRenderers } from "../previewRenderers";

const info = { size: 12, modifiedAt: "2026-09-24T00:00:00Z" };

describe("file preview renderer registry", () => {
  it("lets a new renderer replace a built-in for selected formats", () => {
    const replacement: PreviewRenderer = {
      id: "replacement-pdf",
      component: defineComponent({ template: "<div />" }),
      supports: (preview) => preview.kind === "pdf",
      capabilities: () => ({ zoom: true, invert: false, renderToggle: false }),
    };
    const renderers = [replacement, ...previewRenderers];
    const pdf = { ...info, kind: "pdf" as const, url: "preview://pdf" };
    const office = {
      ...info,
      kind: "office" as const,
      format: "docx" as const,
      url: "preview://docx",
    };

    expect(resolvePreviewRenderer(renderers, pdf, "report.pdf")).toBe(
      replacement,
    );
    expect(resolvePreviewRenderer(renderers, office, "report.docx")?.id).toBe(
      "office",
    );
  });

  it("derives controls from the selected renderer and display mode", () => {
    const text = {
      ...info,
      kind: "text" as const,
      text: "<h1>Report</h1>",
      encoding: "UTF-8",
    };
    const renderer = resolvePreviewRenderer(
      previewRenderers,
      text,
      "index.html",
    );
    expect(
      renderer?.capabilities({
        preview: text,
        filePath: "index.html",
        mode: "rendered",
      }),
    ).toEqual({ zoom: true, invert: false, renderToggle: true });
    expect(
      renderer?.capabilities({
        preview: text,
        filePath: "index.html",
        mode: "code",
      }),
    ).toEqual({ zoom: false, invert: false, renderToggle: true });
  });
});
