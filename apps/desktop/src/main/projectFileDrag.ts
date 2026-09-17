import type { NativeImage, WebContents } from "electron";

export type ProjectFileDragIconLoader = (
  filePath: string,
  options: { size: "normal" },
) => Promise<NativeImage>;

/**
 * Start an OS file drag with the icon associated with the file on the host.
 * Keeping this separate from the IPC handler makes the native drag contract
 * testable without importing the main process entry point.
 */
export async function startProjectFileDrag(
  sender: Pick<WebContents, "isDestroyed" | "startDrag">,
  filePath: string,
  loadIcon: ProjectFileDragIconLoader,
): Promise<void> {
  const icon = await loadIcon(filePath, { size: "normal" });
  if (sender.isDestroyed()) return;
  sender.startDrag({ file: filePath, icon });
}
