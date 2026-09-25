import type {
  LoadSkillsResult,
  Skill as PiSkill,
} from "@earendil-works/pi-coding-agent";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { PineSkillScope, PineSkillSummary } from "../../shared/skills";
import type { PineSkillRepository } from "./repository";

/** Keep Pi's loader from presenting Pine-managed Skills a second time. */
export function piProjectSkillPaths(cwd: string): string[] {
  const projectPaths: string[] = [];
  const userAgentsSkillsPath = path.resolve(homedir(), ".agents", "skills");
  let current = path.resolve(cwd);

  while (true) {
    const agentsSkillsPath = path.join(current, ".agents", "skills");
    if (
      existsSync(agentsSkillsPath) &&
      path.resolve(agentsSkillsPath) !== userAgentsSkillsPath
    ) {
      projectPaths.push(agentsSkillsPath);
    }

    if (existsSync(path.join(current, ".git"))) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const piSkillsPath = path.join(path.resolve(cwd), ".pi", "skills");
  if (existsSync(piSkillsPath)) projectPaths.push(piSkillsPath);
  return projectPaths;
}

export function filterPineManagedSkills(
  repository: PineSkillRepository,
  cwd: string,
  agentDir: string,
) {
  const projectSkillPaths = piProjectSkillPaths(cwd);
  return (result: LoadSkillsResult): LoadSkillsResult => {
    const managedNames = repository.managedSkillNames();
    const projectSkills = loadSkills({
      cwd,
      agentDir,
      skillPaths: projectSkillPaths,
      includeDefaults: false,
    })
      .skills.filter((skill) => !managedNames.has(skill.name))
      .map((skill) => ({
        ...skill,
        sourceInfo: { ...skill.sourceInfo, scope: "project" as const },
      }));
    const projectNames = new Set(projectSkills.map((skill) => skill.name));
    return {
      ...result,
      skills: result.skills
        .filter(
          (skill) =>
            !managedNames.has(skill.name) && !projectNames.has(skill.name),
        )
        .concat(projectSkills),
    };
  };
}

export function pineScopeForPiSkill(skill: PiSkill): PineSkillScope {
  return skill.sourceInfo.scope === "project" ? "project" : "global";
}

export function summarizePiSkill(skill: PiSkill): PineSkillSummary {
  return {
    description: skill.description,
    disableModelInvocation: skill.disableModelInvocation,
    managedBy: "pi",
    name: skill.name,
    readOnly:
      skill.sourceInfo.origin === "package" ||
      path.basename(skill.filePath) !== "SKILL.md",
    scope: pineScopeForPiSkill(skill),
  };
}
