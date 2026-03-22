# Knowledge Layer — From Flat Files to RAG

How AgentBoot's domain knowledge evolves from markdown files to structured datastores
to vector-powered semantic retrieval as an organization's needs grow.

---

## The Problem That Flat Files Can't Solve

AgentBoot starts with flat files: traits as markdown, gotchas as markdown, persona
prompts as markdown. This works brilliantly up to a point:

| Org Maturity | Knowledge Volume | Flat Files Work? |
|---|---|---|
| Getting started | 6 traits, 10 gotchas, 4 personas | Yes — everything fits in context |
| Growing | 20 traits, 50 gotchas, 10 personas | Mostly — path scoping keeps it manageable |
| Mature | 50 traits, 200 gotchas, 20 personas, 500 ADRs, 1000 incident learnings | **No** — can't load it all, can't find what's relevant |

The breaking point is when the organization's accumulated knowledge exceeds what
fits in a context window — or more practically, when the right knowledge for a given
task is buried in hundreds of files and there's no good way to find it.

A security reviewer looking at an auth endpoint doesn't need all 200 gotchas. It
needs the 5 that are relevant to authentication, JWT tokens, and the specific
framework being used. Flat files with `paths:` frontmatter help (the gotcha activates
when you're in `src/auth/`), but they can't do semantic relevance: "this code is
doing token validation, and we had an incident last year where token expiry was
miscalculated" — that kind of retrieval requires understanding the code's intent,
not just its file path.

---

## The Knowledge Progression

```
Stage 1                 Stage 2                 Stage 3
FLAT FILES              STRUCTURED STORE        VECTOR / RAG
(markdown)              (queryable)             (semantic retrieval)

core/traits/*.md        Knowledge DB            Embeddings
.claude/rules/*.md  →   (SQLite, JSON, or   →   (pgvector, Pinecone,
.claude/gotchas/*.md     structured markdown)     Chroma, local HNSW)

5-50 items              50-500 items            500+ items
Path-scoped             Category/tag queries    Semantic similarity
Full context load       Filtered retrieval      "Find what's relevant
                                                 to THIS code"

Free                    Free (local DB)         $ (embedding API +
                                                  storage)
```

**Most orgs stay at Stage 1 forever.** That's fine. AgentBoot's flat file system
is the right default. The progression to Stage 2 or 3 is opt-in, driven by the
org's actual knowledge volume, not by AgentBoot's architecture preferences.

---

## Stage 1: Flat Files (Current — Default)

What AgentBoot does today. Markdown files loaded into context.

**How personas access knowledge:**
- Always-on instructions loaded at session start
- Path-scoped rules loaded when Claude reads matching files
- Trait content composed at build time
- Skills loaded on invocation

**Strengths:**
- Zero infrastructure (just files)
- Version-controlled in git
- Human-readable and editable
- Composable via AgentBoot's build system

**Limits:**
- Everything that MIGHT be relevant loads into context (token cost)
- No semantic retrieval (can't find "gotchas related to JWT token handling")
- Doesn't scale beyond ~50 rules without context bloat
- No cross-referencing between knowledge items

---

## Stage 2: Structured Knowledge Store

A queryable layer on top of flat files. The files are still the source of truth
(authored in markdown, stored in git), but they're indexed into a structured store
that personas can query.

### What Gets Structured

| Knowledge Type | Flat File | Structured Fields |
|---|---|---|
| **Gotchas** | `gotchas-postgres.md` | `{ technology: "postgres", tags: ["rls", "partitions", "auth"], severity: "high", learned_from: "incident-2025-Q3" }` |
| **ADRs** | `adrs/ADR-001.md` | `{ id: "ADR-001", status: "accepted", domain: "auth", supersedes: null, date: "2026-01" }` |
| **Incident learnings** | `incidents/2025-Q3-token-expiry.md` | `{ id: "INC-2025-Q3-01", domain: "auth", root_cause: "token-expiry", affected_services: ["api-gateway", "auth-service"] }` |
| **Standards** | `standards/api-versioning.md` | `{ domain: "api", applies_to: ["rest", "graphql"], mandatory: true }` |
| **Patterns** | `patterns/retry-with-backoff.md` | `{ category: "resilience", languages: ["typescript", "python"], anti_patterns: ["retry-without-backoff"] }` |

### How Personas Query It

Via an MCP server that reads the structured index:

```yaml
# In persona SKILL.md
## Setup

Before reviewing, query the knowledge base for relevant context:
1. Use the agentboot-kb tool to find gotchas related to the technologies in the diff
2. Use the agentboot-kb tool to find ADRs related to the domains being modified
3. Use the agentboot-kb tool to find incident learnings for the affected services
```

The MCP server:

```json
{
  "mcpServers": {
    "agentboot-kb": {
      "type": "stdio",
      "command": "npx",
      "args": ["@agentboot/knowledge-server", "--store", ".agentboot/knowledge.db"]
    }
  }
}
```

### MCP Tools Exposed

```
agentboot_kb_search
  query: "postgres RLS partitions"
  filters: { technology: "postgres", severity: "high" }
  → Returns: 3 relevant gotchas (not all 200)

agentboot_kb_get
  id: "ADR-001"
  → Returns: full ADR content

agentboot_kb_related
  id: "INC-2025-Q3-01"
  → Returns: related gotchas, ADRs, and patterns

agentboot_kb_list
  type: "gotcha"
  tags: ["auth"]
  → Returns: all auth-related gotchas (titles + IDs, not full content)
```

### How the Index Gets Built

The structured index is generated from flat files during `agentboot build`:

```bash
agentboot build
# Compiles personas, traits...
# Also indexes knowledge files into .agentboot/knowledge.db

agentboot sync
# Syncs personas to repos...
# Also syncs the knowledge DB (or the MCP server config to access it)
```

The flat files gain optional frontmatter for structured fields:

```markdown
---
type: gotcha
technology: postgres
tags: [rls, partitions, security]
severity: high
learned_from: incident-2025-Q3
---

# PostgreSQL RLS on Partitions

Partitions do NOT inherit `relrowsecurity`...
```

Files without frontmatter still work (Stage 1 behavior). The frontmatter adds
queryability without breaking existing content.

### Implementation Options

| Option | Pros | Cons |
|---|---|---|
| **SQLite (local)** | Zero infra, ships with the MCP server, fast | Not shared across machines |
| **JSON index file** | Zero infra, git-trackable, simple | Slow for large datasets |
| **Turso/LibSQL (hosted SQLite)** | Shared, serverless, still SQLite API | Requires account/hosting |
| **PostgreSQL** | Full SQL, mature, team-shared | Requires running DB |

**Recommendation:** SQLite local for V1. It's a single file, ships with the MCP
server, requires zero infrastructure, and handles thousands of knowledge items with
sub-millisecond queries. The MCP server reads the SQLite file; `agentboot build`
writes it.

---

## Stage 3: Vector Embeddings / RAG

Semantic retrieval. Instead of querying by tags and categories (Stage 2), the
persona describes what it's looking at and the knowledge base returns the most
semantically relevant items.

### When You Need This

Stage 2's structured queries work when you know what to ask for: "give me postgres
gotchas." Stage 3 shines when the relevance isn't obvious from tags:

- "This code is doing a double-check on token expiry before refreshing. Is there
  a reason for that?" → Retrieves the incident report about token expiry race
  conditions, even though the code doesn't mention "race condition"
- "This migration adds a new column to the users table" → Retrieves the gotcha
  about ALTER TABLE locking on large tables, the standard about column naming
  conventions, AND the ADR about the users table schema evolution plan
- "This PR changes the retry logic" → Retrieves the retry-with-backoff pattern,
  the incident where retry-without-backoff caused a cascading failure, and the
  circuit breaker ADR

The connection between the code and the knowledge is **semantic**, not
keyword-based. The code says "retry logic"; the incident report says "cascading
failure from unbounded retries." A keyword search wouldn't connect them.
Embeddings would.

### Architecture

```
Knowledge files (markdown)
       │
       ▼
agentboot build --embeddings
       │
       ├── Chunks each file into sections
       ├── Generates embeddings via API (Anthropic, OpenAI, or local model)
       ├── Stores in vector DB
       └── Stores metadata (type, tags, source file, last updated)

       │
       ▼
MCP Server (agentboot-kb with vector search)
       │
       ▼
Persona queries:
  "Find knowledge relevant to this code: [code snippet]"
       │
       ▼
Vector similarity search → top 5 results → injected into persona context
```

### MCP Tools (Extended for Vector)

```
agentboot_kb_semantic_search
  query: "JWT token refresh with expiry validation"
  limit: 5
  min_similarity: 0.7
  → Returns: ranked results by semantic similarity
    1. (0.92) Incident: Token expiry race condition (2025-Q3)
    2. (0.87) Gotcha: JWT clock skew handling
    3. (0.84) Pattern: Token refresh with mutex
    4. (0.78) ADR: Auth token lifecycle management
    5. (0.71) Standard: Session timeout requirements

agentboot_kb_relevant_to_diff
  diff: "<git diff output>"
  limit: 10
  → Returns: knowledge items most relevant to the code changes
    (Embeds the diff, searches against knowledge embeddings)
```

### The Killer Use Case: Context-Aware Review

A code reviewer persona with RAG doesn't just check rules — it brings
organizational memory to every review:

```
Reviewing: src/api/auth/token-refresh.ts

Standard review findings:
  [WARN] Missing error handling on refresh token call (line 34)

Knowledge-augmented findings:
  [WARN] Missing error handling on refresh token call (line 34)

  [CONTEXT] This is similar to INC-2025-Q3-01: our token refresh service
  experienced a cascading failure when the auth provider returned 503 and
  the retry logic had no backoff. The current code has the same pattern.
  See: patterns/retry-with-backoff.md

  [CONTEXT] ADR-007 requires all auth token operations to use the shared
  AuthClient wrapper (src/lib/auth-client.ts) which includes retry,
  circuit breaking, and telemetry. This file is calling the provider
  directly.
```

The persona found things a rule-based review never would — because the connection
between "this code" and "that incident" is semantic, not syntactic.

### Vector Store Options

| Option | Pros | Cons |
|---|---|---|
| **Chroma (local)** | Python, runs locally, simple API | Requires Python runtime |
| **LanceDB (local)** | Rust-based, embedded, no server | Newer, smaller community |
| **SQLite + sqlite-vss** | Extension for SQLite, same DB as Stage 2 | Limited vector ops |
| **pgvector (hosted)** | PostgreSQL extension, full SQL + vectors | Requires running Postgres |
| **Pinecone / Weaviate (cloud)** | Managed, scalable, team-shared | Cost, vendor dependency |
| **Anthropic embeddings API** | Native if using Claude | Per-call cost |

**Recommendation:** Start with sqlite-vss (extends the Stage 2 SQLite DB with vector
search). Zero new infrastructure. When the org outgrows it, migrate to pgvector or
a managed service — the MCP interface doesn't change, only the backing store.

### Embedding Cost

| Content Volume | Embedding Cost (one-time) | Storage |
|---|---|---|
| 100 knowledge items (~200KB) | ~$0.02 | <1MB |
| 1,000 items (~2MB) | ~$0.20 | ~10MB |
| 10,000 items (~20MB) | ~$2.00 | ~100MB |

Re-embedding on content change: only the changed items, not the full corpus.
Incremental updates during `agentboot build`.

---

## What Each Stage Gives Acme-Org

### Stage 1 (Flat Files): "Read the rules"

```
Developer writes auth code
  → Security reviewer loads auth gotchas (path-scoped)
  → Finds: "missing null check" (rule-based)
  → Doesn't know about last year's auth incident
  → Doesn't know about the ADR requiring AuthClient wrapper
```

### Stage 2 (Structured): "Query the knowledge"

```
Developer writes auth code
  → Security reviewer queries: tags=["auth", "token"]
  → Finds: null check gotcha + JWT gotcha + AuthClient standard
  → Knows the rules but not the history
  → Doesn't connect "this code" to "that incident" semantically
```

### Stage 3 (Vector/RAG): "Understand the context"

```
Developer writes auth code
  → Security reviewer embeds the code, searches knowledge base
  → Finds: null check + JWT gotcha + AuthClient standard
          + incident INC-2025-Q3-01 (semantically similar)
          + ADR-007 (related to auth token lifecycle)
  → Review includes: what's wrong, why it matters, what happened
    last time, and what the org decided about it
```

The progression is: **rules → knowledge → organizational memory.**

---

## How AgentBoot Supports Each Stage

### Stage 1 (Current Design — Partially Implemented)

- Flat markdown files in `core/traits/`, `.claude/rules/`, `.claude/gotchas/`
- Path-scoped activation via `paths:` frontmatter
- Build-time composition via `agentboot build`
- No additional infrastructure

### Stage 2 (Needs Building)

| Component | What | Phase |
|---|---|---|
| Knowledge frontmatter spec | Optional fields: type, tags, severity, domain, learned_from | V1.5 |
| `agentboot build --index` | Generate SQLite index from frontmatter | V1.5 |
| `@agentboot/knowledge-server` | MCP server reading SQLite, exposing search/get/related tools | V2 |
| Persona templates with KB queries | Setup steps that query KB before reviewing | V2 |
| `agentboot add incident` / `agentboot add standard` | Scaffold knowledge items with proper frontmatter | V2 |
| Knowledge dashboard | "You have 142 gotchas, 23 ADRs, 8 incident learnings" | V2 |

### Stage 3 (Future)

| Component | What | Phase |
|---|---|---|
| `agentboot build --embeddings` | Generate embeddings + vector index | V3 |
| sqlite-vss integration | Vector search in the existing SQLite DB | V3 |
| `agentboot_kb_semantic_search` MCP tool | Semantic retrieval | V3 |
| `agentboot_kb_relevant_to_diff` MCP tool | Auto-contextualize reviews with relevant knowledge | V3 |
| Incremental embedding updates | Only re-embed changed items | V3 |
| Migration path to pgvector / managed | When SQLite isn't enough | V3+ |

---

## The MCP Interface Stays Stable

The most important architectural decision: **the MCP interface is the same
across all three stages.** Personas don't know (or care) whether the backing
store is flat files, SQLite, or pgvector. They call the same MCP tools:

```
Stage 1: No MCP — files loaded directly into context (path-scoped)
Stage 2: agentboot_kb_search → queries SQLite with filters
Stage 3: agentboot_kb_search → vector similarity + SQLite filters
```

The persona prompt doesn't change when the org upgrades from Stage 2 to Stage 3.
Only the MCP server implementation changes. This is why MCP-first matters — the
abstraction boundary is clean.

An org can start with flat files, graduate to structured queries when they have
100+ knowledge items, and add vector search when they need semantic retrieval.
At no point do they rewrite their personas.

---

## What Kinds of Knowledge Belong Here

Not everything should be in the knowledge layer. The rule: **knowledge that a
persona needs to retrieve at query time goes here. Knowledge that shapes persona
behavior goes in traits and instructions.**

| Content | Where It Belongs | Why |
|---|---|---|
| "Always check for null safety" | **Trait / rule** | Behavioral directive — always active |
| "PostgreSQL partitions don't inherit RLS" | **Gotcha (flat file, Stage 1)** | Path-scoped, activates on relevant files |
| "We had an incident where token refresh caused cascading failure" | **Knowledge store (Stage 2+)** | Historical context, retrieved when relevant |
| "ADR-007: All auth tokens use the AuthClient wrapper" | **Knowledge store (Stage 2+)** | Architectural decision, queried by domain |
| "The retry backoff formula is: delay = base * 2^attempt" | **Knowledge store (Stage 2+)** | Reference data, retrieved when relevant |
| "Our API versioning convention is /v{N}/ in the URL path" | **Standard (flat file or Stage 2)** | Could be a rule or a queryable standard |
| "3,000 customer records with transaction histories for testing" | **Not here** | Test data, not knowledge. Use test-data-expert persona. |

---

## The Honest Assessment

**Most orgs will never need Stage 3.** Vector search is powerful but it's
complexity. An org with 50 gotchas and 10 ADRs doesn't need embeddings — they
need well-organized flat files with good path scoping.

**Stage 2 is the sweet spot for mature orgs.** A structured SQLite index with
tag-based queries handles hundreds of knowledge items with zero infrastructure.
The MCP server is a single `npx` command. This is where the cost/value curve
peaks for most organizations.

**Stage 3 is for orgs where knowledge IS the competitive advantage.** Compliance-
heavy industries (healthcare, finance, government) where the accumulated knowledge
of "what happened, what we decided, and why" is as valuable as the code itself.
For these orgs, a security reviewer that cites last year's incident report is
worth the embedding cost.

AgentBoot should make the progression effortless — but never push orgs up the
ladder faster than they need. Flat files are the right answer for most teams,
most of the time.

---

*See also:*
- [`docs/concepts.md`](concepts.md) — gotchas rules, MCP-first integrations
- [`docs/extending.md`](extending.md) — domain layers and per-persona extensions
- [`docs/third-party-ecosystem.md`](third-party-ecosystem.md) — MCP server as cross-platform bridge
- [`docs/claude-code-reference/feature-inventory.md`](claude-code-reference/feature-inventory.md) — MCP configuration
