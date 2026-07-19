/**
 * Release/CI workflow contract tests.
 *
 * The release pipeline is decoupled from merge: a release happens ONLY when a
 * merged PR deliberately bumped package.json's version past the latest v* tag.
 * The workflow never pushes commits back to main, queues stacked merges via a
 * concurrency group, checks out the exact triggering merge commit, and
 * publishes an SBOM whose completeness is guarded against the production
 * lockfile closure. These tests pin that contract so it cannot silently
 * regress; the CI gate (validate.yml) must likewise stay an honest gate with
 * pinned tooling.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const ROOT = path.resolve(__dirname, "..");

const releaseRaw = fs.readFileSync(
  path.join(ROOT, ".github/workflows/release.yml"),
  "utf8",
);
const validateRaw = fs.readFileSync(
  path.join(ROOT, ".github/workflows/validate.yml"),
  "utf8",
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const release = yaml.load(releaseRaw) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validate = yaml.load(validateRaw) as any;

const releaseSteps: Array<Record<string, unknown>> = release.jobs.release.steps;
const stepByName = (name: string) =>
  releaseSteps.find((s) => s.name === name) as Record<string, string> | undefined;

describe("release.yml — decoupled publish contract", () => {
  it("queues stacked merges instead of racing (concurrency group, no cancel)", () => {
    expect(release.concurrency).toEqual({
      group: "release",
      "cancel-in-progress": false,
    });
  });

  it("checks out the exact triggering commit with the default token", () => {
    const checkout = releaseSteps.find((s) =>
      String((s as { uses?: string }).uses ?? "").startsWith("actions/checkout@"),
    ) as { with: Record<string, unknown> };
    expect(checkout).toBeDefined();
    expect(String(checkout.with.ref)).toContain(
      "github.event.pull_request.merge_commit_sha",
    );
    expect(String(checkout.with.ref)).toContain("github.sha");
    // Tags must be reachable for the version-vs-tag comparison.
    expect(checkout.with["fetch-depth"]).toBe(0);
    // No PAT: the workflow no longer pushes commits to main, so the default
    // GITHUB_TOKEN suffices for checkout.
    expect(checkout.with.token).toBeUndefined();
  });

  it("has no auto-patch-bump path and never commits back to main", () => {
    expect(releaseRaw).not.toMatch(/auto-bump/i);
    expect(releaseRaw).not.toMatch(/npm version /);
    expect(releaseRaw).not.toMatch(/git push origin main/);
    const bumpStep = releaseSteps.find((s) =>
      String(s.name ?? "").toLowerCase().includes("bump"),
    );
    expect(bumpStep).toBeUndefined();
  });

  it("releases only on a deliberate version bump, else no-ops with a summary", () => {
    const version = stepByName("Determine release version");
    expect(version).toBeDefined();
    expect(version!.run).toContain("release=false");
    expect(version!.run).toContain("no version bump in this merge — no release");
    // Every publishing step is gated on the release output.
    for (const name of [
      "Tag the release commit",
      "Create GitHub Release",
      "Publish to npm",
      "Attach SBOM and checksums to the release",
      "Update Homebrew formula",
    ]) {
      const step = stepByName(name);
      expect(step, name).toBeDefined();
      expect(String(step!.if), name).toContain(
        "steps.version.outputs.release == 'true'",
      );
      expect(String(step!.if), name).toContain("!inputs.dry-run");
    }
  });

  it("keeps the merged-PR guard and drops the release-title guard", () => {
    const cond = String(release.jobs.release.if);
    expect(cond).toContain("github.event.pull_request.merged == true");
    expect(cond).not.toContain("chore: release v");
  });

  it("keeps the preflight gates (version strings, build/test, provenance)", () => {
    expect(stepByName("Verify release version strings")!.run).toContain(
      "check-version-strings.ts",
    );
    expect(stepByName("Build and test")!.run).toContain("npm test");
    expect(stepByName("Publish to npm")!.run).toContain("npm publish --provenance");
  });

  it("builds the SBOM from a prod-only resolution, not `npm sbom --omit dev`", () => {
    // npm's omit filter drops production packages that receive peer/dev edges
    // from dev-only packages (the tsx → esbuild runtime subtree was silently
    // missing from published SBOMs). The workflow must prune devDependencies
    // and SBOM the re-resolved prod-only lockfile instead.
    const sbom = stepByName("Attach SBOM and checksums to the release")!;
    expect(String(sbom.run)).not.toContain("--omit dev");
    expect(String(sbom.run)).not.toContain("--omit=dev");
    expect(String(sbom.run)).toContain("delete p.devDependencies");
    expect(String(sbom.run)).toContain("--package-lock-only");
    // Completeness guard: fail the release if the SBOM misses any prod package.
    expect(String(sbom.run)).toContain("SBOM incomplete");
    expect(String(sbom.run)).toMatch(/"tsx", "esbuild"/);
  });
});

describe("validate.yml — honest merge gate", () => {
  it("does not mask any matrix leg with continue-on-error", () => {
    expect(validateRaw).not.toContain("continue-on-error");
    expect(validate.jobs.validate["continue-on-error"]).toBeUndefined();
  });

  it("pins external tools installed inside the gate to exact versions", () => {
    // A floating install inside a required check lets an upstream publish
    // change the gate's behavior. Both installs must carry an exact pin.
    expect(validateRaw).toMatch(
      /npm install -g @anthropic-ai\/claude-code@\d+\.\d+\.\d+/,
    );
    expect(validateRaw).not.toMatch(
      /npm install -g @anthropic-ai\/claude-code\s*$/m,
    );
    expect(validateRaw).toMatch(/npx -y skills-ref@\d+\.\d+\.\d+ validate/);
    expect(validateRaw).not.toMatch(/npx -y skills-ref validate/);
  });
});
