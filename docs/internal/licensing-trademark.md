# Licensing, Trademark & CLA Strategy

**Decision date:** 2026-03-19
**Status:** Partially implemented

---

## License: Apache 2.0

**Chosen over:**

| License | Why not |
|---------|---------|
| MIT | No patent protection. Apache 2.0 adds explicit patent grant that enterprise legal teams appreciate. |
| FSL / BSL | Adoption friction. Not OSI-approved — some enterprise policies have blanket "OSI-only" rules. Developers see "BSL" and think "HashiCorp situation." Some OSS contributors refuse to contribute to non-OSI projects. |
| AGPL | Enterprise legal teams hate it. Creates adoption friction in exactly the orgs we're targeting. |
| Dual license | Premature. Adds complexity before there's revenue to protect. |

**Why Apache 2.0 specifically:**
- Explicit patent grant (MIT lacks this)
- OSI-approved — auto-approved by enterprise "OSI-only" policies
- Compatible with MIT-licensed ecosystem (SuperClaude, ArcKit, spec-kit)
- Zero adoption friction for developers
- Standard in the enterprise OSS world

**What you retain under Apache 2.0:**
- **Copyright** — you own the code you wrote. Forever. The license grants permissions; it doesn't transfer ownership.
- **Trademark** — no one can call their fork "AgentBoot" without permission (see below).
- **First-mover advantage** — you're the canonical source. Forks have to differentiate.
- **Commercial add-ons** — you can sell proprietary features, hosted services, enterprise support, consulting, and training on top of Apache 2.0 core.

**Implemented:**
- [x] `LICENSE` — Apache License 2.0
- [x] `NOTICE` — attribution file (required by Apache 2.0)
- [x] `package.json` — `"license": "Apache-2.0"`
- [x] `README.md` — license section
- [x] All docs updated from MIT to Apache 2.0

---

## Trademark: "AgentBoot"

**Purpose:** Prevent forks from using the "AgentBoot" name. This is how most open-source projects protect their brand (Kubernetes, Docker, Terraform pre-BSL). Anyone can fork the code, but they can't call it "AgentBoot."

**Status:** NOT YET DONE

### How to register

1. **File a trademark application with the USPTO.**
   - Go to https://www.uspto.gov/trademarks/apply
   - Use the TEAS Plus application ($250 per class)
   - Class: **IC 009** (computer software) and/or **IC 042** (SaaS / software development tools)
   - Mark: "AgentBoot" (standard character mark — covers all fonts/styles)
   - Basis: "Use in commerce" (1a) if you've already distributed it publicly, or "Intent to use" (1b) if pre-launch
   - Goods/services description: "Downloadable computer software for managing, compiling, and distributing AI agent behavior configurations for software development teams"

2. **What's covered:** A standard character mark protects the word itself regardless of formatting. One filing for "AgentBoot" covers: `agentboot`, `Agent Boot`, `agent-boot`, `AGENTBOOT`, and similar variations. "agentboot-dev" is technically a distinct mark, but your "AgentBoot" registration gives strong grounds to challenge it as confusingly similar. No separate filing needed for variations.

3. **What's NOT covered:** Sufficiently different names like "BootAgent" or "AgentLaunch" would not be covered.

4. **Timeline:** ~8-12 months for registration. Filing date establishes priority.

5. **Cost:** $250-350 filing fee. No lawyer required for a straightforward word mark, but one review (~$500-1000) reduces risk of office actions.

6. **Alternative:** If USPTO feels heavy, at minimum add a `TRADEMARK` notice to the repo stating that "AgentBoot" is a trademark of Michel Saavedra and may not be used by forks or derivative works without permission. This has less legal weight than registration but establishes intent.

5. **After registration:** Add TM/R symbol to README and docs where appropriate.

---

## CLA: Contributor License Agreement

**Purpose:** Grant you (the project owner) the right to relicense contributor contributions in the future. Without a CLA, every contributor retains copyright on their contributions under Apache 2.0, and changing the license requires consent from every contributor individually.

**Why this matters:** If in 2 years someone launches "AgentBoot Cloud" and you want to add a commercial license for hosted offerings (dual-licensing), the CLA gives you the legal standing to do so without tracking down every contributor.

**Status:** NOT YET DONE — must be implemented before accepting external contributions.

### How to implement

**Option A: CLA Assistant (recommended)**

The most common approach for GitHub-hosted OSS projects.

1. **Choose a CLA template.** The Apache ICLA (Individual Contributor License Agreement) is the standard for Apache 2.0 projects:
   - https://www.apache.org/licenses/icla.pdf
   - Simplified versions: https://contributoragreements.org/

2. **Set up CLA Assistant Lite (GitHub Action):**
   ```yaml
   # .github/workflows/cla.yml
   name: CLA Assistant
   on:
     issue_comment:
       types: [created]
     pull_request_target:
       types: [opened, synchronize, reopened]

   permissions:
     actions: write
     contents: write
     pull-requests: write
     statuses: write

   jobs:
     cla:
       runs-on: ubuntu-latest
       steps:
         - uses: contributor-assistant/github-action@v2
           env:
             GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
           with:
             path-to-signatures: 'signatures/cla.json'
             path-to-document: 'CLA.md'
             branch: 'main'
             allowlist: 'saavyone,dependabot[bot]'
   ```

3. **Create `CLA.md`** in the repo root with the agreement text. Contributors sign by commenting "I have read the CLA Document and I hereby sign the CLA" on their first PR.

4. **Update `CONTRIBUTING.md`** to mention the CLA requirement:
   ```
   ## Contributor License Agreement

   First-time contributors must sign our CLA. When you open your first PR,
   the CLA bot will post a comment with instructions. This is a one-time
   process that takes about 30 seconds.

   The CLA grants the project maintainers the right to relicense your
   contributions. This ensures the project can evolve its licensing if
   needed while your contributions remain attributed to you.
   ```

5. **Signatures are stored** in `signatures/cla.json` in the repo — fully transparent.

**Option B: DCO (Developer Certificate of Origin)**

Lighter weight but weaker. Contributors add a `Signed-off-by:` line to commits (`git commit -s`). This certifies they have the right to contribute but does NOT grant relicensing rights. The Linux kernel uses DCO. **Not recommended for AgentBoot** because it doesn't provide the relicensing flexibility you want.

### Recommendation

Go with **Option A (CLA Assistant)**. Set it up before the first `npm publish` or any public announcement. The friction is minimal (one comment on first PR) and it preserves your ability to evolve the licensing strategy as the project grows.

---

## Pre-Launch Checklist

- [x] Apache 2.0 license in place
- [x] NOTICE file created
- [ ] **Trademark:** File USPTO application or add TRADEMARK notice to repo
- [ ] **CLA:** Create CLA.md, set up GitHub Action, update CONTRIBUTING.md
- [ ] **Then:** Safe to accept external contributions and publish to npm
