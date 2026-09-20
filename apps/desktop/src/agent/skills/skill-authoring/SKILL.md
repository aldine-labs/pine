---
name: skill-authoring
description: Create, edit, or remove reusable Pine skills in global or project scope.
---

# Pine Skill Authoring

Use the dynamically activated skill tools to manage reusable Pine instructions.

## Scope

- Prefer `project` scope when the instructions are specific to the current project.
- Use `global` scope only when the user wants the skill available in every project.
- A project skill with the same name overrides a global skill.

## Authoring requirements

- Use a lowercase kebab-case name of at most 64 characters.
- Write a complete `SKILL.md` with YAML frontmatter containing the same `name` as its directory and a concrete `description` of at most 1024 characters.
- Preserve the standard optional `license`, `compatibility` (at most 500 characters), `metadata` (string-to-string values), and space-separated `allowed-tools` fields when they are useful.
- Keep the main instructions concise and imperative. Put long reference material or reusable scripts in supporting files when the skill needs them.
- Keep supporting files in the skill directory, using folders such as `scripts/`, `references/`, and `assets/`; refer to them with paths relative to the skill root.
- Describe when the skill should activate in the frontmatter description; do not hide activation criteria only in the body.
- Do not create or change a skill unless the user asked for a reusable behavior.

## Mutations

- Use `create_skill` only for a new name in the selected scope.
- `create_skill` and `edit_skill` return the absolute `skillDirectory`. Use that exact path with the existing `write`, `edit`, or `bash` tools when creating or updating bundled resources; do not guess Pine's internal storage path.
- Use `edit_skill` to replace the existing `SKILL.md` content while preserving supporting files.
- Use `remove_skill` only when the user explicitly asks to remove the skill. Removal is recoverable from Pine's internal trash.

## Resources

- After invoking a skill, use `list_skill_resources` to inspect bundled files only when the instructions refer to them.
- Use `read_skill_resource` to load one referenced text file at a time. Use base64 encoding only for binary assets that need to be passed to another tool.
- After creating a skill, create resource files below the returned `skillDirectory`, for example `skillDirectory/references/REFERENCE.md` or `skillDirectory/scripts/prepare.py`.
