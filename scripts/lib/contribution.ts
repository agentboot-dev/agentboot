/**
 * AB-151: Marketplace contribution review workflow.
 * Org-specificity detection, contribution validation, and attribution.
 */

import fs from "node:fs";
import path from "node:path";

// L3: the pre-publish scan uses the BUILD-TIME set, not a copy of it. See the
// note above scanComponentForSecrets.
import { DEFAULT_SECRET_PATTERNS } from "./frontmatter.js";

// ---------------------------------------------------------------------------
// Org-Specificity Detection
// ---------------------------------------------------------------------------

export interface OrgSpecificityMatch {
  category: string;
  pattern: string;
  line: number;
  content: string;
}

export interface OrgSpecificityResult {
  matches: OrgSpecificityMatch[];
  passed: boolean;
}

const ORG_SPECIFICITY_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  { category: "internal-domain", pattern: /\b\w+\.(internal|corp|local)\b/i },
  { category: "internal-naming", pattern: /\b(my-company|acme-corp|internal-tool|corp-)\b/i },
  { category: "internal-tool-ref", pattern: /\b(?!(?:CWE|CVE|RFC|ISO|OWASP|NIST|IEEE)-)[A-Z]{2,5}-\d{4,}\b/ },
  { category: "internal-email", pattern: /\b\w+@(?!example\.com|test\.com|gmail\.com|outlook\.com)\w+\.\w{2,}\b/i },
  { category: "internal-infra", pattern: /\b(vpc-[a-f0-9]+|i-[a-f0-9]+|sg-[a-f0-9]+|subnet-[a-f0-9]+)\b/ },
  { category: "internal-url", pattern: /https?:\/\/(?!github\.com|example\.com|agentboot\.dev)[a-z0-9-]+\.(internal|corp|local|intranet)\b/i },
];

export function checkOrgSpecificity(content: string): OrgSpecificityResult {
  const matches: OrgSpecificityMatch[] = [];
  const lines = content.split("\n");
  let inFrontmatter = false;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === 0 && line === "---") { inFrontmatter = true; continue; }
    if (inFrontmatter && line === "---") { inFrontmatter = false; continue; }
    if (inFrontmatter) continue;
    if (line.trim().startsWith("```")) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;
    if (line.trim().startsWith("<!--")) continue;

    for (const { category, pattern } of ORG_SPECIFICITY_PATTERNS) {
      if (pattern.test(line)) {
        if (!matches.some(m => m.line === i + 1 && m.category === category)) {
          matches.push({ category, pattern: pattern.source, line: i + 1, content: line.trim().slice(0, 120) });
        }
      }
    }
  }

  return { matches, passed: matches.length <= 1 };
}

// ---------------------------------------------------------------------------
// Pre-publish validation
// ---------------------------------------------------------------------------

export interface ValidationCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface ValidationResult {
  passed: boolean;
  checks: ValidationCheck[];
}

export function validateContribution(
  componentDir: string,
  options: { layer?: "community" | "verified" } = {}
): ValidationResult {
  const layer = options.layer ?? "community";
  const checks: ValidationCheck[] = [];

  const manifestPath = path.join(componentDir, "manifest.json");
  const hasManifest = fs.existsSync(manifestPath);
  checks.push({ name: "manifest-exists", passed: hasManifest, message: hasManifest ? "manifest.json found" : "Missing manifest.json" });

  const contentFiles = fs.existsSync(componentDir)
    ? fs.readdirSync(componentDir).filter(f => f.endsWith(".md") && f !== "README.md" && f !== "CHANGELOG.md")
    : [];
  checks.push({ name: "content-exists", passed: contentFiles.length > 0, message: contentFiles.length > 0 ? `${contentFiles.length} content file(s)` : "No content files" });

  const read = readComponentManifest(manifestPath);
  const manifest: Record<string, unknown> = read.manifest;
  if (read.error) {
    // "Could not read it" must not be reported as "the field is missing".
    checks.push({ name: "manifest-readable", passed: false, message: read.error });
  }
  const hasLicense = !!manifest["license"];
  const licenseRejected = hasLicense && /GPL|AGPL/i.test(manifest["license"] as string);
  checks.push({ name: "license-valid", passed: hasLicense && !licenseRejected, message: licenseRejected ? `License ${manifest["license"]} rejected` : hasLicense ? `License: ${manifest["license"]}` : "No license" });

  let orgPassed = true;
  const fileContents = new Map<string, string>();
  for (const file of contentFiles) {
    const content = fs.readFileSync(path.join(componentDir, file), "utf-8");
    fileContents.set(file, content);
  }
  // R2-6 sibling: the shared, recursive, all-files scanner. This used to be its
  // own `.md`-only copy with four of the seven patterns.
  const scan = scanComponentForSecrets(componentDir);
  checks.push({
    name: "no-secrets",
    // Zero files scanned is not "no secrets" — it is "nothing was checked".
    passed: scan.hits.length === 0 && scan.scanned.length > 0,
    message:
      scan.hits.length > 0
        ? `Secrets detected in: ${scan.hits.join(", ")}`
        : scan.scanned.length === 0
          ? "No files could be scanned — not evidence the component is clean"
          : `No secrets (${scan.scanned.length} file(s) scanned, recursively)`,
  });

  for (const [, content] of fileContents) {
    if (!checkOrgSpecificity(content).passed) orgPassed = false;
  }
  checks.push({ name: "org-specificity", passed: orgPassed, message: orgPassed ? "No org-specific content" : "Org-specific content detected" });

  if (layer === "verified") {
    const testsDir = path.join(componentDir, "tests");
    const hasBehavioral = fs.existsSync(testsDir) && fs.readdirSync(testsDir).some(f => /\.ya?ml$/.test(f));
    checks.push({ name: "behavioral-test", passed: hasBehavioral, message: hasBehavioral ? "Behavioral test found" : "Required for verified" });
    const hasReadme = fs.existsSync(path.join(componentDir, "README.md"));
    checks.push({ name: "readme-exists", passed: hasReadme, message: hasReadme ? "README.md found" : "Required for verified" });
  }

  return { passed: checks.every(c => c.passed), checks };
}

// ---------------------------------------------------------------------------
// Contributor attribution
// ---------------------------------------------------------------------------

export interface ContributorAttribution {
  handle: string;
  org?: string | undefined;
  profileUrl: string;
  contributedAt: string;
}

export function generateAttribution(handle: string, org?: string): ContributorAttribution {
  return { handle, org, profileUrl: `https://agentboot.dev/u/${handle}`, contributedAt: new Date().toISOString() };
}

/**
 * R2-6 (sibling): ONE pre-publish secret scanner, for both submission paths.
 *
 * `marketplace publish` (cli.ts) and `checkContribution` (here) each carried
 * their own copy, and the two had already drifted: different pattern sets — this
 * one had no PEM-private-key or Stripe-key pattern — and different scopes. Both
 * read `readdirSync(dir)` filtered to `.md`, NON-RECURSIVE, while submission
 * ships the whole component directory. So the two files most likely to carry a
 * credential, a config and anything one directory down, were invisible to both.
 *
 * Two lists that must agree will drift, and these did. One scanner.
 *
 * L3: unifying the two publish copies WITH EACH OTHER left them unified on the
 * weaker of two answers. The seven patterns here were a subset of the build-time
 * set (DEFAULT_SECRET_PATTERNS), missing twelve classes: the label forms
 * (password / api_key / secret / token with a quoted value), the AWS key NAMES,
 * four of the five GitHub token prefixes, three of the five Slack prefixes,
 * Anthropic keys, Google keys, DB URLs with inline credentials, `Bearer`, Azure
 * `AccountKey=`, npm tokens and GitLab PATs.
 *
 * That ordering is backwards. Build time catches a credential inside a repo that
 * already holds it; PUBLISH is the last gate before the same credential is
 * handed to everyone, and it was the weakest gate in the product. There is no
 * second list to keep in step now — the publish path scans with the canonical
 * set, so parity is structural rather than maintained, and
 * tests/secret-parity.test.ts holds a per-pattern canary on both sides so a drop
 * from EITHER one goes red.
 *
 * The earlier note here said the `password[:=]` family was deliberately absent
 * because a persona ABOUT credential handling legitimately contains the word.
 * That risk is real and is already handled in the canonical set, which requires
 * a QUOTED value for the label forms — `password: <your-password>` and prose
 * mentioning api_key stay clean. The rationale did not justify dropping the
 * eleven other classes it was attached to.
 */

export interface SecretScanResult {
  /** Absolute paths actually read. Zero is a FAILURE, not a pass. */
  scanned: string[];
  /** Component-relative paths that matched, or that could not be read. */
  hits: string[];
}

/** Scan every file under `componentDir`, recursively. */
export function scanComponentForSecrets(componentDir: string): SecretScanResult {
  const scanned: string[] = [];
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!e.isFile()) continue;
      let content: string;
      try {
        content = fs.readFileSync(abs, "utf-8");
      } catch {
        // Unreadable is not clean. A file that ships and could not be scanned is
        // exactly the state this check exists to refuse.
        hits.push(`${path.relative(componentDir, abs)} (UNREADABLE — not scanned)`);
        continue;
      }
      scanned.push(abs);
      for (const p of DEFAULT_SECRET_PATTERNS) {
        if (p.test(content)) { hits.push(path.relative(componentDir, abs)); break; }
      }
    }
  };
  if (fs.existsSync(componentDir)) walk(componentDir);
  return { scanned, hits };
}

/**
 * Read a component manifest, distinguishing ABSENT from UNREADABLE.
 *
 * Both submission paths did `try { JSON.parse(...) } catch {}` and then reported
 * "No license in manifest" — which sends the contributor to add a field that is
 * already there, instead of to the syntax error one line above it. Same
 * could-not-read-reported-as-not-present class as the persona config and the
 * MDM fragment.
 */
export function readComponentManifest(
  manifestPath: string,
): { manifest: Record<string, unknown>; error: string | null } {
  if (!fs.existsSync(manifestPath)) return { manifest: {}, error: null };
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { manifest: {}, error: "manifest.json is not a JSON object" };
    }
    return { manifest: parsed as Record<string, unknown>, error: null };
  } catch (err: unknown) {
    return {
      manifest: {},
      error: `manifest.json is present but unreadable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
