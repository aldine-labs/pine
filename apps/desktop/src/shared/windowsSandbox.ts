export type WindowsSandboxStatus =
  | { state: "unsupported" }
  | { state: "ready" }
  | { state: "not-installed"; message?: string; cancelled?: boolean };
