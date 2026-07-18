/**
 * Shared frontmatter and secret-scanning utilities.
 *
 * Used by both the validate script and the test suite.
 */

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

// Matches YAML frontmatter blocks. Uses [\s\S]*? (zero or more) so that
// empty frontmatter (---\n---) returns an empty Map rather than null.
// Line endings are normalized to LF before this runs, so it only needs \n.
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

export function parseFrontmatter(content: string): Map<string, string> | null {
  // Tolerate a leading UTF-8 BOM and CRLF / lone-CR line endings. Files checked
  // out on Windows arrive with CRLF (git autocrlf), and some editors prepend a
  // BOM — neither should defeat frontmatter detection. Normalize first so the
  // matcher and the per-line split below only ever deal with LF.
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  const match = FRONTMATTER_RE.exec(normalized);
  if (!match) return null;

  const lines = (match[1] ?? "").split("\n");
  const fields = new Map<string, string>();

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    fields.set(key, value);
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Composition type resolution
// ---------------------------------------------------------------------------

export type CompositionType = "rule" | "preference";

/** Built-in defaults per classification/path pattern. */
const BUILT_IN_DEFAULTS: Record<string, CompositionType> = {
  lexicon: "rule",
  gotcha: "rule",
  persona: "rule",
  "persona-rule": "rule",
  trait: "preference",
  instruction: "preference",
};

/**
 * Resolve the composition type for an artifact.
 *
 * Resolution order (first match wins):
 *   1. Frontmatter `composition` field on the artifact
 *   2. Config `composition.overrides[relativePath]`
 *   3. Config `composition.defaults[classification]`
 *   4. Built-in defaults per classification
 *   5. Path-based inference (rules/, gotchas/, lexicon/ → rule; traits/, instructions/ → preference)
 *   6. Fallback: preference
 */
export function resolveCompositionType(
  relativePath: string,
  frontmatter: Map<string, string> | null,
  configOverrides?: Record<string, CompositionType>,
  configDefaults?: Record<string, CompositionType>
): CompositionType {
  // 1. Frontmatter field
  if (frontmatter) {
    const fm = frontmatter.get("composition");
    if (fm === "rule" || fm === "preference") return fm;
  }

  // 2. Config overrides by path
  if (configOverrides?.[relativePath]) {
    return configOverrides[relativePath]!;
  }

  // 3. Config defaults by classification (infer classification from path)
  const classification = inferClassificationFromPath(relativePath);
  if (classification && configDefaults?.[classification]) {
    return configDefaults[classification]!;
  }

  // 4. Built-in defaults
  if (classification && BUILT_IN_DEFAULTS[classification]) {
    return BUILT_IN_DEFAULTS[classification]!;
  }

  // 5. Path-based inference
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.startsWith("rules/") || normalized.startsWith("gotchas/") || normalized.startsWith("lexicon/")) {
    return "rule";
  }
  if (normalized.startsWith("traits/") || normalized.startsWith("instructions/")) {
    return "preference";
  }

  // 6. Fallback
  return "preference";
}

function inferClassificationFromPath(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.startsWith("lexicon/")) return "lexicon";
  if (normalized.startsWith("traits/")) return "trait";
  if (normalized.startsWith("gotchas/") || normalized.startsWith("rules/")) return "gotcha";
  if (normalized.startsWith("instructions/")) return "instruction";
  if (normalized.startsWith("personas/") || normalized.startsWith("agents/")) return "persona";
  return null;
}

// ---------------------------------------------------------------------------
// Secret scanning
// ---------------------------------------------------------------------------

// Parity contract: defense-in-depth must be strongest at the earliest gate, so every
// bare credential VALUE format that the generated runtime hooks (input-scan/output-scan
// in compile.ts) block must also be caught here at build time. tests/secret-parity.test.ts
// enforces this with canary values — if you add a value-format pattern to a runtime hook,
// add it here (and a canary there) too. Label-style patterns (password=..., api_key=...)
// deliberately require a quoted value at build time to avoid flagging documentation
// placeholders in persona/trait prose; the runtime hooks scan live prompts and can be
// stricter without that false-positive cost.
export const DEFAULT_SECRET_PATTERNS: RegExp[] = [
  /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]+['"]/i,
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]+['"]/i,
  /(?:secret|token)\s*[:=]\s*['"][^'"]+['"]/i,
  /aws[_-]?(?:access[_-]?key|secret[_-]?key)/i,
  /\bAKIA[A-Z0-9]{16}\b/,                       // AWS access key id — bare VALUE format
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/, // JWT (header.payload)
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}/,  // GitHub tokens
  /xox[baprs]-[0-9A-Za-z-]+/,                   // Slack tokens
  /sk-ant-api[a-zA-Z0-9\-_]{20,}/,              // Anthropic API keys
  /sk-[a-zA-Z0-9]{20,}/,                        // OpenAI API keys
  /AIza[a-zA-Z0-9_\-]{35}/,                     // Google API keys
  /(?:mongodb|postgres|postgresql|mysql|redis):\/\/[^\s]+:[^\s]+@/i, // Connection strings with embedded credentials
  /Bearer\s+[A-Za-z0-9._~+/\-]+=*/,            // Bearer tokens
  /DefaultEndpointsProtocol=.*AccountKey=[A-Za-z0-9+/=]{20,}/, // Azure connection strings
  /sk_live_[a-zA-Z0-9]{20,}/,                   // Stripe secret keys
  /npm_[A-Za-z0-9]{36}/,                        // npm tokens
  /glpat-[A-Za-z0-9\-_]{20,}/,                  // GitLab personal access tokens
];

export function scanForSecrets(
  content: string,
  patterns: RegExp[] = DEFAULT_SECRET_PATTERNS
): Array<{ line: number; pattern: string }> {
  const hits: Array<{ line: number; pattern: string }> = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of patterns) {
      if (pattern.test(lines[i]!)) {
        hits.push({ line: i + 1, pattern: pattern.source });
      }
    }
  }

  return hits;
}
