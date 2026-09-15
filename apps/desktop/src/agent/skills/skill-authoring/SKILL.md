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
- Write a complete `SKILL.md` with YAML frontmatter containing the same `name` and a concrete `description`.
- Keep the main instructions concise and imperative. Put long reference material or reusable scripts in supporting files when the skill needs them.
- Describe when the skill should activate in the frontmatter description; do not hide activation criteria only in the body.
- Do not create or change a skill unless the user asked for a reusable behavior.

## Mutations

- Use `create_skill` only for a new name in the selected scope.
- Use `edit_skill` to replace the existing `SKILL.md` content while preserving supporting files.
- Use `remove_skill` only when the user explicitly asks to remove the skill. Removal is recoverable from Pine's internal trash.
