import type { PineSessionSummary } from "@/shared/sessions";

export const SESSION_DRAG_TYPE = "application/x-pine-session";

export function hasSessionDrag(transfer: DataTransfer | null): boolean {
  return Array.from(transfer?.types ?? []).includes(SESSION_DRAG_TYPE);
}

export function readSessionDrag(transfer: DataTransfer): string | undefined {
  if (!hasSessionDrag(transfer)) return undefined;
  const sessionId = transfer.getData(SESSION_DRAG_TYPE);
  return sessionId || undefined;
}

export function writeSessionDrag(
  transfer: DataTransfer,
  session: Pick<PineSessionSummary, "id">,
): void {
  transfer.setData(SESSION_DRAG_TYPE, session.id);
  // Session drags can either be copied into a session as an attachment or
  // moved into a session group.
  transfer.effectAllowed = "copyMove";
}
