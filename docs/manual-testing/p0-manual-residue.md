# P0 manual residue — what a human still has to do

`npx tsx scripts/qa/p0-suite.ts` runs the P0 test plan's scriptable cases. This file
is everything it **cannot** judge. Work through it after a green suite run; a green
suite alone is not a completed P0 pass, and the suite says so on every run.

Budget: about 20 minutes, plus however long you spend reading output like a user.

---

## The count

| | cases | |
|---|---:|---|
| P0 cases in the plan (TP-01, 02, 03, 04, 05, 09) | **61** | |
| scripted — objective pass criteria asserted by the suite | **59** | plus 1 substitute case, `TP-01-PKG`, covering the offline half of TP-01-1/-2 |
| not scriptable at all | **2** | TP-01-1, TP-01-2 — see §1 |
| scripted, but carrying a judgement residue | 9 | §2 — the assertion holds; the *quality* is yours to grade |
| decisions waiting on you | 2 | §3 — two known defects the suite names and does not hide |

Every scripted case has a negative control behind it: `--prove` breaks one thing per
case and requires the case to go red, then reverts it and requires green. Run it if
you want to see the instrument work before you trust it.

---

## 1. Not scriptable — do these by hand

Both need the package to exist on the public registry, so they can only be run
**after** the publish, and they write to your machine. There is nothing to install
before the publish, and installing globally inside a test harness would mutate the
operator's npm prefix and PATH — neither is something a gate should do.

The suite covers the part that *can* be checked offline: `TP-01-PKG` reads
`npm pack --dry-run` and asserts the tarball actually contains `bin/agentboot.js`,
`scripts/cli.ts`, the `core/` inputs and `templates/`, and excludes
`scripts/intelligence/`. That tells you what *would* ship. It cannot tell you that
npm resolves it, links the shim, and puts it on PATH.

- [ ] **TP-01-1 — global install from the registry.**
      `npm install -g agentboot@<version>` then `which agentboot`.
      **Pass:** install exits 0 with no errors, and `which` prints a path.
      **Fail:** any install error, or `which` prints nothing (then check
      `npm config get prefix`/bin is on PATH before filing a bug).

- [ ] **TP-01-2 — npx, with no global install.**
      `npx agentboot@<version> --help`.
      **Pass:** the help text prints and lists `build`, `validate`, `sync`,
      `install`, `doctor`. **Fail:** an error, or no output.

---

## 2. Scripted, but the judgement is yours

The suite proved the structure. These ask whether the thing is any *good* — which is
the half automation cannot reach, and the half that decides whether a first-time user
gets anywhere.

- [ ] **TP-02-1 / TP-02-10 — the interactive install wizard.**
      The suite only ever runs `--non-interactive`, and re-runs `install` with stdin
      closed. Run `agentboot install` in a scratch directory for real.
      **Pass:** it prompts for the org name, the architect-vs-engineer branch does
      what its labels say, and the hub path you type is the path it uses. Then run it
      again in the hub it just made — **pass:** it recognises the hub and does not
      offer to overwrite the config.

- [ ] **TP-02-6 — grade the error messages A–F.**
      `agentboot add persona "My Persona"`, then `agentboot add trait UPPERCASE`.
      The suite asserts a non-zero exit and that the message states the naming rule.
      **Pass:** the message also tells you what to type instead. Anything you would
      grade D or F is worth filing even though the case is green.

- [ ] **TP-02-7 — read `agentboot doctor` as a newcomer.**
      **Pass:** you can tell, from the output alone, which checks are about your
      config and which are about your environment, and any ⚠ line says what to do.

- [ ] **TP-04-10 — JetBrains output quality.**
      Open `dist/jetbrains/core/.junie/AGENTS.md` and one file under
      `.aiassistant/rules/` in an editor. **Pass:** readable Markdown, nothing
      truncated mid-sentence, no Claude-specific `@import` syntax that JetBrains
      will not resolve.

- [ ] **TP-05-7 — is `PERSONAS.md` a usable quick-reference card?**
      Open `dist/claude/core/PERSONAS.md`. The suite checked that all four
      invocations are listed. **Pass:** a developer who has never seen this repo can
      tell from it which persona to invoke and what it does.

- [ ] **TP-09-1 — is the dry-run output trustworthy to read?**
      `agentboot sync --repos-file <file> --dry-run`. The suite proved it writes
      nothing. **Pass:** the summary accurately describes what a real sync would do,
      and the file list is long enough to be useful and short enough to read.

- [ ] **TP-01-6 — a cold `npm install` in a fresh clone.**
      The suite asserts the toolchain resolves in the checkout you already have; it
      does not delete `node_modules` and start over. CI does this on every commit, so
      only run it by hand if you are testing a contributor's first-day experience.

---

## 3. Two decisions, not tests

The suite reports these as **known defects**: the assertion encodes the product's own
documented contract, the product does not meet it, and the register says so out loud
rather than quietly asserting the broken behaviour. Neither reddens the run. Both need
a ruling — fixed, or accepted in writing.

- [ ] **`validate --strict` exits 1, not 2.**
      `docs/cli-reference.md` documents `2 = warnings found (with --strict)`.
      Strict-escalated warnings fall into the generic failure path and exit 1, so
      nothing downstream can distinguish "warnings only" from "hard errors".
      Reproduce: disable a persona that exists in `core/` to raise a WARN, then run
      `agentboot validate --strict; echo $?`.

- [ ] **Compiled Claude subagents carry no provenance header.**
      With `output.provenanceHeaders: true`, `dist/copilot/**/copilot-instructions.md`
      carries the "compiled output — do not edit" block and
      `dist/claude/core/agents/*.md` does not. Cursor's omission is deliberate (its
      `.mdc` output strips HTML comments by design); the Claude agents path simply
      never calls `withProvenance()`. The most-read artifact in the tree ships with no
      trace of where it came from while the config says the control is on.

---

## 4. Outside the P0 subset entirely

Neither the suite nor this checklist touches these. The P0 plan declares them out of
scope, and they remain the areas with the least automated coverage — worth knowing
before you read a green run as "everything was measured":

- LLM-powered commands (`import`, `test --behavioral`, `test --judge`) — need live
  API access and cost money per run.
- Homebrew tap installation.
- GitHub-API sync mode (the suite only exercises filesystem sync).
- MCP server integration against a real client.
- CI/CD workflow behaviour.
- The website (its own plan, TP-14 — P2).

---

## When something here fails

File it. Do **not** edit a case in `scripts/qa/p0-cases.ts` to make the suite agree
with the new behaviour without also adding the register entry that records what the
plan expected, what the product now does, and the evidence the change was deliberate.
A plan and a product that drift apart silently is the condition this whole exercise
exists to end.
