---
description: "Author and edit AgentBoot personas, traits, gotchas, and instructions."
---

# /ab-author — Persona Authoring

The `/ab-author` skill helps you create and modify AgentBoot artifacts:
personas, traits, gotchas, and instructions.

## Operations

| Command | Description |
|---|---|
| `/ab-author persona <name>` | Create or edit a persona |
| `/ab-author trait <name>` | Create or edit a trait |
| `/ab-author gotcha <name>` | Create or edit a gotcha rule |
| `/ab-author instruction <name>` | Create or edit an always-on instruction |

## Persona Authoring

When creating a persona, the skill will:
1. Generate `core/personas/{name}/SKILL.md` with trait injection markers
2. Generate `core/personas/{name}/persona.config.json` with trait references and weights
3. Validate the persona compiles successfully

## Trait Authoring

Traits are reusable behavioral building blocks. When creating a trait:
1. Generate `core/traits/{name}.md` with proper frontmatter
2. Register the trait in `agentboot.config.json` if not already present
3. Suggest personas that could benefit from the new trait

## Gotcha Authoring

Gotchas are path-scoped knowledge rules. When creating a gotcha:
1. Generate `core/gotchas/{name}.md` with `paths:` frontmatter
2. Validate path glob patterns are syntactically correct
3. Compile to platform-native rule format
