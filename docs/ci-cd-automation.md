# AgentBoot in CI/CD & Automation

How AgentBoot personas operate in non-interactive contexts: PR review bots, compliance
gates, scheduled scans, and the sync pipeline itself.

---

## Use Cases

| Use Case | Trigger | Persona(s) | Output |
|----------|---------|-----------|--------|
| **PR review** | PR opened/updated | code-reviewer, security-reviewer | PR comment with findings |
| **Compliance gate** | PR opened, scheduled | compliance hooks, guardrails | Pass/fail + audit log |
| **Architecture drift** | PR opened, scheduled | architecture-reviewer | Structured findings |
| **Test generation** | PR opened (new files) | test-generator | Suggested test files |
| **Persona validation** | PR to personas repo | validate.ts | Build pass/fail |
| **Persona sync** | Merge to personas repo main | sync.ts | PRs in target repos |
| **Scheduled security scan** | Cron (daily/weekly) | security-reviewer | Report |
| **Onboarding verification** | New repo registered | agentboot build | .claude/ populated |

---

## Delivery Methods for CI/CD

### 1. Claude Code Headless (`claude -p`) — Primary

Claude Code's print mode is the native CI interface. It runs a persona non-interactively,
produces structured output, and exits.

```bash
claude -p \
  --agent security-reviewer \
  --output-format json \
  --max-turns 10 \
  --max-budget-usd 1.00 \
  --permission-mode bypassPermissions \
  "Review the changes in this PR for security issues. Output structured findings."
```

**Key flags for CI:**

| Flag | Purpose |
|------|---------|
| `-p` | Print mode — non-interactive, exits when done |
| `--agent {name}` | Run a specific persona |
| `--output-format json` | Machine-parseable output |
| `--max-turns N` | Bound compute (prevent runaway) |
| `--max-budget-usd N` | Bound cost |
| `--permission-mode bypassPermissions` | No interactive prompts (CI has no human) |
| `--json-schema '{...}'` | Force output to match a schema |
| `--fallback-model sonnet` | Graceful degradation if primary model unavailable |
| `--no-session-persistence` | Don't save session (ephemeral CI run) |
| `--system-prompt-file ./ci-prompt.md` | Inject CI-specific instructions |
| `--tools "Read,Grep,Glob,Bash"` | Restrict tools (no Edit/Write in review) |
| `--from-pr 123` | Resume context from a PR (auto-links session) |

**PR review workflow:**

```yaml
# .github/workflows/agentboot-review.yml
name: AgentBoot PR Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0    # Full history for diff context

      - name: Install Claude Code
        run: npm install -g @anthropic-ai/claude-code

      - name: Run code review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          claude -p \
            --agent code-reviewer \
            --output-format json \
            --max-turns 10 \
            --max-budget-usd 2.00 \
            --permission-mode bypassPermissions \
            --no-session-persistence \
            "Review the PR diff. Run git diff origin/main...HEAD to see changes." \
            > review-output.json

      - name: Post review comment
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          # Parse JSON output and post as PR comment
          jq -r '.result' review-output.json | gh pr comment ${{ github.event.pull_request.number }} --body-file -

      - name: Check for blockers
        run: |
          # Fail CI if CRITICAL findings
          CRITICAL_COUNT=$(jq '[.findings[] | select(.severity == "CRITICAL")] | length' review-output.json 2>/dev/null || echo "0")
          if [ "$CRITICAL_COUNT" -gt 0 ]; then
            echo "::error::$CRITICAL_COUNT CRITICAL findings. Review required."
            exit 1
          fi
```

**Why this is the primary CI method:**
- Native Claude Code feature — no wrapper or adapter
- JSON output is machine-parseable
- Cost-bounded (`--max-budget-usd`)
- Compute-bounded (`--max-turns`)
- Schema-enforced output (`--json-schema`)
- Full agent/persona support (`--agent`)
- Session isolation (`--no-session-persistence`)

---

### 2. AgentBoot CLI (`agentboot`) — Build Pipeline

The CLI handles the personas repo CI — validating, building, and syncing.

```yaml
# .github/workflows/agentboot-build.yml (in the personas repo)
name: AgentBoot Build & Sync
on:
  push:
    branches: [main]
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: agentboot validate    # Schema, trait refs, frontmatter, secrets

  build:
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: agentboot build
      - run: agentboot export --format plugin    # Generate CC plugin
      - run: agentboot export --format cross-platform
      - uses: actions/upload-artifact@v4
        with:
          name: agentboot-dist
          path: dist/

  sync:
    if: github.ref == 'refs/heads/main'
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: agentboot build
      - run: agentboot sync --mode github-api
        env:
          GITHUB_TOKEN: ${{ secrets.SYNC_TOKEN }}
```

**This handles:**
- Validation on every PR to the personas repo
- Build verification (trait composition, frontmatter, PERSONAS.md)
- Plugin generation for marketplace publishing
- Auto-sync to target repos on merge to main (via GitHub API PRs)

---

### 3. Compliance Gate (Hooks, No LLM)

Not everything needs an LLM call. Deterministic compliance checks run as hook scripts
or standalone CI steps — fast, cheap, and predictable.

```yaml
  compliance-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: PHI/PII scan (deterministic)
        run: |
          # Run AgentBoot's compliance hook script against the diff
          git diff origin/main...HEAD | .claude/hooks/sensitive-data-scan.sh
          # Exit code 2 = PHI detected = CI fail

      - name: Credential scan
        run: |
          # Regex-based credential detection
          git diff origin/main...HEAD | .claude/hooks/credential-scan.sh

      - name: License check
        run: |
          # Verify no GPL/AGPL dependencies added
          .claude/hooks/license-check.sh
```

**Why this matters:**
- Zero cost (no API call)
- Sub-second execution
- Deterministic (same input → same output)
- Runs on every PR, not just reviewed ones
- Defense-in-depth Layer 1 (before the LLM-based review)

---

### 4. MCP Server — Programmatic Access

For CI systems that need to invoke personas programmatically (not via Claude Code CLI),
the MCP server provides an API.

```yaml
  mcp-review:
    runs-on: ubuntu-latest
    services:
      agentboot-mcp:
        image: ghcr.io/agentboot/mcp-server:latest
        env:
          AGENTBOOT_CONFIG: /config/agentboot.config.json

    steps:
      - name: Invoke security review via MCP
        run: |
          # Call MCP tool directly
          curl -X POST http://agentboot-mcp:8080/tools/agentboot_review \
            -H "Content-Type: application/json" \
            -d '{
              "persona": "security-reviewer",
              "input": "'"$(git diff origin/main...HEAD)"'",
              "format": "json"
            }' > review.json
```

**When to use MCP over `claude -p`:**
- When the CI environment can't install Claude Code
- When you need persona invocation from non-Node.js CI (Python, Go, etc.)
- When you want a persistent server for multiple review calls (cheaper than cold-starting `claude -p` each time)
- When integrating with non-Anthropic LLM backends

---

### 5. Cron (Scheduled Scans via Claude Code)

Claude Code's native `CronCreate` tool runs scheduled tasks. For CI-like automation
that runs inside a developer's session rather than in a CI pipeline:

```
# In a Claude Code session:
CronCreate: "Run /agentboot:review-security on all files changed in the last 24h" every 24h
```

**Better for CI pipelines — use GitHub Actions scheduled:**

```yaml
  scheduled-scan:
    runs-on: ubuntu-latest
    schedule:
      - cron: '0 6 * * 1'    # Every Monday at 6am

    steps:
      - uses: actions/checkout@v4

      - name: Full security scan
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          claude -p \
            --agent security-reviewer \
            --output-format json \
            --max-turns 30 \
            --max-budget-usd 10.00 \
            --permission-mode bypassPermissions \
            --no-session-persistence \
            "Scan the entire codebase for security issues. Focus on: auth, data handling, API security, dependency vulnerabilities."

      - name: Full architecture review
        run: |
          claude -p \
            --agent architecture-reviewer \
            --output-format json \
            --max-turns 20 \
            --max-budget-usd 5.00 \
            --permission-mode bypassPermissions \
            --no-session-persistence \
            "Check for architectural drift against ADRs. Report violations."
```

---

## Output Schema for CI

AgentBoot personas in CI should produce structured output that CI can parse:

```json
{
  "persona": "security-reviewer",
  "version": "1.2.0",
  "model": "claude-sonnet-4-6",
  "timestamp": "2026-03-19T14:30:00Z",
  "scope": {
    "org": "acme-corp",
    "group": "platform",
    "team": "api"
  },
  "input": {
    "type": "pr-diff",
    "ref": "refs/pull/123/head",
    "base": "main",
    "files_changed": 12
  },
  "summary": {
    "critical": 0,
    "error": 2,
    "warn": 5,
    "info": 3,
    "suggestions": 2
  },
  "findings": [
    {
      "severity": "ERROR",
      "rule": "missing-auth-check",
      "location": "src/api/users.ts:47",
      "description": "POST endpoint missing authentication middleware",
      "suggestion": "Add authMiddleware() before the handler",
      "confidence": 0.9,
      "citation": "src/middleware/auth.ts:12 — pattern used on all other endpoints"
    }
  ],
  "cost": {
    "input_tokens": 12400,
    "output_tokens": 3200,
    "usd": 0.42
  },
  "gate": {
    "passed": true,
    "reason": "No CRITICAL findings. 2 ERROR findings require manual review."
  }
}
```

Use `--json-schema` to enforce this structure:

```bash
claude -p \
  --agent security-reviewer \
  --output-format json \
  --json-schema '{"type":"object","required":["summary","findings","gate"],...}' \
  "Review this PR."
```

---

## Decision Matrix

| Use Case | Method | Cost | Latency | Deterministic |
|----------|--------|------|---------|---------------|
| PR compliance gate (PHI/credentials) | Hook scripts | Free | <1s | Yes |
| PR code review | `claude -p --agent` | $0.50-2.00 | 30-90s | No |
| PR security review | `claude -p --agent` | $1.00-5.00 | 60-120s | No |
| Personas repo validation | `agentboot validate` | Free | <5s | Yes |
| Personas repo build | `agentboot build` | Free | <10s | Yes |
| Personas sync to repos | `agentboot sync` | Free | <30s | Yes |
| Weekly security scan | `claude -p` + cron | $5-20 | 5-15min | No |
| Architecture drift detection | `claude -p` + cron | $2-10 | 2-10min | No |
| Cross-platform review API | MCP server | Varies | Varies | No |

**Rule of thumb:** Use deterministic hooks for pass/fail gates. Use LLM-based review
for nuanced analysis. Layer them: hooks catch the obvious, personas catch the subtle.

---

## CI Permissions & Security

### API Key Management

```yaml
# GitHub Actions secret
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

- Use a **dedicated CI API key** with budget limits, not a developer's key
- Set `--max-budget-usd` on every `claude -p` call to prevent runaway costs
- Monitor usage via Anthropic's usage dashboard or structured telemetry

### Tool Restrictions in CI

CI personas should have stricter tool access than interactive personas:

```bash
# Review persona — read-only
claude -p --agent code-reviewer \
  --tools "Read,Grep,Glob,Bash" \
  --permission-mode bypassPermissions

# Test generator — can write test files
claude -p --agent test-generator \
  --tools "Read,Grep,Glob,Bash,Write" \
  --allowedTools "Write(tests/**)" \
  --permission-mode bypassPermissions
```

### Network Access

CI runners may need network restrictions:

```bash
# No web access (air-gapped review)
claude -p --agent code-reviewer \
  --tools "Read,Grep,Glob,Bash" \
  --disallowedTools "WebFetch,WebSearch"
```

---

## GitHub Actions Reusable Workflow

AgentBoot should ship a reusable GitHub Actions workflow that orgs can call:

```yaml
# In target repo: .github/workflows/agentboot-review.yml
name: AgentBoot Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    uses: agentboot/agentboot/.github/workflows/review.yml@v1
    with:
      personas: "code-reviewer,security-reviewer"
      max-budget: "3.00"
      fail-on: "critical"        # critical | error | warn
      comment-on-pr: true
    secrets:
      anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

This is the **lowest-friction CI integration** — one YAML file in the target repo,
no AgentBoot CLI installation, no personas repo setup. The reusable workflow handles
`claude -p` invocation, output parsing, PR commenting, and gate logic.

---

## Non-Claude Code CI/CD

### GitHub Copilot

**Native PR Review (Repository Rules):**

Copilot can auto-review every PR without any CI pipeline. Configure in GitHub repo
settings → Rules → Copilot review. This uses the `copilot-instructions.md` that
AgentBoot synced to the repo as the review baseline.

This is the lowest-effort CI-like experience: AgentBoot syncs instructions → Copilot
reads them → every PR gets reviewed automatically. No API key, no workflow file, no
cost per run (included in Copilot Enterprise).

**Copilot CLI in GitHub Actions:**

```yaml
- name: Review with Copilot CLI
  run: |
    gh copilot suggest \
      --skill code-reviewer \
      "Review the changes in this PR" \
      > review.md
```

Copilot CLI supports Agent Skills (agentskills.io format). AgentBoot's cross-platform
SKILL.md output works here.

**Limitations vs. `claude -p`:**
- No `--output-format json` — output is text only
- No `--max-budget-usd` — no cost bounding
- No `--json-schema` — no structured output enforcement
- No `--agent` with custom frontmatter — skills only, not full agent definitions
- No `--permission-mode` — no fine-grained tool control

### Cursor

Cursor has no headless/CLI mode for CI. The CI strategy for Cursor repos:

1. Use `claude -p` in CI (even if developers use Cursor locally)
2. AgentBoot's personas work in both — same SKILL.md format
3. The CI review uses Claude Code; the developer uses Cursor interactively

This is a legitimate pattern: the CI agent doesn't have to match the developer's IDE.
The persona definitions are the same; only the runtime differs.

### Gemini CLI

```bash
gemini -p --skill security-reviewer "Review this PR"
```

Gemini CLI supports Agent Skills. AgentBoot's cross-platform SKILL.md works here.
Less mature than `claude -p` for CI (fewer flags, no cost bounding).

### MCP Server in CI (Any Platform)

The MCP server is platform-agnostic. Any CI system that can make HTTP calls can
invoke AgentBoot personas:

```yaml
- name: Review via MCP
  run: |
    curl -X POST http://agentboot-mcp:8080/tools/agentboot_review \
      -d '{"persona": "security-reviewer", "input": "'"$(git diff)"'"}'
```

This works regardless of whether the org uses CC, Copilot, Cursor, or all three.

### CI Platform Comparison

| Capability | Claude Code (`claude -p`) | Copilot (native) | Copilot CLI | Gemini CLI | MCP Server |
|------------|--------------------------|-------------------|-------------|------------|------------|
| Structured JSON output | Yes (`--output-format json`) | No | No | No | Yes |
| Cost bounding | Yes (`--max-budget-usd`) | Included | No | No | Custom |
| Schema enforcement | Yes (`--json-schema`) | No | No | No | Custom |
| Custom agents | Yes (`--agent`) | No | No | No | Yes |
| Tool restrictions | Yes (`--tools`) | N/A | No | No | Custom |
| Deterministic hooks | Yes (settings.json) | No | No | No | Custom |
| Zero-config PR review | No (needs workflow) | Yes (repo rules) | No | No | No |
| Agent Skills support | Yes | Yes (agent mode) | Yes | Yes | N/A |
| Per-run cost | API usage | Included in license | API usage | API usage | API usage |

**Recommendation for mixed-agent orgs:** Use Copilot's native PR review for the
zero-config baseline (free, always-on), and `claude -p` in CI for the deep review
with structured output, cost bounding, and custom agent support. They complement
each other.

---

*See also:*
- [`docs/delivery-methods.md`](delivery-methods.md) — all delivery channels including non-CC
- [`docs/concepts.md`](concepts.md) — compliance hooks, structured telemetry
- [`docs/claude-code-reference/feature-inventory.md`](claude-code-reference/feature-inventory.md) — CLI flags reference
