# Regression Plan — Manual Testing

Run before each release. Each scenario is in Gherkin format with copy-paste
commands embedded in the steps. Run the commands, verify the output matches.

Scenarios marked **CRITICAL** cannot be fully automated because they:
- Require running outside the repo context (external cwd, path substitution)
- Involve multi-step stateful operations where interrupted cleanup corrupts state
- Verify safety behaviors that protect user data (hash checks, dry-run, no-overwrite)
- Depend on environment-specific conditions (installed tools, filesystem layout)

These MUST be run by a human before every release. Non-CRITICAL scenarios are
covered by the automated suite (`npx vitest run`) and are included here as a
secondary verification layer.

Prerequisite for all scenarios:

```bash
cd /path/to/agentboot
npm install
```

---

## Feature: CLI entry point

### Scenario: Version output matches package.json

```gherkin
Given the agentboot repo is checked out
When the user runs the CLI with --version
Then the output matches the version in package.json
```

```bash
# When
npx tsx scripts/cli.ts --version

# Then — compare with:
node -p "require('./package.json').version"
# Both outputs must be identical
```

### Scenario: Help lists all Phase 2 commands

```gherkin
Given the agentboot repo is checked out
When the user runs the CLI with --help
Then the output lists all implemented commands
```

```bash
# When + Then
npx tsx scripts/cli.ts --help | grep -E "build|validate|sync|setup|add|doctor|status|lint|uninstall|config"
# Expected: all 10 commands appear (one per line)
```

---

## Feature: Full build pipeline

### Scenario: Clean build completes without errors

```gherkin
Given dist/ does not exist
When the user runs dev-build
Then validate passes all 4 checks
And compile produces output for 3 platforms
And dev-sync copies files to .claude/
And the exit code is 0
```

```bash
# Given
rm -rf dist/

# When
npx tsx scripts/cli.ts dev-build

# Then — verify output contains:
#   "All 4 checks passed"
#   "Compiled 4 persona(s) × 3 platform(s)"
#   "Dev-synced N files across 3 platforms"
#   "dev-build complete"
```

### Scenario: Build output has correct structure

```gherkin
Given a dev-build has completed
When the user inspects dist/
Then each platform has a core/ directory
And claude has skills/, agents/, traits/, rules/
And skill and copilot have persona directories
```

```bash
# When + Then
ls dist/skill/core/
# Expected: code-reviewer/ security-reviewer/ test-data-expert/ test-generator/ instructions/ PERSONAS.md

ls dist/claude/core/
# Expected: agents/ skills/ traits/ rules/ CLAUDE.md PERSONAS.md

ls dist/copilot/core/
# Expected: code-reviewer/ security-reviewer/ test-data-expert/ test-generator/ instructions/ PERSONAS.md
```

---

## Feature: CC-native skill output (AB-18)

### Scenario: Skills have context:fork frontmatter

```gherkin
Given a dev-build has completed
When the user reads a compiled CC skill file
Then the frontmatter contains context: fork
And the frontmatter contains a quoted agent reference
And the description is quoted
And there is exactly one frontmatter block
```

```bash
# When + Then
head -6 dist/claude/core/skills/review-code/SKILL.md
# Expected:
#   ---
#   description: "Senior code reviewer — finds real bugs, not style nits"
#   context: fork
#   agent: "code-reviewer"
#   ---

# Verify all 4 skills:
for skill in review-code review-security gen-tests gen-testdata; do
  echo "=== $skill ==="
  head -6 "dist/claude/core/skills/$skill/SKILL.md"
  echo
done
# Each must have: description: "...", context: fork, agent: "..."
```

---

## Feature: CLAUDE.md with @imports (AB-19 + AB-77)

### Scenario: CLAUDE.md has correct imports and welcome fragment

```gherkin
Given a dev-build has completed
When the user reads dist/claude/core/CLAUDE.md
Then it contains @import directives for all 6 traits
And instruction imports do NOT have double .md.md extension
And it contains an Available Personas section with all 4 invocations
```

```bash
# When
cat dist/claude/core/CLAUDE.md

# Then — verify:
grep '@.claude/traits/' dist/claude/core/CLAUDE.md | wc -l
# Expected: 6

grep '@.claude/rules/' dist/claude/core/CLAUDE.md
# Expected exactly:
#   @.claude/rules/baseline.instructions.md
#   @.claude/rules/security.instructions.md
# NOT: @.claude/rules/baseline.instructions.md.md

grep -c '.md.md' dist/claude/core/CLAUDE.md
# Expected: 0

grep '/review-code' dist/claude/core/CLAUDE.md
grep '/review-security' dist/claude/core/CLAUDE.md
grep '/gen-tests' dist/claude/core/CLAUDE.md
grep '/gen-testdata' dist/claude/core/CLAUDE.md
# All 4 must match
```

---

## Feature: Agent output (AB-17)

### Scenario: Agent files have quoted YAML frontmatter

```gherkin
Given a dev-build has completed
When the user reads a compiled agent file
Then name and description are double-quoted in YAML
And model is only present if explicitly configured
```

```bash
# When + Then
head -4 dist/claude/core/agents/code-reviewer.md
# Expected:
#   ---
#   name: "code-reviewer"
#   description: "Senior code reviewer — finds real bugs, not style nits"
#   ---

# Verify no unquoted names across all agents:
for agent in code-reviewer security-reviewer test-generator test-data-expert; do
  head -4 "dist/claude/core/agents/${agent}.md"
  echo "---"
done
# Every name: and description: value must be wrapped in double quotes
```

---

## Feature: Setup wizard (AB-33)

### Scenario: Setup scaffolds a new project — CRITICAL

> Cannot be fully automated: requires running outside the repo context with
> manual path substitution. Verifies the first-run experience for new users.

```gherkin
Given a fresh empty directory
When the user runs agentboot setup
Then agentboot.config.json is created with valid JSON
And repos.json is created as an empty array
And core/ directory structure is created
```

```bash
# Given
export TESTDIR=$(mktemp -d)

# When
npx tsx scripts/cli.ts setup --skip-detect 2>&1
# (run from the temp dir — cd or pass cwd)
cd "$TESTDIR" && npx tsx /path/to/agentboot/scripts/cli.ts setup --skip-detect

# Then
cat "$TESTDIR/agentboot.config.json" | python3 -m json.tool > /dev/null && echo "Valid JSON"
cat "$TESTDIR/repos.json"
# Expected: []

ls "$TESTDIR/core/"
# Expected: gotchas/ instructions/ personas/ traits/

# Cleanup
rm -rf "$TESTDIR"
```

### Scenario: Setup does not overwrite existing config — CRITICAL

> Cannot be fully automated: verifies safety behavior (no-overwrite) in an
> external directory. A bug here silently destroys user configuration.

```gherkin
Given a directory with an existing agentboot.config.json
When the user runs agentboot setup
Then the existing config is not overwritten
And a warning is printed
```

```bash
export TESTDIR=$(mktemp -d)
echo '{"org":"do-not-overwrite"}' > "$TESTDIR/agentboot.config.json"

cd "$TESTDIR" && npx tsx /path/to/agentboot/scripts/cli.ts setup
# Expected output contains: "already exists"

cat "$TESTDIR/agentboot.config.json"
# Expected: {"org":"do-not-overwrite"}

rm -rf "$TESTDIR"
```

---

## Feature: Add scaffolding (AB-34/35)

### Scenario: Add persona creates correct files

```gherkin
Given the agentboot repo is checked out
When the user runs add persona test-regression
Then core/personas/test-regression/SKILL.md is created
And core/personas/test-regression/persona.config.json is created
And SKILL.md has trait injection markers
And SKILL.md has all 5 style guide sections
And persona.config.json has invocation "/test-regression"
```

```bash
# When
npx tsx scripts/cli.ts add persona test-regression

# Then
cat core/personas/test-regression/SKILL.md | head -10
# Expected: frontmatter with name: test-regression

grep 'traits:start' core/personas/test-regression/SKILL.md
grep 'traits:end' core/personas/test-regression/SKILL.md
# Both must match

grep '## Identity' core/personas/test-regression/SKILL.md
grep '## Setup' core/personas/test-regression/SKILL.md
grep '## Rules' core/personas/test-regression/SKILL.md
grep '## Output Format' core/personas/test-regression/SKILL.md
grep '## What Not To Do' core/personas/test-regression/SKILL.md
# All 5 must match

cat core/personas/test-regression/persona.config.json | python3 -m json.tool
# Expected: invocation is "/test-regression", traits is []

# Cleanup
rm -rf core/personas/test-regression
```

### Scenario: Add rejects invalid names

```gherkin
Given the agentboot repo is checked out
When the user runs add persona with an invalid name
Then the command exits non-zero
And an error message is printed
```

```bash
npx tsx scripts/cli.ts add persona UPPERCASE 2>&1; echo "exit: $?"
# Expected: error message + exit: 1

npx tsx scripts/cli.ts add persona 1starts-with-digit 2>&1; echo "exit: $?"
# Expected: error message + exit: 1

npx tsx scripts/cli.ts add persona has_underscore 2>&1; echo "exit: $?"
# Expected: error message + exit: 1
```

### Scenario: Add trait creates correct file

```gherkin
Given the agentboot repo is checked out
When the user runs add trait test-trait
Then core/traits/test-trait.md is created
And it has When to Apply, What to Do, What Not to Do sections
```

```bash
npx tsx scripts/cli.ts add trait test-trait
cat core/traits/test-trait.md
# Expected: has ## When to Apply, ## What to Do, ## What Not to Do

rm core/traits/test-trait.md
```

---

## Feature: Doctor (AB-36)

### Scenario: Doctor passes on healthy project

```gherkin
Given the agentboot repo is checked out and built
When the user runs doctor
Then all checks pass
And the exit code is 0
```

```bash
npx tsx scripts/cli.ts doctor; echo "exit: $?"
# Expected output contains:
#   ✓ Node.js
#   ✓ git
#   ✓ agentboot.config.json found
#   ✓ Config parses successfully
#   ✓ All 4 enabled personas found
#   ✓ All 6 enabled traits found
#   ✓ repos.json found
#   ✓ dist/ exists
#   All checks passed
#   exit: 0
```

---

## Feature: Status (AB-37)

### Scenario: Status shows project info

```gherkin
Given the agentboot repo is checked out
When the user runs status
Then it shows the org name, version, personas, traits, and platforms
```

```bash
npx tsx scripts/cli.ts status
# Expected output contains:
#   Org:       Your Organization
#   Version:   0.1.0
#   Personas:  4 enabled
#   Traits:    6 enabled
#   Platforms: skill, claude, copilot
```

### Scenario: Status JSON output is parseable

```gherkin
Given the agentboot repo is checked out
When the user runs status with --format json
Then the output is valid JSON with org, personas, and repos fields
```

```bash
npx tsx scripts/cli.ts status --format json | python3 -m json.tool > /dev/null && echo "Valid JSON"
npx tsx scripts/cli.ts status --format json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['org'], len(d['personas']), 'personas')"
# Expected: your-org 4 personas
```

---

## Feature: Lint (AB-38)

### Scenario: Lint reports trait length warnings

```gherkin
Given the agentboot repo is checked out
When the user runs lint
Then it reports trait-too-long warnings for traits exceeding 100 lines
```

```bash
npx tsx scripts/cli.ts lint
# Expected: shows "trait-too-long" WARN for multiple traits
```

### Scenario: Lint JSON output has no header

```gherkin
Given the agentboot repo is checked out
When the user runs lint with --format json
Then the output starts with [ (valid JSON array, no header text)
```

```bash
npx tsx scripts/cli.ts lint --format json --severity warn | head -c 1
# Expected: [   (first character is opening bracket)

npx tsx scripts/cli.ts lint --format json --severity warn | python3 -m json.tool > /dev/null && echo "Valid JSON"
```

### Scenario: Lint severity filtering works

```gherkin
Given the agentboot repo is checked out
When the user runs lint with --severity error
Then only ERROR findings are shown (no WARN)
```

```bash
npx tsx scripts/cli.ts lint --severity error
# Expected: either "No issues found" or only ERROR-level findings (no WARN lines)
```

---

## Feature: Sync and uninstall (AB-15 + AB-45)

### Scenario: Sync to target repo then uninstall cleanly — CRITICAL

> Cannot be fully automated: mutates repos.json in the live project. If
> interrupted, repos.json is corrupted. Multi-step stateful flow where each
> step depends on the previous. The only way to verify "clean removal" end-to-end.

```gherkin
Given a fresh temporary directory as sync target
And repos.json points to that directory
When the user runs sync
Then .claude/ is created with skills, rules, agents, traits
And .agentboot-manifest.json is created with SHA-256 hashes
When the user runs uninstall on that directory
Then all synced files are removed
And .agentboot-manifest.json is removed
And no files remain in .claude/
```

```bash
# Given
export SYNC_TARGET=$(mktemp -d)
cp repos.json repos.json.bak
echo "[{\"path\":\"$SYNC_TARGET\",\"label\":\"regression-test\",\"platform\":\"claude\"}]" > repos.json

# When (sync)
npx tsx scripts/cli.ts sync
# Expected: "Synced 1 repo"

# Then (verify sync)
ls "$SYNC_TARGET/.claude/skills/"
# Expected: gen-testdata/ gen-tests/ review-code/ review-security/

cat "$SYNC_TARGET/.claude/.agentboot-manifest.json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['files']), 'files tracked')"
# Expected: N files tracked (N > 10)

# When (uninstall)
npx tsx scripts/cli.ts uninstall --repo "$SYNC_TARGET"
# Expected: "removed" lines for each file

# Then (verify clean)
ls "$SYNC_TARGET/.claude/" 2>&1
# Expected: error or empty directory

test -f "$SYNC_TARGET/.claude/.agentboot-manifest.json" && echo "FAIL: manifest still exists" || echo "PASS: manifest removed"

# Cleanup
mv repos.json.bak repos.json
rm -rf "$SYNC_TARGET"
```

### Scenario: Uninstall skips modified files — CRITICAL

> Cannot be fully automated: verifies the safety invariant that user-modified
> files are never deleted. A regression here causes data loss. Requires human
> verification that the specific modified file survives while others are removed.

```gherkin
Given a synced target directory
When one file is manually modified
And the user runs uninstall
Then the modified file is skipped with a warning
And unmodified files are removed
```

```bash
export SYNC_TARGET=$(mktemp -d)
cp repos.json repos.json.bak
echo "[{\"path\":\"$SYNC_TARGET\",\"label\":\"mod-test\",\"platform\":\"claude\"}]" > repos.json

npx tsx scripts/cli.ts sync

# Modify one file
echo "<!-- manually edited -->" >> "$SYNC_TARGET/.claude/skills/review-code/SKILL.md"

npx tsx scripts/cli.ts uninstall --repo "$SYNC_TARGET"
# Expected output: "modified .claude/skills/review-code/SKILL.md (hash mismatch — skipping)"

test -f "$SYNC_TARGET/.claude/skills/review-code/SKILL.md" && echo "PASS: modified file preserved" || echo "FAIL: modified file was deleted"

mv repos.json.bak repos.json
rm -rf "$SYNC_TARGET"
```

### Scenario: Uninstall dry-run removes nothing — CRITICAL

> Cannot be fully automated: verifies the no-damage guarantee of dry-run mode.
> A regression here means `--dry-run` silently deletes files. Requires human
> verification that zero filesystem mutations occur.

```gherkin
Given a synced target directory
When the user runs uninstall with --dry-run
Then no files are actually removed
And the output says "would remove"
```

```bash
export SYNC_TARGET=$(mktemp -d)
cp repos.json repos.json.bak
echo "[{\"path\":\"$SYNC_TARGET\",\"label\":\"dry-test\",\"platform\":\"claude\"}]" > repos.json

npx tsx scripts/cli.ts sync
npx tsx scripts/cli.ts uninstall --repo "$SYNC_TARGET" --dry-run
# Expected: "would remove" (not "removed")

test -f "$SYNC_TARGET/.claude/skills/review-code/SKILL.md" && echo "PASS: files still exist" || echo "FAIL: files were removed"

mv repos.json.bak repos.json
rm -rf "$SYNC_TARGET"
```

---

## Feature: Scope merging (AB-16)

### Scenario: Team overrides group overrides core — CRITICAL

> Cannot be fully automated: creates temporary scope override files in dist/
> and mutates repos.json. Scope merging is a core differentiator — the content
> of the winning file must be human-verified, not just its existence. Interrupted
> cleanup leaves orphan directories in dist/.

```gherkin
Given dist/ has core, group, and team skill overrides for the same file
And repos.json has a repo with group and team scope
When the user runs sync
Then the team-level file wins in the target repo
```

```bash
# Given — create scope overrides in dist/
mkdir -p dist/claude/groups/platform/skills/review-code
echo -e "---\ndescription: group\n---\n\n# Group Override" > dist/claude/groups/platform/skills/review-code/SKILL.md

mkdir -p dist/claude/teams/platform/api/skills/review-code
echo -e "---\ndescription: team\n---\n\n# Team Override" > dist/claude/teams/platform/api/skills/review-code/SKILL.md

export SYNC_TARGET=$(mktemp -d)
cp repos.json repos.json.bak
echo "[{\"path\":\"$SYNC_TARGET\",\"label\":\"scope-test\",\"platform\":\"claude\",\"group\":\"platform\",\"team\":\"api\"}]" > repos.json

# When
npx tsx scripts/cli.ts sync

# Then
grep "Team Override" "$SYNC_TARGET/.claude/skills/review-code/SKILL.md" && echo "PASS: team wins" || echo "FAIL: team did not win"
grep "Group Override" "$SYNC_TARGET/.claude/skills/review-code/SKILL.md" && echo "FAIL: group should not be present" || echo "PASS: group overridden"

# Cleanup
mv repos.json.bak repos.json
rm -rf "$SYNC_TARGET" dist/claude/groups dist/claude/teams
```

---

## Feature: Gotchas compilation (AB-52)

### Scenario: Gotcha file compiles to rules output

```gherkin
Given a gotcha file exists in core/gotchas/
When the user runs build
Then the gotcha appears in dist/claude/core/rules/
And the gotcha appears in dist/skill/core/gotchas/
And README.md is not compiled
```

```bash
# Given
cat > core/gotchas/regression-gotcha.md << 'EOF'
---
paths:
  - "**/*.test.ts"
---

# Regression Gotcha

- Always check for flaky assertions
EOF

# When
npx tsx scripts/cli.ts build

# Then
test -f dist/claude/core/rules/regression-gotcha.md && echo "PASS: in claude rules" || echo "FAIL"
test -f dist/skill/core/gotchas/regression-gotcha.md && echo "PASS: in skill gotchas" || echo "FAIL"
test -f dist/claude/core/rules/README.md && echo "FAIL: README compiled" || echo "PASS: README filtered"

# Cleanup
rm core/gotchas/regression-gotcha.md
rm -f dist/claude/core/rules/regression-gotcha.md dist/skill/core/gotchas/regression-gotcha.md
```

---

## Feature: Config command

### Scenario: Read top-level and nested config values

```gherkin
Given the agentboot repo is checked out
When the user runs config with a valid key
Then the value is printed
When the user runs config with a nested key
Then the nested value is printed as JSON
When the user runs config with an invalid key
Then exit code is 1
```

```bash
npx tsx scripts/cli.ts config org
# Expected: your-org

npx tsx scripts/cli.ts config personas.enabled
# Expected: JSON array with 4 persona names

npx tsx scripts/cli.ts config nonexistent 2>&1; echo "exit: $?"
# Expected: "Key not found" + exit: 1
```

---

## Feature: Automated test suite

### Scenario: All automated tests pass

```gherkin
Given the agentboot repo is checked out with dependencies installed
When the user runs the test suite
Then all tests pass
And the test count is at least 100
```

```bash
npx vitest run
# Expected:
#   Test Files  3 passed (3)
#   Tests  107 passed (107)
#   (or higher — never lower)
```
