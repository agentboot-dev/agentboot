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
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

export function parseFrontmatter(content: string): Map<string, string> | null {
  const match = FRONTMATTER_RE.exec(content);
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

export const DEFAULT_SECRET_PATTERNS: RegExp[] = [
  /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]+['"]/i,
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]+['"]/i,
  /(?:secret|token)\s*[:=]\s*['"][^'"]+['"]/i,
  /aws[_-]?(?:access[_-]?key|secret[_-]?key)/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}/,  // GitHub tokens
  /xox[baprs]-[0-9A-Za-z-]+/,                   // Slack tokens
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
