/**
 * AB-151: Marketplace contribution review workflow.
 * Org-specificity detection, contribution validation, and attribution.
 */

import fs from "node:fs";
import path from "node:path";

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
  { category: "internal-tool-ref", pattern: /\b[A-Z]{2,5}-\d{3,}\b/ },
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

  let manifest: Record<string, unknown> = {};
  if (hasManifest) { try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")); } catch {} }
  const hasLicense = !!manifest["license"];
  const licenseRejected = hasLicense && /GPL|AGPL/i.test(manifest["license"] as string);
  checks.push({ name: "license-valid", passed: hasLicense && !licenseRejected, message: licenseRejected ? `License ${manifest["license"]} rejected` : hasLicense ? `License: ${manifest["license"]}` : "No license" });

  let secretsFound = false;
  const secretPatterns = [/AKIA[A-Z0-9]{16}/, /sk-[a-zA-Z0-9]{20,}/, /ghp_[a-zA-Z0-9]{36}/, /xox[bp]-[a-zA-Z0-9-]+/];
  for (const file of contentFiles) {
    const content = fs.readFileSync(path.join(componentDir, file), "utf-8");
    for (const p of secretPatterns) { if (p.test(content)) { secretsFound = true; break; } }
  }
  checks.push({ name: "no-secrets", passed: !secretsFound, message: secretsFound ? "Secrets detected" : "No secrets" });

  let orgPassed = true;
  for (const file of contentFiles) {
    const content = fs.readFileSync(path.join(componentDir, file), "utf-8");
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
