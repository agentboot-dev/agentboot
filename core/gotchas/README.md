# Gotchas

Gotchas are path-scoped rules that encode battle-tested operational knowledge.
They activate automatically when developers work on files matching specific paths.

## File Format

Each gotcha is a markdown file in `core/gotchas/` with `paths:` frontmatter:

```markdown
---
description: "Brief description of the gotcha"
paths:
  - "**/*.lambda.ts"
  - "functions/**"
---

# Lambda Deployment Gotchas

- **Cold start penalty:** Lambda cold starts add 1-3s latency...
```

## Sources for Gotchas

- Post-incident reviews ("what did we learn?")
- Onboarding notes ("what I wish I knew")
- Code review comments that repeat
- Production debugging sessions with non-obvious root causes

## How They Work

During `agentboot build`, gotcha files are compiled into `.claude/rules/` with
`paths:` frontmatter so Claude Code activates them only for matching files.

During `agentboot sync`, they are distributed to target repos alongside personas.
