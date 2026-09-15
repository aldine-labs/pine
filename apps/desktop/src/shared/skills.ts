export const LIST_SKILLS_CHANNEL = "skills:list" as const;
export const READ_SKILL_CHANNEL = "skills:read" as const;
export const CREATE_SKILL_CHANNEL = "skills:create" as const;
export const EDIT_SKILL_CHANNEL = "skills:edit" as const;
export const REMOVE_SKILL_CHANNEL = "skills:remove" as const;
export const SET_GLOBAL_SKILL_ENABLED_CHANNEL =
  "skills:set-global-enabled" as const;

export type PineSkillScope = "global" | "project";

export interface PineSkillSummary {
  description: string;
  disableModelInvocation: boolean;
  name: string;
  scope: PineSkillScope;
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
