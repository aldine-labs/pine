export const LIST_SKILLS_CHANNEL = "skills:list" as const;
export const READ_SKILL_CHANNEL = "skills:read" as const;
export const CREATE_SKILL_CHANNEL = "skills:create" as const;
export const EDIT_SKILL_CHANNEL = "skills:edit" as const;
export const REMOVE_SKILL_CHANNEL = "skills:remove" as const;
export const SET_GLOBAL_SKILL_ENABLED_CHANNEL =
  "skills:set-global-enabled" as const;

export type PineSkillScope = "global" | "project";

export interface PineSkillResource {
  kind: "directory" | "file";
  path: string;
  size?: number;
}

export interface PineSkillSummary {
  allowedTools?: string;
  compatibility?: string;
  description: string;
  disableModelInvocation: boolean;
  license?: string;
  metadata?: Record<string, string>;
  name: string;
  scope: PineSkillScope;
  /** Whether the skill is managed by Pine or discovered by Pi. */
  managedBy?: "pine" | "pi";
  /** Pi package Skills are visible but cannot be edited in place. */
  readOnly?: boolean;
  /** Project-specific effective state for a global skill. */
  enabled?: boolean;
}

export interface PineSkillDiagnostic {
  message: string;
  name?: string;
  type: "collision" | "error" | "warning";
}

export interface SkillScopeRequest {
  projectId?: string;
  scope: PineSkillScope;
}

export interface SkillIdentityRequest extends SkillScopeRequest {
  managedBy?: "pine" | "pi";
  name: string;
}

export interface WriteSkillRequest extends SkillIdentityRequest {
  content: string;
}

export interface ListSkillsResult {
  diagnostics: PineSkillDiagnostic[];
  skills: PineSkillSummary[];
}

export interface ReadSkillResult {
  content: string;
  resources?: PineSkillResource[];
  skill: PineSkillSummary;
  /** Absolute package directory for agent-side resource authoring. */
  skillDirectory?: string;
}

export interface ListSkillResourcesResult {
  resources: PineSkillResource[];
  skill: PineSkillSummary;
}

export interface ReadSkillResourceResult {
  content: string;
  encoding: "base64" | "utf8";
  resource: PineSkillResource;
  skill: PineSkillSummary;
}

export interface RemoveSkillResult {
  removed: boolean;
}

export interface SetGlobalSkillEnabledRequest {
  enabled: boolean;
  name: string;
  projectId: string;
}

export interface SetGlobalSkillEnabledResult {
  updated: boolean;
}
