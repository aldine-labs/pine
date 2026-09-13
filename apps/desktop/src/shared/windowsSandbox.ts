export const GET_WINDOWS_SANDBOX_STATUS_CHANNEL =
  "windows-sandbox:status" as const;
export const INSTALL_WINDOWS_SANDBOX_CHANNEL =
  "windows-sandbox:install" as const;

export type WindowsSandboxStatus =
  | { state: "unsupported" }
  | { state: "ready" }
  | { state: "not-installed"; message?: string; cancelled?: boolean };
