/**
 * Band D1: org-scale import with cross-repo dedup.
 *
 * The measured adopter pain: identical boilerplate living in 16+ repos. A
 * multi-repo import sweep must converge shared content onto ONE promoted org
 * artifact carrying provenance from every contributing repo — never a silent
 * last-repo-wins overwrite — while repo-specific residuals import normally.
 *
 * ACCEPTANCE: two repos sharing a verbatim block yield one org artifact with
 * provenance from both.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  scanRepoDirs,
  categorizeByStrategy,
  processWholeFileImports,
  applyWholeFileImports,
  applyPlan,
  computeCrossRepoPromotions,
  repoNameForSource,
  mergeIntoExistingArtifact,
  type WholeFileImport,
  type Classification,
} from "../scripts/lib/import.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-d1-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(baseDir: string, relPath: string, content: string): string {
  const abs = path.join(baseDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
  return abs;
}

function scaffoldHub(hubPath: string): void {
  fs.mkdirSync(hubPath, { recursive: true });
  writeFile(hubPath, "agentboot.config.json", JSON.stringify({ org: "d1-test" }));
  for (const dir of ["core/traits", "core/gotchas", "core/instructions", "core/personas"]) {
    fs.mkdirSync(path.join(hubPath, dir), { recursive: true });
  }
}

const SHARED_TRAIT = [
  "---",
  "type: trait",
  "---",
  "",
  "## Logging",
  "Use log4j2, never logback — the shared appender config assumes log4j2.",
  "",
].join("\n");

describe("D1 ACCEPTANCE: two repos sharing a verbatim block → one org artifact, both sources", () => {
  it("whole-file sweep promotes one trait with provenance from both repos", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);
    const repoA = path.join(tmpDir, "repo-alpha");
    const repoB = path.join(tmpDir, "repo-beta");
    writeFile(repoA, ".claude/traits/logging.md", SHARED_TRAIT);
    writeFile(repoB, ".claude/traits/logging.md", SHARED_TRAIT);

    const manifest = scanRepoDirs([repoA, repoB]);
    expect(manifest.files).toHaveLength(2);

    const categorized = categorizeByStrategy(manifest);
    const imports = processWholeFileImports(categorized.wholeFile, hubPath);
    expect(imports).toHaveLength(2);

    // Plan is honest: first is a create, second is a cross-repo merge
    const actions = imports.map(i => i.action).sort();
    expect(actions).toEqual(["create", "merge"]);

    // The promotion is visible in the plan
    const promotions = computeCrossRepoPromotions(imports);
    expect(promotions).toHaveLength(1);
    expect(promotions[0]!.target_path).toBe("core/traits/logging.md");
    expect(promotions[0]!.repos).toEqual(["repo-alpha", "repo-beta"]);

    const result = applyWholeFileImports(imports, hubPath, new Set(manifest.files.map(f => f.absolutePath)));
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1); // duplicate content — provenance-only
    expect(result.errors).toHaveLength(0);

    // Exactly ONE artifact, carrying provenance from BOTH repos
    const artifactPath = path.join(hubPath, "core/traits/logging.md");
    const artifact = fs.readFileSync(artifactPath, "utf-8");
    expect(artifact).toContain("source: repo-alpha");
    expect(artifact).toContain("additional_sources: repo-beta");
    // Content appears exactly once — no duplication
    expect(artifact.match(/never logback/g)).toHaveLength(1);
  });
});

describe("D1: no silent overwrite anywhere", () => {
  it("second repo with DISTINCT content under the same slug merges (both blocks survive)", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);
    const repoA = path.join(tmpDir, "repo-alpha");
    const repoB = path.join(tmpDir, "repo-beta");
    writeFile(repoA, ".claude/traits/logging.md", SHARED_TRAIT);
    writeFile(repoB, ".claude/traits/logging.md",
      "## Logging\nServices migrated after 2026 use structured JSON logs via slog.\n");

    const manifest = scanRepoDirs([repoA, repoB]);
    const imports = processWholeFileImports(categorizeByStrategy(manifest).wholeFile, hubPath);
    const result = applyWholeFileImports(imports, hubPath, new Set(manifest.files.map(f => f.absolutePath)));

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    const artifact = fs.readFileSync(path.join(hubPath, "core/traits/logging.md"), "utf-8");
    // BOTH repos' content survives — the pre-D1 behavior kept only repo-beta's
    expect(artifact).toContain("never logback");
    expect(artifact).toContain("structured JSON logs");
    expect(artifact).toContain("source: repo-alpha");
    expect(artifact).toContain("additional_sources: repo-beta");
  });

  it("classification path: two 'create' actions targeting the same artifact converge with both sources", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);
    const repoA = path.join(tmpDir, "repo-alpha");
    const repoB = path.join(tmpDir, "repo-beta");
    const srcA = writeFile(repoA, ".claude/CLAUDE.md", "## Conventions\nAlways run make lint before pushing.\n");
    const srcB = writeFile(repoB, ".claude/CLAUDE.md", "## Conventions\nAlways run make lint before pushing.\n");

    const mkClassification = (src: string): Classification => ({
      source_file: src,
      lines: [1, 2],
      content_preview: "Conventions",
      classification: "gotcha",
      suggested_name: "lint-before-push",
      suggested_path: "core/gotchas/lint-before-push.md",
      overlaps_with: null,
      confidence: "high",
      action: "create",
      composition_type: "rule",
    });

    const result = applyPlan(
      { hub: hubPath, scanned_at: "t", classifications: [mkClassification(srcA), mkClassification(srcB)] } as never,
      hubPath,
      new Set([srcA, srcB]),
    );

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1); // duplicate content — source recorded, nothing overwritten
    const artifact = fs.readFileSync(path.join(hubPath, "core/gotchas/lint-before-push.md"), "utf-8");
    expect(artifact).toContain("source: repo-alpha");
    expect(artifact).toContain("additional_sources: repo-beta");
    expect(artifact.match(/make lint/g)).toHaveLength(1);
  });

  it("hub-duplicate skips still record the contributing repo when content matches", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);
    // Artifact already promoted in the hub (e.g. from an earlier sweep)
    writeFile(hubPath, "core/traits/logging.md",
      "---\ntype: trait\nsource: repo-alpha\n---\n\n## Logging\nUse log4j2, never logback — the shared appender config assumes log4j2.\n");
    const repoC = path.join(tmpDir, "repo-gamma");
    const src = writeFile(repoC, ".claude/traits/logging.md", SHARED_TRAIT);

    const imports: WholeFileImport[] = [{
      source_file: src,
      import_type: "trait",
      target_path: "core/traits/logging.md",
      generates: [],
      action: "skip",
      composition_type: "preference",
      duplicate_of: "core/traits/logging.md",
      confidence: "high",
    }];

    const result = applyWholeFileImports(imports, hubPath, new Set([src]));
    expect(result.skipped).toBe(1);
    const artifact = fs.readFileSync(path.join(hubPath, "core/traits/logging.md"), "utf-8");
    expect(artifact).toContain("additional_sources: repo-gamma");
    expect(artifact.match(/never logback/g)).toHaveLength(1);
  });
});

describe("D1: helpers", () => {
  it("repoNameForSource strips platform config dirs and top-level skills layout", () => {
    expect(repoNameForSource("/x/my-repo/.claude/traits/a.md")).toBe("my-repo");
    expect(repoNameForSource("/x/my-repo/CLAUDE.md")).toBe("my-repo");
    expect(repoNameForSource("/x/my-repo/.github/copilot-instructions.md")).toBe("my-repo");
    expect(repoNameForSource("/x/my-repo/skills/foo/SKILL.md")).toBe("my-repo");
    expect(repoNameForSource("/x/my-repo/.cursorrules")).toBe("my-repo");
  });

  it("mergeIntoExistingArtifact is idempotent for duplicate content", () => {
    const dest = writeFile(tmpDir, "artifact.md",
      "---\nsource: repo-alpha\n---\n\nUse log4j2, never logback.\n");
    expect(mergeIntoExistingArtifact(dest, "Use log4j2,   never logback.", "repo-beta")).toBe("duplicate");
    const after1 = fs.readFileSync(dest, "utf-8");
    expect(after1).toContain("additional_sources: repo-beta");
    // Re-running changes nothing further
    expect(mergeIntoExistingArtifact(dest, "Use log4j2, never logback.", "repo-beta")).toBe("duplicate");
    expect(fs.readFileSync(dest, "utf-8")).toBe(after1);
  });

  it("computeCrossRepoPromotions only reports targets fed by 2+ distinct repos", () => {
    const mk = (src: string, target: string, action: WholeFileImport["action"]): WholeFileImport => ({
      source_file: src, import_type: "trait", target_path: target, generates: [],
      action, composition_type: "preference", duplicate_of: null, confidence: "high",
    });
    const promos = computeCrossRepoPromotions([
      mk("/x/repo-a/.claude/traits/t.md", "core/traits/t.md", "create"),
      mk("/x/repo-b/.claude/traits/t.md", "core/traits/t.md", "merge"),
      mk("/x/repo-a/.claude/traits/solo.md", "core/traits/solo.md", "create"),
      mk("/x/repo-c/.claude/traits/skipped.md", "core/traits/t.md", "skip"),
    ]);
    expect(promos).toHaveLength(1);
    expect(promos[0]!.repos).toEqual(["repo-a", "repo-b"]);
  });
});

describe("D1: per-repo residuals import independently", () => {
  it("repo-specific traits are untouched by the promotion of shared ones", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);
    const repoA = path.join(tmpDir, "repo-alpha");
    const repoB = path.join(tmpDir, "repo-beta");
    writeFile(repoA, ".claude/traits/logging.md", SHARED_TRAIT);
    writeFile(repoA, ".claude/traits/alpha-only.md", "## Alpha deploys\nDeploy alpha via ArgoCD only.\n");
    writeFile(repoB, ".claude/traits/logging.md", SHARED_TRAIT);
    writeFile(repoB, ".claude/traits/beta-only.md", "## Beta migrations\nRun flyway before boot in beta.\n");

    const manifest = scanRepoDirs([repoA, repoB]);
    const imports = processWholeFileImports(categorizeByStrategy(manifest).wholeFile, hubPath);
    const result = applyWholeFileImports(imports, hubPath, new Set(manifest.files.map(f => f.absolutePath)));

    expect(result.created).toBe(3); // logging (promoted) + alpha-only + beta-only
    expect(result.skipped).toBe(1); // logging duplicate from the second repo
    const alphaOnly = fs.readFileSync(path.join(hubPath, "core/traits/alpha-only.md"), "utf-8");
    const betaOnly = fs.readFileSync(path.join(hubPath, "core/traits/beta-only.md"), "utf-8");
    expect(alphaOnly).toContain("source: repo-alpha");
    expect(alphaOnly).not.toContain("additional_sources");
    expect(betaOnly).toContain("source: repo-beta");
    expect(betaOnly).not.toContain("additional_sources");
  });
});
