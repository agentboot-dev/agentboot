# AgentBoot Test Plan

How to test a system whose outputs are non-deterministic, whose users are both
humans and AI agents, and whose value is measured in behavioral quality — not
binary pass/fail.

---

## Two Test Boundaries

There are two completely separate things to test, owned by two different parties:

```
┌──────────────────────────────────┐  ┌─────────────────────────────────────┐
│  AgentBoot Core                  │  │  Acme-Boot (Org's Personas Repo)    │
│  (this repo)                     │  │  (acme-corp/acme-personas)          │
│                                  │  │                                     │
│  Owner: AgentBoot maintainers    │  │  Owner: Acme's platform team        │
│  Cost: AgentBoot's budget        │  │  Cost: Acme's budget                │
│                                  │  │                                     │
│  What's tested:                  │  │  What's tested:                     │
│  ├── compile.ts works            │  │  ├── Acme's custom personas behave  │
│  ├── validate.ts catches errors  │  │  ├── Acme's traits compose right    │
│  ├── sync.ts distributes right   │  │  ├── Acme's gotchas are accurate    │
│  ├── lint rules are correct      │  │  ├── Acme's hooks enforce policy    │
│  ├── CLI commands work           │  │  ├── Acme's domain layer works      │
│  ├── Core personas are sane      │  │  └── Acme's org config is valid     │
│  ├── Core traits compose         │  │                                     │
│  └── Plugin export is valid      │  │  Uses: agentboot test, agentboot    │
│                                  │  │  lint, agentboot validate           │
│  Tests: vitest, CI on every PR   │  │  Tests: same tools, Acme's CI      │
│  Budget: our CI costs            │  │  Budget: Acme's API key + CI costs  │
└──────────────────────────────────┘  └─────────────────────────────────────┘
```

**AgentBoot core** tests whether the build system, CLI, lint rules, and core
personas work correctly. This is our responsibility, our cost, our CI.

**Acme-boot** tests whether the org's custom personas, traits, gotchas, hooks,
and domain layers work correctly. This is the org's responsibility, their cost,
their CI — using tools that AgentBoot provides.

AgentBoot ships the testing tools (`agentboot test`, `agentboot lint`,
`agentboot validate`). The org uses them on their content. AgentBoot tests
that the tools themselves work. The org tests that their content works.

---

## The Testing Challenge

AgentBoot core has three fundamentally different layers to test:

| Layer | Nature | Testing Approach |
|-------|--------|-----------------|
| **Build system** (compile, validate, sync) | Deterministic code | Traditional unit/integration tests |
| **Persona output** (SKILL.md, CLAUDE.md, agents, rules) | Static files | Schema validation, lint, structural tests |
| **Persona behavior** (what the persona actually DOES when invoked) | Non-deterministic LLM output | Behavioral assertions, LLM-as-judge, snapshot regression |

The first two are standard software testing. The third is the novel problem.

---

## Test Pyramid

```
                    ╱╲
                   ╱  ╲
                  ╱ E2E╲           Human review of persona output
                 ╱ (rare)╲         in real repos. Manual, expensive.
                ╱──────────╲
               ╱ Behavioral ╲      LLM invocation with known inputs.
              ╱  (moderate)  ╲     Assert on output patterns. ~$0.50/test.
             ╱────────────────╲
            ╱  Integration     ╲   Build pipeline produces correct output.
           ╱   (frequent)       ╲  File structure, content, format. Free.
          ╱──────────────────────╲
         ╱  Unit / Schema          ╲  Config validation, frontmatter parsing,
        ╱   (very frequent)         ╲ trait composition, lint rules. Free.
       ╱─────────────────────────────╲
```

Run the bottom layers on every commit. Run behavioral tests on every PR. Run E2E
reviews manually on major persona changes.

---

## Layer 1: Unit & Schema Tests (Free, Fast, Every Commit)

### What to Test

**Config validation:**
```typescript
// tests/config.test.ts
describe('agentboot.config.json', () => {
  it('validates against JSON schema', () => { ... })
  it('rejects unknown fields', () => { ... })
  it('requires org field', () => { ... })
  it('validates group/team references match', () => { ... })
  it('validates persona IDs exist in core/personas/', () => { ... })
  it('validates trait IDs exist in core/traits/', () => { ... })
})
```

**Frontmatter parsing:**
```typescript
// tests/frontmatter.test.ts
describe('SKILL.md frontmatter', () => {
  it('parses all persona SKILL.md files without error', () => { ... })
  it('requires name field', () => { ... })
  it('requires description field', () => { ... })
  it('validates trait references resolve', () => { ... })
  it('validates weight values (HIGH/MEDIUM/LOW or 0.0-1.0)', () => { ... })
})
```

**Trait composition:**
```typescript
// tests/composition.test.ts
describe('trait composition', () => {
  it('inlines trait content at injection markers', () => { ... })
  it('resolves HIGH/MEDIUM/LOW to numeric weights', () => { ... })
  it('errors on missing trait reference', () => { ... })
  it('errors on circular trait dependency', () => { ... })
  it('composes multiple traits in declared order', () => { ... })
})
```

**Lint rules:**
```typescript
// tests/lint.test.ts
describe('lint rules', () => {
  it('detects vague language ("be thorough", "try to")', () => { ... })
  it('detects prompts exceeding token budget', () => { ... })
  it('detects credentials in prompt text', () => { ... })
  it('detects conflicting instructions across traits', () => { ... })
  it('detects unused traits', () => { ... })
  it('passes clean persona files', () => { ... })
})
```

**Sync logic:**
```typescript
// tests/sync.test.ts
describe('sync', () => {
  it('writes CC-native output to claude-code platform repos', () => { ... })
  it('writes cross-platform output to copilot platform repos', () => { ... })
  it('merges org + group + team scopes correctly', () => { ... })
  it('team overrides group on optional behaviors', () => { ... })
  it('org wins on mandatory behaviors', () => { ... })
  it('writes .agentboot-manifest.json tracking managed files', () => { ... })
  it('generates PERSONAS.md registry', () => { ... })
})
```

### Tooling

- **Test runner:** vitest (already in package.json)
- **Assertion:** vitest built-in + custom matchers for frontmatter, token counting
- **Fixtures:** `tests/fixtures/` with valid and invalid persona files
- **CI:** Runs on every commit and PR. Must pass to merge.

---

## Layer 2: Integration Tests (Free, Moderate Speed, Every PR)

### What to Test

**Full build pipeline:**
```typescript
// tests/integration/build-pipeline.test.ts
describe('full build', () => {
  it('validate → compile → sync produces expected output', () => {
    // Given: a test agentboot.config.json + personas + traits
    // When: run the full pipeline
    // Then: dist/ contains expected files with expected content
  })

  it('CC-native output has correct agent CLAUDE.md frontmatter', () => {
    // Check: name, description, model, permissionMode, maxTurns,
    //        disallowedTools, skills, hooks, memory
  })

  it('CC-native output uses @imports not inlined traits', () => {
    // Check: CLAUDE.md contains @.claude/traits/critical-thinking.md
    //        NOT the full trait content
  })

  it('cross-platform output has standalone inlined SKILL.md', () => {
    // Check: SKILL.md contains full trait content, no @imports
  })

  it('settings.json has hook entries from domain config', () => { ... })
  it('.mcp.json has server entries from domain config', () => { ... })
  it('rules have paths: frontmatter (not globs:)', () => { ... })
})
```

**Plugin export:**
```typescript
// tests/integration/plugin-export.test.ts
describe('plugin export', () => {
  it('produces valid plugin structure', () => {
    // .claude-plugin/plugin.json exists with correct name, version
    // agents/, skills/, hooks/ at root level (not inside .claude-plugin/)
    // marketplace.json valid if marketplace export
  })

  it('passes claude plugin validate', () => {
    // Run: claude plugin validate ./dist/plugin
    // Exit code 0
  })
})
```

**Discover + ingest:**
```typescript
// tests/integration/discover.test.ts
describe('discover', () => {
  it('finds CLAUDE.md files in test repo structure', () => { ... })
  it('finds .cursorrules and copilot-instructions.md', () => { ... })
  it('identifies near-duplicate content across repos', () => { ... })
  it('generates migration plan with correct classifications', () => { ... })
  it('does not modify source files (non-destructive)', () => { ... })
})
```

**Uninstall:**
```typescript
// tests/integration/uninstall.test.ts
describe('uninstall', () => {
  it('removes only files listed in .agentboot-manifest.json', () => { ... })
  it('preserves files not managed by AgentBoot', () => { ... })
  it('warns on modified managed files', () => { ... })
  it('restores pre-AgentBoot archive when requested', () => { ... })
  it('handles mixed content in CLAUDE.md', () => { ... })
})
```

### Tooling

- **Test runner:** vitest
- **Filesystem:** Use temp directories (vitest's `tmpdir` or `os.tmpdir()`)
- **Git fixtures:** Init test repos with known content for discover/sync tests
- **CI:** Runs on every PR. Must pass to merge.

---

## Layer 3: Behavioral Tests (LLM Call, ~$0.50/test, Every PR to Personas)

This is where it gets interesting. Testing whether a persona *behaves* correctly
requires actually invoking it.

### The Testing Model

```
Known input              Persona           Output              Assert
(crafted code      →     (invoked via  →   (structured    →    (pattern match
 with known bugs)         claude -p)        findings)           against expected)
```

### Test File Format

```yaml
# tests/behavioral/code-reviewer.test.yaml

persona: code-reviewer
model: haiku                # Use cheapest model for tests (behavior, not quality)
max_turns: 5
max_budget_usd: 0.50

setup:
  # Create test files that the persona will review
  files:
    - path: src/api/users.ts
      content: |
        export async function getUser(userId) {
          const query = `SELECT * FROM users WHERE id = ${userId}`;
          return db.execute(query);
        }

cases:
  - name: catches-sql-injection
    prompt: "Review the file src/api/users.ts"
    expect:
      findings_min: 1
      severity_includes: [CRITICAL, ERROR]
      text_matches:
        - pattern: "SQL injection|parameterized|prepared statement"
          in: findings
      confidence_min: 0.7

  - name: no-false-positives-on-safe-code
    setup_override:
      files:
        - path: src/api/users.ts
          content: |
            export async function getUser(userId: number) {
              return db.execute('SELECT * FROM users WHERE id = $1', [userId]);
            }
    prompt: "Review the file src/api/users.ts"
    expect:
      findings_max: 0
      severity_excludes: [CRITICAL, ERROR]

  - name: structured-output-format
    prompt: "Review the file src/api/users.ts"
    expect:
      output_contains:
        - "CRITICAL" or "ERROR" or "WARN" or "INFO"     # Severity labels
        - "src/api/users.ts"                              # File reference
      output_structure:
        has_sections: [findings, summary]
```

### Test Runner

```bash
# Run all behavioral tests
agentboot test --type behavioral

# Run for one persona
agentboot test --type behavioral --persona code-reviewer

# Use a specific model (override test file)
agentboot test --type behavioral --model sonnet

# Cost cap for entire test suite
agentboot test --type behavioral --max-budget 5.00

# CI mode (exit codes, JSON summary)
agentboot test --type behavioral --ci
```

Under the hood, each test case runs:

```bash
claude -p \
  --agent code-reviewer \
  --output-format json \
  --max-turns 5 \
  --max-budget-usd 0.50 \
  --permission-mode bypassPermissions \
  --no-session-persistence \
  "$PROMPT"
```

The runner parses the JSON output and evaluates the `expect` assertions.

### Assertion Types

| Assertion | What it checks | Example |
|---|---|---|
| `findings_min: N` | At least N findings | Persona found the bug |
| `findings_max: N` | At most N findings | No false positives |
| `severity_includes: [X]` | At least one finding has severity X | SQL injection flagged as CRITICAL |
| `severity_excludes: [X]` | No findings have severity X | Clean code doesn't trigger ERROR |
| `text_matches: [{pattern}]` | Regex match in output | "SQL injection" mentioned |
| `text_excludes: [{pattern}]` | Regex must NOT match | Didn't hallucinate a finding |
| `confidence_min: N` | All findings have confidence ≥ N | Persona is sure about SQL injection |
| `output_contains: [X]` | Output includes literal strings | File reference present |
| `output_structure: {}` | Structural checks on output | Has findings and summary sections |
| `json_schema: path` | Output matches JSON schema | Structured output validates |
| `token_max: N` | Output stays within token budget | Persona isn't verbose |
| `duration_max_ms: N` | Execution time limit | Persona doesn't run away |

### Non-Determinism Strategy

LLM output is non-deterministic. The same input may produce different findings across
runs. The testing strategy:

1. **Test for patterns, not exact output.** Don't assert "the finding text is exactly
   X." Assert "the output contains a CRITICAL finding mentioning SQL injection."

2. **Test obvious cases.** Use inputs where any competent reviewer would find the
   issue. A parameterized SQL query with string interpolation is an obvious SQL
   injection — every run should catch it.

3. **Allow flake tolerance.** Run each behavioral test 3 times. Pass if 2/3 pass.
   This handles the rare case where the model misses something obvious. Configure:
   ```yaml
   flake_tolerance: 2 of 3    # Pass if 2 of 3 runs succeed
   ```

4. **Use cheap models for behavioral tests.** Haiku is sufficient to test whether a
   persona's prompt structure elicits the right behavior. If the prompt is good enough
   to work on Haiku, it'll work better on Sonnet/Opus. If it fails on Haiku, the
   prompt needs work regardless of model.

5. **Separate "does it work" from "how well does it work."** Behavioral tests check
   "does the persona catch the SQL injection?" (binary). Quality evaluation ("did it
   explain the fix well?") is a separate concern — see Layer 5.

---

## Layer 4: Snapshot / Regression Tests ($, Periodic)

Compare persona output across versions to detect regressions.

### How It Works

```bash
# Generate baseline snapshots
agentboot test --type snapshot --update

# Compare current output against baseline
agentboot test --type snapshot
```

The snapshot test:
1. Runs each persona against a fixed set of test inputs
2. Saves the structured output (findings, severities, count) as a snapshot
3. On subsequent runs, compares current output against the snapshot
4. Flags differences for human review

```
$ agentboot test --type snapshot

  Snapshot Comparison: code-reviewer
  ──────────────────────────────────

  Test: sql-injection-detection
    Baseline: 1 CRITICAL (SQL injection)
    Current:  1 CRITICAL (SQL injection) + 1 WARN (missing type annotation)
    Status:   CHANGED — new finding added
    → Is the new WARN correct? [y = update snapshot / n = investigate]

  Test: clean-code-no-findings
    Baseline: 0 findings
    Current:  0 findings
    Status:   MATCH ✓

  Test: auth-middleware-review
    Baseline: 1 ERROR (missing auth check) + 2 WARN
    Current:  0 findings
    Status:   REGRESSION ⚠️ — previously caught ERROR now missed
    → Investigate: trait change? prompt change? model change?
```

### When to Run

- **After any persona prompt change** — did the edit improve or regress behavior?
- **After trait updates** — did changing `critical-thinking` affect review quality?
- **After model changes** — does the persona work as well on Sonnet as it did on Opus?
- **Periodically (weekly)** — catch drift from model updates by the provider

### What Snapshots Contain

Snapshots store structured summaries, not full output:

```json
{
  "persona": "code-reviewer",
  "test_case": "sql-injection-detection",
  "snapshot_date": "2026-03-19",
  "model": "haiku",
  "findings_count": { "CRITICAL": 1, "ERROR": 0, "WARN": 0, "INFO": 0 },
  "finding_patterns": ["SQL injection", "parameterized"],
  "total_tokens": 1200,
  "duration_ms": 8500
}
```

Not the full prose output — just the structural signature. This makes comparison
reliable across non-deterministic runs.

---

## Layer 5: LLM-as-Judge ($$, Major Changes Only)

For qualitative evaluation that can't be reduced to pattern matching: "Is this review
actually good? Is it thorough? Would a senior engineer agree with it?"

### How It Works

A separate LLM call evaluates the persona's output:

```yaml
# tests/eval/code-reviewer-quality.eval.yaml

persona_under_test: code-reviewer
judge_model: opus                    # Use strongest model as judge
max_budget_usd: 2.00

cases:
  - name: review-quality-auth-endpoint
    input_file: tests/fixtures/auth-endpoint-with-bugs.ts
    persona_prompt: "Review this file"
    judge_prompt: |
      You are a senior staff engineer evaluating the quality of an AI code review.

      The code being reviewed:
      {input}

      The review produced:
      {persona_output}

      Evaluate on these dimensions (1-5 scale):
      1. Completeness: Did it find the important issues?
      2. Accuracy: Are the findings correct? Any false positives?
      3. Specificity: Are suggestions actionable with file:line references?
      4. Prioritization: Are severity levels appropriate?
      5. Tone: Professional, constructive, not pedantic?

      Known issues in the code (ground truth):
      - SQL injection on line 12
      - Missing rate limiting on POST endpoint
      - Auth token not validated for expiry

      Score each dimension 1-5. Explain your reasoning. Then give an overall
      pass/fail: does this review meet the bar for a senior engineer's review?
    expect:
      judge_score_min:
        completeness: 3
        accuracy: 4
        overall: "pass"
```

### When to Use

- **Major persona prompt rewrites** — did the rewrite improve quality?
- **New personas** — does the new persona meet the bar before shipping?
- **Model migration** — switching from Opus to Sonnet — does quality hold?
- **Quarterly quality audits** — periodic check on the full persona suite

### Cost Control

LLM-as-judge is expensive (Opus as judge + persona invocation). Budget it:

```bash
agentboot test --type eval --max-budget 20.00

# Only run for specific personas
agentboot test --type eval --persona security-reviewer

# Skip if behavioral tests already passed (cascade)
agentboot test --type eval --skip-if-behavioral-passed
```

---

## Layer 6: Human Review (Manual, Major Releases Only)

The human is always in the loop for judgment calls that no automated test can make.

### When Humans Review

| Trigger | What they review | Who |
|---|---|---|
| New persona ships | Full output on 3-5 real PRs | Platform team + domain expert |
| Major trait change | Before/after comparison on real code | Platform team |
| Quarterly audit | Random sample of 20 persona outputs | Platform team |
| Quality escalation | Specific finding that a developer disputed | Persona author |

### How to Make It Efficient

**The review tool:** `agentboot review` generates a side-by-side comparison:

```bash
agentboot review --persona code-reviewer --sample 5

#   Human Review: code-reviewer (v1.3.0)
#   ──────────────────────────────────────
#
#   Reviewing 5 randomly sampled outputs from the last 7 days.
#
#   Sample 1/5: PR #234 (api-service)
#   ├── Findings: 1 ERROR, 3 WARN, 2 INFO
#   ├── [Show findings]
#   ├── [Show code context]
#   │
#   ├── Was this review accurate?       [Yes] [Partially] [No]
#   ├── Were severity levels correct?   [Yes] [Partially] [No]
#   ├── Would you add anything?         [No] [Yes: ___]
#   └── Would you remove anything?      [No] [Yes: ___]
#
#   After all 5 samples:
#   ├── Overall quality score: ___/5
#   ├── Recommendation: [Ship as-is] [Needs tuning] [Needs rewrite]
#   └── Notes: ___
```

This takes 10-15 minutes per persona. Not zero effort, but structured and focused.
The reviewer isn't reading through raw sessions — they're evaluating curated samples
with guided questions.

**The cadence:** Platform team spends 1 hour/month reviewing persona quality.
That's 4 personas × 15 minutes. The structured review tool makes this sustainable.

---

## Test Infrastructure

### CI Pipeline

```yaml
# .github/workflows/agentboot-tests.yml
name: AgentBoot Tests
on:
  push:
    branches: [main]
  pull_request:

jobs:
  unit-and-schema:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: agentboot validate --strict
      - run: agentboot lint --severity error
      - run: npm run test              # vitest unit + integration

  behavioral:
    if: github.event_name == 'pull_request'
    needs: unit-and-schema
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: agentboot test --type behavioral --ci --max-budget 5.00
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

  snapshot:
    if: contains(github.event.pull_request.labels.*.name, 'persona-change')
    needs: behavioral
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: agentboot test --type snapshot --ci
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Test Triggers

| Layer | Trigger | Cost | Time |
|-------|---------|------|------|
| Unit / Schema | Every commit | Free | <10s |
| Integration | Every commit | Free | <30s |
| Behavioral | Every PR | ~$5 | ~2min |
| Snapshot | PRs labeled `persona-change` | ~$5 | ~2min |
| LLM-as-judge | Major changes (manual trigger) | ~$20 | ~5min |
| Human review | Monthly / major release | Staff time | ~1hr |

### Cost Budget

Monthly testing cost for a personas repo with 4 personas:
- Unit/integration: **$0** (no API calls)
- Behavioral: ~20 PRs/month × $5 = **$100/month**
- Snapshot: ~5 persona changes/month × $5 = **$25/month**
- LLM-as-judge: ~2 major changes/month × $20 = **$40/month**
- **Total: ~$165/month** for automated testing

That's less than one developer-hour of manual review — and it runs on every PR.

---

## Testing the Tests

### How Do You Know Your Behavioral Tests Are Good?

**Mutation testing for personas.** Deliberately introduce known bugs into the
persona prompt and verify that tests catch the regression:

```bash
agentboot test --type mutation --persona code-reviewer

#   Mutation Testing: code-reviewer
#   ────────────────────────────────
#
#   Mutation 1: Remove "SQL injection" from review checklist
#     Expected: catches-sql-injection test FAILS
#     Actual:   catches-sql-injection test FAILED ✓ (mutation caught)
#
#   Mutation 2: Change severity threshold (ERROR → INFO)
#     Expected: severity_includes assertion FAILS
#     Actual:   severity_includes assertion FAILED ✓ (mutation caught)
#
#   Mutation 3: Remove output format specification
#     Expected: structured-output-format test FAILS
#     Actual:   structured-output-format test PASSED ✗ (mutation NOT caught)
#     → Your test doesn't verify output structure strictly enough
#
#   Mutation score: 2/3 (67%)
#   → Consider adding stricter output structure assertions
```

This is the "who tests the tests?" answer: mutations verify that tests actually
detect the regressions they're supposed to detect.

---

## Agents Testing Agents

### The Philosophy

AgentBoot personas are AI agents. Testing them with AI (behavioral tests, LLM-as-judge)
is "agents testing agents." This is the right approach because:

1. **The output space is too large for handwritten assertions.** A code review can
   produce thousands of different valid outputs. Pattern matching covers the obvious
   cases; LLM-as-judge evaluates the nuanced ones.

2. **The evaluation criteria are subjective.** "Is this review thorough?" requires
   judgment. LLM-as-judge applies consistent judgment criteria at scale.

3. **The cost is proportional to the value.** Testing a persona costs ~$0.50-$2.00.
   A bad persona wasting $100/day in developer time and false positives costs far more.

### The Safeguard: Humans Always in the Loop

AI-generated test results are **advisory, not authoritative.** The pipeline:

```
Automated tests run → Results posted to PR → Human reviews before merge
```

If behavioral tests pass and snapshot is stable, the human review is fast ("looks
good, ship it"). If something fails, the human investigates. The automation removes
burden, not judgment.

**What humans decide that automation cannot:**
- Is this new finding a genuine improvement or a new false positive?
- Does this persona's tone match the org's culture?
- Is this severity calibration appropriate for our risk tolerance?
- Should we ship this persona change even though a snapshot changed? (sometimes yes)

The test suite produces evidence. Humans make decisions. This is the "humans always
in the loop" principle applied to testing.

---

## What Acme Tests (Org's Responsibility)

When Acme's platform team creates their personas repo from AgentBoot, they inherit
the testing tools but run them on their own content with their own CI and API keys.

### Acme's Test Layers

| Layer | What Acme tests | Tool | Cost to Acme |
|-------|----------------|------|-------------|
| Schema/Lint | Their agentboot.config.json, custom persona frontmatter, custom traits | `agentboot validate`, `agentboot lint` | Free |
| Build | Their personas compile without errors, sync produces expected output | `agentboot build --validate-only` | Free |
| Behavioral | Their custom personas find the bugs they should find | `agentboot test --type behavioral` | ~$5/PR (Acme's API key) |
| Snapshot | Their persona changes don't regress | `agentboot test --type snapshot` | ~$5/change (Acme's API key) |
| Human review | Their personas produce quality output | `agentboot review` | Staff time |

### What Acme's CI Looks Like

```yaml
# In acme-corp/acme-personas/.github/workflows/tests.yml
name: Acme Persona Tests
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: agentboot validate --strict
      - run: agentboot lint --severity error

  behavioral:
    if: github.event_name == 'pull_request'
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: agentboot test --type behavioral --ci --max-budget 10.00
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ACME_ANTHROPIC_KEY }}  # Acme's key, Acme's cost
```

AgentBoot provides the workflow template. Acme fills in their API key and adjusts
the budget. The testing tools are the same; the content and cost are separate.

---

## "Is This My Bug or AgentBoot's Bug?"

When something goes wrong, Acme needs to know: is the problem in their persona
content (their fix) or in AgentBoot's build system (our fix)?

### The Diagnostic: `agentboot doctor --diagnose`

```bash
$ agentboot doctor --diagnose

  Diagnosing: code-reviewer persona producing empty output
  ─────────────────────────────────────────────────────────

  Step 1: Core validation
  ✓ AgentBoot core version 1.2.0 (latest)
  ✓ Core traits compile without errors
  ✓ Core code-reviewer persona compiles without errors
  ✓ Core code-reviewer passes behavioral tests (3/3)
  → Core is healthy. If the problem is in the core code-reviewer,
    it's not reproducing with the default config.

  Step 2: Org layer validation
  ✓ agentboot.config.json valid
  ✓ All custom traits compile
  ✗ Custom extension for code-reviewer has an error:
    extensions/code-reviewer.md references trait "acme-standards"
    which doesn't exist in core/traits/ or Acme's custom traits.
  → LIKELY CAUSE: missing trait reference in Acme's extension

  Step 3: Compiled output check
  ✗ Compiled code-reviewer SKILL.md is 0 bytes
  → Build failed silently due to the missing trait reference

  ═══════════════════════════════════════════════════════

  Diagnosis: ACME CONTENT ISSUE
  The missing trait reference in extensions/code-reviewer.md causes
  the build to produce empty output.

  Fix: Either create core/traits/acme-standards.md or remove the
  reference from extensions/code-reviewer.md

  If you believe this is an AgentBoot bug (the build should NOT produce
  empty output on a missing trait — it should error), file an issue:
  → agentboot issue "Build produces empty output instead of error on missing trait"
```

### The Isolation Test

The doctor runs a **layered isolation test** to pinpoint where the problem is:

```
Layer 1: AgentBoot core only (no org content)
  → Does the core persona work with zero customization?
  → If NO: AgentBoot bug. File an issue.
  → If YES: continue.

Layer 2: Core + org config (no custom personas/traits)
  → Does the core persona work with Acme's agentboot.config.json?
  → If NO: Config issue. Check config.
  → If YES: continue.

Layer 3: Core + org config + org traits
  → Do Acme's custom traits compose without errors?
  → If NO: Trait issue. Check Acme's traits.
  → If YES: continue.

Layer 4: Core + org config + org traits + org personas
  → Do Acme's custom personas compile and lint?
  → If NO: Persona issue. Check Acme's persona definitions.
  → If YES: continue.

Layer 5: Core + org config + org traits + org personas + org extensions
  → Does the full stack work?
  → If NO: Extension issue. Check Acme's extensions.
  → If YES: problem is elsewhere (model, API, environment).
```

Each layer adds one piece. The layer where it breaks is the layer that has the bug.
If Layer 1 breaks, it's AgentBoot's problem. If Layer 3 breaks, it's Acme's traits.

### `agentboot issue` — Streamlined Bug Reporting

When the diagnosis points to an AgentBoot bug, one command files it:

```bash
agentboot issue "Build produces empty output instead of error on missing trait"

#   Filing issue against agentboot/agentboot
#
#   Title: Build produces empty output instead of error on missing trait
#
#   Auto-attached:
#   ├── AgentBoot version: 1.2.0
#   ├── Node version: 22.1.0
#   ├── OS: macOS 15.3
#   ├── Diagnosis output: (attached)
#   ├── agentboot.config.json: (attached, org-specific values redacted)
#   ├── Relevant error logs: (attached)
#   │
#   ├── NOT attached (privacy):
#   │   ├── Org persona content
#   │   ├── Custom trait content
#   │   ├── Developer prompts
#   │   └── Session transcripts
#
#   Open issue in browser? [Y/n]
```

The issue command:
- Attaches environment info and diagnosis output
- Redacts org-specific content (persona text, trait content, internal URLs)
- Includes the config structure (field names and types, not values)
- Never includes developer prompts or session data
- Opens in browser for the user to review before submitting

### When It's Ambiguous

Sometimes the bug is in the boundary — AgentBoot's build system should have caught
an error in Acme's content but didn't. Example: Acme writes a persona with a
circular trait reference. The build system should error; instead it loops forever.

This is an **AgentBoot bug** (the build system should validate and reject) even
though the root cause is in Acme's content (the circular reference). The fix goes
into AgentBoot core (add circular reference detection to validate.ts), and Acme
fixes their content.

The diagnostic output makes this clear:

```
  Diagnosis: AGENTBOOT BUG (validation gap)
  Acme's content has a circular trait reference (A → B → A).
  AgentBoot's validator should catch this but doesn't.

  Workaround: Remove the circular reference in Acme's trait.
  Fix: AgentBoot should add circular reference detection.
  → agentboot issue "Validator doesn't catch circular trait references"
```

### The General Rule

| Symptom | Likely Owner |
|---------|-------------|
| Build system crashes | AgentBoot |
| Build produces wrong file structure | AgentBoot |
| Validator doesn't catch invalid content | AgentBoot |
| Lint rule has false positives/negatives | AgentBoot |
| CLI command doesn't work | AgentBoot |
| Core persona produces bad output | AgentBoot (prompt quality) or Anthropic (model regression) |
| Custom persona produces bad output | Org's persona content |
| Custom trait doesn't compose correctly | Org's trait (unless build system is wrong) |
| Custom extension is ignored | Org's extension path/format (unless sync is broken) |
| Sync writes wrong files | AgentBoot |
| Sync writes right files but persona behaves wrong | Org's persona content |
| Gotcha doesn't activate on matching files | Check `paths:` patterns (org) then check rule loading (AgentBoot) |
| Hook doesn't fire | Check hook config (org) then check hook system (AgentBoot) |
| Plugin doesn't install | Check plugin structure (org) then check export (AgentBoot) |

---

## What AgentBoot Needs to Build

| Component | Phase | Cost |
|-----------|-------|------|
| Unit tests (config, frontmatter, composition, lint) | V1 | Free |
| Integration tests (build pipeline, sync, plugin export) | V1 | Free |
| Test fixtures (valid/invalid personas, known-buggy code) | V1 | Free |
| `agentboot test --type deterministic` runner | V1 | Free |
| CI workflow template | V1 | Free |
| Behavioral test format (YAML) + runner | V1.5 | ~$5/run |
| `agentboot test --type behavioral` with `claude -p` | V1.5 | ~$5/run |
| Snapshot test format + runner | V1.5 | ~$5/run |
| Flake tolerance (2-of-3 runs) | V1.5 | 3x cost |
| LLM-as-judge eval format + runner | V2 | ~$20/run |
| `agentboot review` (human review tool) | V2 | Staff time |
| Mutation testing for personas | V2+ | ~$15/run |
| GitHub Actions reusable workflow for tests | V1.5 | Free |
| `agentboot doctor --diagnose` (layered isolation) | V1 | Free |
| `agentboot issue` (streamlined bug reporting) | V1.5 | Free |
| Org CI workflow template (acme runs on their content) | V1 | Free |

---

*See also:*
- [`docs/prompt-optimization.md`](prompt-optimization.md#6-prompt-testing-agentboot-test) — test types and YAML format
- [`docs/ci-cd-automation.md`](ci-cd-automation.md) — `claude -p` flags for CI
- [`docs/claude-code-reference/feature-inventory.md`](claude-code-reference/feature-inventory.md) — CLI flags
