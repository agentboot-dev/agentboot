---
sidebar_label: "Model Selection"
sidebar_position: 4
---

# Model Selection Matrix

Guidelines for choosing the right Claude model for each persona type. Cost and quality
trade-offs vary by task complexity and organizational risk tolerance.

## Model Comparison

| Model | Speed | Cost | Best For |
|-------|-------|------|----------|
| Haiku 4.5 | Fastest | ~$0.001/1K tokens | Linting, simple checks, high-volume tasks |
| Sonnet 4.6 | Fast | ~$0.003/1K tokens | Code review, test generation, most personas |
| Opus 4.6 | Moderate | ~$0.015/1K tokens | Security review, architecture, complex reasoning |

## Persona Recommendations

| Persona | Recommended Model | Rationale |
|---------|-------------------|-----------|
| Code Reviewer | **Sonnet** | Good balance of speed and quality for PR review |
| Security Reviewer | **Opus** | Security findings require deep reasoning; false negatives are costly |
| Test Generator | **Sonnet** | Test generation is pattern-heavy; Sonnet handles well |
| Test Data Expert | **Haiku** or **Sonnet** | Data generation is mostly structural; Haiku is cost-effective |

## Configuration

Set model per persona in `persona.config.json`:

```json
{
  "model": "sonnet"
}
```

Or override at the agent level in `agents/{persona}.md` frontmatter:

```yaml
---
model: "opus"
---
```

## Decision Criteria

### Use Haiku when:
- The task is deterministic or low-stakes (linting, formatting, data scaffolding)
- Volume is high (running on every commit, every file)
- Latency matters more than depth (real-time suggestions, autocomplete)
- Budget is constrained and accuracy requirements are moderate

### Use Sonnet when:
- The task requires understanding code semantics (code review, test writing)
- Findings need to be actionable and specific (not just pattern matching)
- The persona runs on PRs or at moderate frequency
- You need a good balance of cost and quality (default for most orgs)

### Use Opus when:
- The task has high stakes (security review, compliance, architecture decisions)
- False negatives are expensive (missed vulnerabilities, incorrect approvals)
- The persona runs infrequently (weekly audits, release gates)
- Depth of reasoning matters more than speed

## Cost Estimation

For a team of 10 developers with ~5 PRs/day each:

| Persona | Model | Invocations/day | Est. daily cost |
|---------|-------|-----------------|-----------------|
| Code Reviewer | Sonnet | 50 | ~$3.00 |
| Security Reviewer | Opus | 10 | ~$3.00 |
| Test Generator | Sonnet | 20 | ~$1.20 |
| Test Data Expert | Haiku | 10 | ~$0.10 |
| **Total** | | **90** | **~$7.30/day** |

Monthly estimate: ~$165 for 4 personas across a 10-person team.

Use `agentboot cost-estimate` (Phase 4) for projections based on your actual config.

## Escalation Pattern

Some orgs use a two-tier approach:

1. **Fast pass (Haiku/Sonnet):** Run on every PR for quick feedback
2. **Deep pass (Opus):** Run on PRs touching security-sensitive paths or before release

Configure this via scope hierarchy — set `model: "opus"` at the team level for
security-sensitive repos while keeping `model: "sonnet"` as the org default.
