# Name Claiming — Priority Order

**Date:** 2026-03-21

AgentBoot's adoption depends on platform teams and DevEx engineers finding it,
trusting it, and installing it. Name reservations protect the brand and reduce
confusion. Ranked by impact on adoption and risk of losing the name.

---

## Tier 1 — Claim immediately (before npm publish)

| # | Platform | Name | Why | Status |
|---|----------|------|-----|--------|
| 1 | **npm** | `agentboot` | Primary install method. `npx agentboot` is the first command in the README. | Done (v0.1.0 published) |
| 2 | **npm** | `@agentboot` org | Scoped packages if you split into `@agentboot/cli`, `@agentboot/core` later. | Done |
| 3 | **GitHub** | `agentboot-dev` org | Repo home. All links point here. | Done |
| 4 | **Domain** | `agentboot.dev`, `agentboot.io` | Both owned. `.dev` is homepage in package.json. `.io` available as redirect or docs site. | Done |

## Tier 2 — Claim before public announcement

| # | Platform | Name | Why | Status |
|---|----------|------|-----|--------|
| 5 | **PyPI** | `agentboot` | Available now. If you ever ship a Python SDK, MCP server, or CLI wrapper, you'll want this. Low effort to reserve, high regret if squatted. | Available — register placeholder |
| 6 | **Docker Hub** | `agentboot` org | Relevant if you ship an MCP server container or CI images. Free to claim. | Available — create org |
| 7 | **X/Twitter** | `agentboot_dev` | Brand presence. Link from README, announce releases. | Done |
| 8 | **Bluesky** | `agentboot.dev` or `agentboot.bsky.social` | Growing dev community, especially in the Claude/Anthropic ecosystem. If you own agentboot.dev you can use it as your handle (domain-verified). | Check manually |

## Tier 3 — Claim when there's a community to serve

| # | Platform | Name | Why | Status |
|---|----------|------|-----|--------|
| 9 | **Discord** | `agentboot` server | Support channel, community discussion. Not useful until there are users asking questions. Create when you get your first few GitHub issues from strangers. | Available — create when ready |
| 10 | **Reddit** | r/agentboot | Low-effort community presence. Useful for SEO and discoverability. But Reddit communities need active moderation — empty subreddits look bad. | Check manually |

## Tier 4 — Claim only if the roadmap demands it

| # | Platform | Name | Why | Status |
|---|----------|------|-----|--------|
| 11 | **VS Code Marketplace** | `agentboot` publisher | Only if you ship a VS Code extension (Copilot integration, settings UI). Not on the V1 roadmap. | Not checked |
| 12 | **Homebrew** | `agentboot` formula | Formula ready in `docs/internal/homebrew-formula.rb`. See Homebrew setup instructions below. | Ready — create tap repo |
| 13 | **crates.io** | `agentboot` | Only if Rust rewrite. Unlikely. | Not checked |
| 14 | **LinkedIn** | AgentBoot company page | Only useful when there's something to announce. Empty company pages look worse than no page. | Not needed yet |
| 15 | **YouTube** | AgentBoot channel | Tutorials, demos. Effort-intensive content. Only when adoption justifies it. | Not needed yet |

---

## How to Claim

### PyPI (`agentboot`)

```bash
# 1. Create a PyPI account at https://pypi.org/account/register/ (if you don't have one)

# 2. Create a minimal placeholder package
mkdir /tmp/agentboot-pypi && cd /tmp/agentboot-pypi

cat > pyproject.toml << 'PYEOF'
[project]
name = "agentboot"
version = "0.0.1"
description = "Convention over configuration for agentic development teams. Placeholder — see https://github.com/agentboot-dev/agentboot"
license = {text = "Apache-2.0"}
authors = [{name = "Mike Saavedra", email = "mike@agentboot.dev"}]
readme = "README.md"
requires-python = ">=3.8"

[project.urls]
Homepage = "https://agentboot.dev"
Repository = "https://github.com/agentboot-dev/agentboot"
PYEOF

echo "# agentboot\n\nPlaceholder. See https://github.com/agentboot-dev/agentboot" > README.md

# 3. Build and publish
pip install build twine
python -m build
twine upload dist/*
# Enter your PyPI username and password (or API token) when prompted
```

### Docker Hub (`agentboot` org)

1. Log in at https://hub.docker.com
2. Go to https://hub.docker.com/orgs
3. Click "Create Organization"
4. Name: `agentboot`, plan: Free
5. Done — no images needed yet

### Bluesky (`agentboot.dev`)

Since you own `agentboot.dev`, you can use it as a domain-verified handle (stronger than `agentboot.bsky.social`):

1. Create an account at https://bsky.app (use any handle to start)
2. Go to Settings → Change Handle → "I have my own domain"
3. Choose DNS verification:
   - Add a TXT record to `agentboot.dev`:
     - Host: `_atproto`
     - Value: `did=did:plc:<your-did>` (Bluesky shows you the exact value)
4. Click "Verify DNS Record"
5. Your handle is now `@agentboot.dev`

This is the strongest possible Bluesky handle — domain-verified, matches your homepage, and no one else can claim it.

### Homebrew tap (`agentboot-dev/homebrew-agentboot`)

The formula is ready at `docs/internal/homebrew-formula.rb`. To set up the tap:

```bash
# 1. Create the tap repo on GitHub
gh repo create agentboot-dev/homebrew-agentboot --public --description "Homebrew tap for AgentBoot"

# 2. Clone it
gh repo clone agentboot-dev/homebrew-agentboot /tmp/homebrew-agentboot
cd /tmp/homebrew-agentboot

# 3. Copy the formula
mkdir Formula
cp /path/to/agentboot/docs/internal/homebrew-formula.rb Formula/agentboot.rb

# 4. Commit and push
git add Formula/agentboot.rb
git commit -m "feat: add agentboot formula (v0.1.0)"
git push

# 5. Test it
brew tap agentboot-dev/agentboot
brew install agentboot
agentboot --version
```

Users will install with:
```bash
brew install agentboot-dev/agentboot/agentboot
```

When you publish a new npm version, update the formula's `url` and `sha256` fields. This can be automated with a GitHub Action later.

---

## Summary

**10 minutes of work now (Tier 1-2) prevents name-squatting headaches later.** The names that matter most are the ones developers type into a terminal (`npm`, `brew`, `pypi`) and a search engine (`domain`, `twitter`, `bluesky`). Community platforms (Discord, Reddit) can wait until there are people to talk to.
