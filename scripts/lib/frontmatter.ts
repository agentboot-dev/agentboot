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
