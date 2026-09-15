import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  type Dirent,
} from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseYaml } from "yaml";
import type {
  ListSkillsResult,
  PineSkillDiagnostic,
  PineSkillScope,
  PineSkillSummary,
  ReadSkillResult,
} from "../../shared/skills";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_SKILL_CONTENT_BYTES = 1_000_000;
const MAX_SKILL_DESCRIPTION_LENGTH = 1_024;

interface Skill {
  baseDir: string;
  description: string;
  disableModelInvocation: boolean;
  filePath: string;
  name: string;
}

interface ResourceDiagnostic {
  message: string;
  type: "collision" | "error" | "warning";
}

interface SkillLoadResult {
  diagnostics: ResourceDiagnostic[];
  skills: Skill[];
}

function parseSkillFile(filePath: string): SkillLoadResult {
  const diagnostics: ResourceDiagnostic[] = [];
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    return {
      diagnostics: [
        {
          message:
            error instanceof Error ? error.message : "Unable to read Skill.",
          type: "warning",
        },
      ],
      skills: [],
    };
  }

  const normalized = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return {
      diagnostics: [
        { message: "SKILL.md frontmatter is required.", type: "warning" },
      ],
      skills: [],
    };
  }
  const endIndex = normalized.indexOf("\n---", 4);
  if (endIndex < 0) {
    return {
      diagnostics: [
        { message: "SKILL.md frontmatter is incomplete.", type: "warning" },
      ],
      skills: [],
    };
  }

  let frontmatter: Record<string, unknown>;
  try {
    const parsed = parseYaml(normalized.slice(4, endIndex));
    frontmatter =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch (error) {
    return {
      diagnostics: [
        {
          message:
            error instanceof Error
              ? error.message
              : "Invalid YAML frontmatter.",
          type: "warning",
        },
      ],
      skills: [],
    };
  }

  const baseDir = path.dirname(filePath);
  const name =
    typeof frontmatter.name === "string"
      ? frontmatter.name
      : path.basename(baseDir);
  const description = frontmatter.description;
  if (typeof description !== "string" || description.trim().length === 0) {
    diagnostics.push({ message: "description is required", type: "warning" });
    return { diagnostics, skills: [] };
  }
  if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    diagnostics.push({
      message: `description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters (${description.length})`,
      type: "warning",
    });
  }
  if (name.length > MAX_SKILL_NAME_LENGTH || !SKILL_NAME_PATTERN.test(name)) {
    diagnostics.push({
      message: "name must use lowercase letters, numbers, and single hyphens",
      type: "warning",
    });
  }

  return {
    diagnostics,
    skills: [
      {
        baseDir,
        description,
        disableModelInvocation:
          frontmatter["disable-model-invocation"] === true,
        filePath,
        name,
      },
    ],
  };
}

function loadSkillsFromDir(directory: string): SkillLoadResult {
  const skills: Skill[] = [];
  const diagnostics: ResourceDiagnostic[] = [];
  if (!existsSync(directory)) return { diagnostics, skills };

  let entries: Dirent<string>[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    return {
      diagnostics: [
        {
          message:
            error instanceof Error ? error.message : "Unable to list Skills.",
          type: "warning",
        },
      ],
      skills,
    };
  }

  const declaredSkill = entries.find((entry) => entry.name === "SKILL.md");
  if (declaredSkill) {
    const result = parseSkillFile(path.join(directory, declaredSkill.name));
    return result;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const entryPath = path.join(directory, entry.name);
    let isDirectory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDirectory = statSync(entryPath).isDirectory();
      } catch {
        continue;
      }
    }
    if (!isDirectory) continue;
    const result = loadSkillsFromDir(entryPath);
    skills.push(...result.skills);
    diagnostics.push(...result.diagnostics);
  }
  return { diagnostics, skills };
}

function stripFrontmatter(content: string): string {
  const normalized = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized;
  const endIndex = normalized.indexOf("\n---", 4);
  return endIndex < 0 ? normalized : normalized.slice(endIndex + 4).trim();
}

function validateSkillName(name: string): string {
  const normalized = name.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_SKILL_NAME_LENGTH ||
    !SKILL_NAME_PATTERN.test(normalized)
  ) {
    throw new Error(
      "Skill names must contain 1-64 lowercase letters, numbers, or single hyphens.",
    );
  }
  return normalized;
}

function validateSkillContent(content: string): string {
  const normalized = content.trim();
  if (!normalized) throw new Error("SKILL.md content is required.");
  if (Buffer.byteLength(normalized, "utf8") > MAX_SKILL_CONTENT_BYTES) {
    throw new Error("SKILL.md must be no larger than 1 MB.");
  }
  return `${normalized}\n`;
}

function summary(
  skill: Skill,
  scope: PineSkillScope,
  enabled?: boolean,
): PineSkillSummary {
  return {
    description: skill.description,
    disableModelInvocation: skill.disableModelInvocation,
    name: skill.name,
    scope,
    ...(enabled === undefined ? {} : { enabled }),
  };
}

function diagnostic(value: ResourceDiagnostic): PineSkillDiagnostic {
  return {
    message: value.message,
    type:
      value.type === "collision"
        ? "collision"
        : value.type === "error"
          ? "error"
          : "warning",
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface PineSkillRoots {
  disabledGlobalSkillsPath?: string;
  global: string;
  project: string;
}

export interface ResolvedPineSkill {
  scope: PineSkillScope;
  skill: Skill;
}

export class PineSkillRepository {
  constructor(private readonly roots: PineSkillRoots) {}

  list(scope: PineSkillScope): ListSkillsResult {
    const result = loadSkillsFromDir(this.root(scope));
    return {
      diagnostics: result.diagnostics.map(diagnostic),
      skills: result.skills.map((skill) =>
        summary(
          skill,
          scope,
          scope === "global"
            ? !this.disabledGlobalSkillNames().has(skill.name)
            : undefined,
        ),
      ),
    };
  }

  listCombined(): {
    diagnostics: PineSkillDiagnostic[];
    skills: ResolvedPineSkill[];
  } {
    const project = loadSkillsFromDir(this.roots.project);
    const global = loadSkillsFromDir(this.roots.global);
    const names = new Set<string>();
    const disabledGlobalSkills = this.disabledGlobalSkillNames();
    const skills: ResolvedPineSkill[] = [];
    const diagnostics = [
      ...project.diagnostics.map(diagnostic),
      ...global.diagnostics.map(diagnostic),
    ];
    for (const [scope, values] of [
      ["project", project.skills],
      ["global", global.skills],
    ] as const) {
      for (const skill of values) {
        if (scope === "global" && disabledGlobalSkills.has(skill.name)) {
          continue;
        }
        if (names.has(skill.name)) {
          diagnostics.push({
            message: `Global skill \"${skill.name}\" is shadowed by a project skill.`,
            name: skill.name,
            type: "collision",
          });
          continue;
        }
        names.add(skill.name);
        skills.push({ scope, skill });
      }
    }
    return { diagnostics, skills };
  }

  async read(scope: PineSkillScope, name: string): Promise<ReadSkillResult> {
    const skill = this.requireSkill(scope, name);
    return {
      content: await readFile(skill.filePath, "utf8"),
      skill: summary(skill, scope),
    };
  }

  async invoke(name: string, userRequest?: string): Promise<string> {
    const normalizedName = validateSkillName(name);
    const { skills } = this.listCombined();
    const resolved = skills.find(
      (value) => value.skill.name === normalizedName,
    );
    if (!resolved)
      throw new Error(`Skill \"${normalizedName}\" was not found.`);
    const content = await readFile(resolved.skill.filePath, "utf8");
    const body = stripFrontmatter(content).trim();
    const block = `<skill name="${escapeXml(resolved.skill.name)}" scope="${resolved.scope}">\nReferences are relative to ${resolved.skill.baseDir}.\n\n${body}\n</skill>`;
    const request = userRequest?.trim();
    return request ? `${block}\n\nUser: ${request}` : block;
  }

  async create(
    scope: PineSkillScope,
    name: string,
    content: string,
  ): Promise<ReadSkillResult> {
    const normalizedName = validateSkillName(name);
    const normalizedContent = validateSkillContent(content);
    const root = this.root(scope);
    await mkdir(root, { recursive: true });
    const destination = path.join(root, normalizedName);
    const stage = path.join(root, `.pine-skill-stage-${randomUUID()}`);
    await mkdir(stage, { recursive: false });
    try {
      await writeFile(path.join(stage, "SKILL.md"), normalizedContent, {
        encoding: "utf8",
        flag: "wx",
      });
      this.validateStagedSkill(stage, normalizedName);
      await rename(stage, destination);
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      throw error;
    }
    return this.read(scope, normalizedName);
  }

  async edit(
    scope: PineSkillScope,
    name: string,
    content: string,
  ): Promise<ReadSkillResult> {
    const normalizedName = validateSkillName(name);
    const normalizedContent = validateSkillContent(content);
    this.requireSkill(scope, normalizedName);
    const root = this.root(scope);
    const destination = path.join(root, normalizedName);
    const validationStage = path.join(
      root,
      `.pine-skill-validation-${randomUUID()}`,
    );
    const nextFile = path.join(destination, `.SKILL.md-${randomUUID()}.tmp`);
    await mkdir(validationStage, { recursive: false });
    try {
      await writeFile(
        path.join(validationStage, "SKILL.md"),
        normalizedContent,
        {
          encoding: "utf8",
          flag: "wx",
        },
      );
      this.validateStagedSkill(validationStage, normalizedName);
      await writeFile(nextFile, normalizedContent, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(nextFile, path.join(destination, "SKILL.md"));
    } catch (error) {
      await rm(nextFile, { force: true });
      throw error;
    } finally {
      await rm(validationStage, { recursive: true, force: true });
    }
    return this.read(scope, normalizedName);
  }

  async remove(scope: PineSkillScope, name: string): Promise<boolean> {
    const normalizedName = validateSkillName(name);
    this.requireSkill(scope, normalizedName);
    const root = this.root(scope);
    const trash = path.join(root, ".trash");
    await mkdir(trash, { recursive: true });
    await rename(
      path.join(root, normalizedName),
      path.join(trash, `${normalizedName}-${Date.now()}-${randomUUID()}`),
    );
    return true;
  }

  async setGlobalSkillEnabled(name: string, enabled: boolean): Promise<void> {
    const normalizedName = validateSkillName(name);
    this.requireSkill("global", normalizedName);
    const settingsPath = this.roots.disabledGlobalSkillsPath;
    if (!settingsPath) {
      throw new Error("Project Skill settings are unavailable.");
    }
    const disabled = this.disabledGlobalSkillNames();
    if (enabled) disabled.delete(normalizedName);
    else disabled.add(normalizedName);
    await mkdir(path.dirname(settingsPath), { recursive: true });
    const temporary = `${settingsPath}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify({ disabledGlobalSkills: [...disabled].sort() }, null, 2)}\n`,
      "utf8",
    );
    await rename(temporary, settingsPath);
  }

  promptList(): string {
    const { skills } = this.listCombined();
    const visible = skills.filter(({ skill }) => !skill.disableModelInvocation);
    if (visible.length === 0) return "";
    const lines = [
      "<available_skills>",
      ...visible.flatMap(({ scope, skill }) => [
        "  <skill>",
        `    <name>${escapeXml(skill.name)}</name>`,
        `    <description>${escapeXml(skill.description)}</description>`,
        `    <scope>${scope}</scope>`,
        "  </skill>",
      ]),
      "</available_skills>",
    ];
    return `The following skills provide specialized instructions. When a task matches, call invoke_skill with the exact skill name before proceeding. Do not read skill files directly.\n\n${lines.join("\n")}`;
  }

  private root(scope: PineSkillScope): string {
    return scope === "global" ? this.roots.global : this.roots.project;
  }

  private disabledGlobalSkillNames(): Set<string> {
    const settingsPath = this.roots.disabledGlobalSkillsPath;
    if (!settingsPath) return new Set();
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as {
        disabledGlobalSkills?: unknown;
      };
      if (!Array.isArray(parsed.disabledGlobalSkills)) return new Set();
      return new Set(
        parsed.disabledGlobalSkills.filter(
          (value): value is string =>
            typeof value === "string" && SKILL_NAME_PATTERN.test(value),
        ),
      );
    } catch {
      return new Set();
    }
  }

  private validateStagedSkill(directory: string, expectedName: string): void {
    const result = loadSkillsFromDir(directory);
    const loaded = result.skills.find((skill) => skill.name === expectedName);
    if (!loaded) {
      const details = result.diagnostics
        .map((value) => value.message)
        .join(" ");
      throw new Error(details || "SKILL.md did not define a valid skill.");
    }
    if (result.skills.length !== 1) {
      throw new Error("A skill directory must define exactly one SKILL.md.");
    }
  }

  private requireSkill(scope: PineSkillScope, name: string): Skill {
    const normalizedName = validateSkillName(name);
    const result = loadSkillsFromDir(this.root(scope));
    const skill = result.skills.find((value) => value.name === normalizedName);
    if (!skill) throw new Error(`Skill \"${normalizedName}\" was not found.`);
    if (path.basename(skill.baseDir) !== normalizedName) {
      throw new Error(
        "Skill directory and skill name must match before editing.",
      );
    }
    return skill;
  }
}
