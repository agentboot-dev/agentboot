/**
 * Field reports UI-14..UI-16 (fifth wave).
 *
 * UI-14: AGENTBOOT_HUB was honored by mcp-server/doctor but ignored by
 *   status/drift-check and other hub commands — one resolution order now
 *   (flag > env > cwd > fallback), via envHubConfig()/resolveConfigPath.
 * UI-15: optimize rendered "$0.00 / unknown" over hook-only telemetry —
 *   it now labels uncollected fields honestly and states that cost/model
 *   recommendations require API-level telemetry.
 * UI-16: import "merge" appended duplicate content into an existing artifact,
 *   dropped the second repo's provenance, and reported "Created" — now
 *   duplicate content is skipped with multi-source attribution, and distinct
 *   content is labeled as an update.
 */

import { describe, it, expect, vi } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveConfigPath, envHubConfig } from "../scripts/lib/config.js";
import { isDuplicateContent, addSourceAttribution } from "../scripts/lib/import.js";
import { aggregateMetrics, printOptimizeReport, type TelemetryEvent } from "../scripts/lib/optimize.js";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const CLI = path.join(ROOT, "scripts", "cli.ts");

function withEnvHub<T>(hubPath: string | undefined, fn: () => T): T {
  const saved = process.env["AGENTBOOT_HUB"];
  if (hubPath === undefined) delete process.env["AGENTBOOT_HUB"];
  else process.env["AGENTBOOT_HUB"] = hubPath;
  try { return fn(); }
  finally {
    if (saved !== undefined) process.env["AGENTBOOT_HUB"] = saved;
    else delete process.env["AGENTBOOT_HUB"];
  }
}

describe("UI-14: uniform hub resolution (flag > env > cwd)", () => {
  it("resolveConfigPath honors AGENTBOOT_HUB ahead of cwd/fallback", () => {
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-ui14-hub-"));
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-ui14-cwd-"));
    try {
      fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({ org: "envhub" }));
      withEnvHub(hub, () => {
        expect(resolveConfigPath([], ROOT, elsewhere)).toBe(path.join(hub, "agentboot.config.json"));
        // --config still wins over env
        expect(resolveConfigPath(["--config", "/x/agentboot.config.json"], ROOT, elsewhere))
          .toBe(path.resolve("/x/agentboot.config.json"));
      });
      // env pointing at a dir without a config resolves to null → falls through
      withEnvHub(elsewhere, () => {
        expect(envHubConfig()).toBeNull();
      });
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("`agentboot status` follows AGENTBOOT_HUB from an unrelated directory", () => {
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-ui14-shub-"));
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-ui14-scwd-"));
    try {
      fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
        org: "env-resolved-org", personas: { enabled: [] },
      }));
      let out = "";
      try {
        out = execSync(`${TSX} ${CLI} status`, {
          cwd: elsewhere,
          encoding: "utf-8",
          timeout: 30_000,
          env: { ...process.env, AGENTBOOT_HUB: hub },
        });
      } catch (err: any) {
        out = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
      }
      expect(out).toContain("env-resolved-org");
      expect(out).not.toContain("No agentboot.config.json found");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe("UI-15: optimize is honest about hook-only telemetry", () => {
  const hookEvent = (persona: string): TelemetryEvent => ({
    event: "persona_invocation", persona_id: persona, status: "completed",
    timestamp: "2026-07-18T12:00:00Z", dev_id: "",
  });

  it("labels uncollected scope/model as '(not collected)', not 'unknown'", () => {
    const metrics = aggregateMetrics([hookEvent("code-reviewer")]);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.scope).toBe("(not collected)");
    expect(metrics[0]!.model).toBe("(not collected)");
  });

  it("states up front that hook-only logs cannot support cost figures", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    try {
      const metrics = aggregateMetrics([hookEvent("code-reviewer"), hookEvent("code-reviewer")]);
      printOptimizeReport(metrics, [], [], {}, { total: 2, withCost: 0 });
    } finally {
      spy.mockRestore();
    }
    const output = lines.join("\n");
    expect(output).toContain("hook-emitted");
    expect(output).toContain("REQUIRE API-level telemetry");
    expect(output).toContain('Do not read $0.00 as "free"');
  });
});

describe("UI-16: import merge dedup + multi-source attribution", () => {
  const existing = [
    "---",
    "description: log4j2 convention",
    "source: repoA",
    "---",
    "",
    "## Logging",
    "Use log4j2, never logback — the shared appender config assumes log4j2.",
    "",
  ].join("\n");

  it("detects verbatim-identical content as duplicate (headers/whitespace-insensitive)", () => {
    expect(isDuplicateContent(existing,
      "### Conventions\nUse log4j2,   never logback — the shared appender config assumes log4j2.")).toBe(true);
    expect(isDuplicateContent(existing,
      "Use logback for services migrated after 2026.")).toBe(false);
  });

  it("records the second source in frontmatter without duplicating it", () => {
    const once = addSourceAttribution(existing, "repoB");
    expect(once).toContain("additional_sources: repoB");
    expect(once).toContain("source: repoA"); // original provenance intact
    const twice = addSourceAttribution(once, "repoB");
    expect(twice).toBe(once); // idempotent
    const third = addSourceAttribution(twice, "repoC");
    expect(third).toContain("additional_sources: repoB, repoC");
  });

  it("does not attribute a source that is already the primary source", () => {
    expect(addSourceAttribution(existing, "repoA")).toBe(existing);
  });
});
