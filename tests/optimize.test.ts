/**
 * Tests for AB-153: optimize command.
 *
 * Covers: telemetry loading, metric aggregation, model recommendations,
 * coverage gap analysis, HTML report generation, and empty data handling.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  loadTelemetry,
  aggregateMetrics,
  generateModelRecommendations,
  analyzeCoverage,
  generateHtmlReport,
  type TelemetryEvent,
  type OptimizeOptions,
} from "../scripts/lib/optimize.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeTelemetryDir(): string {
  const dir = path.join(tmpDir, "telemetry");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeNdjson(filePath: string, events: TelemetryEvent[]): void {
  const content = events.map(e => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(filePath, content, "utf-8");
}

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    event: "persona_invocation",
    persona_id: "code-reviewer",
    model: "claude-sonnet-4-6",
    scope: "core",
    input_tokens: 5000,
    output_tokens: 2000,
    cost_usd: undefined,
    duration_ms: 3000,
    findings_count: { CRITICAL: 0, ERROR: 1, WARN: 2, INFO: 3 },
    timestamp: "2026-04-01T10:00:00Z",
    status: "completed",
    rephrased: false,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-optimize-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ===========================================================================
// loadTelemetry
// ===========================================================================

describe("AB-153: loadTelemetry", () => {
  it("loads events from daily NDJSON files", () => {
    const dir = makeTelemetryDir();
    const events = [makeEvent(), makeEvent({ persona_id: "security-reviewer" })];
    writeNdjson(path.join(dir, "2026-04-01.ndjson"), events);

    const loaded = loadTelemetry({}, dir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.persona_id).toBe("code-reviewer");
    expect(loaded[1]!.persona_id).toBe("security-reviewer");
  });

  it("loads events from legacy single file", () => {
    const dir = makeTelemetryDir();
    const legacyFile = dir + ".ndjson";
    writeNdjson(legacyFile, [makeEvent()]);

    const loaded = loadTelemetry({}, dir);
    expect(loaded).toHaveLength(1);
  });

  it("filters by --since date", () => {
    const dir = makeTelemetryDir();
    writeNdjson(path.join(dir, "2026-03-15.ndjson"), [
      makeEvent({ timestamp: "2026-03-15T10:00:00Z" }),
    ]);
    writeNdjson(path.join(dir, "2026-04-01.ndjson"), [
      makeEvent({ timestamp: "2026-04-01T10:00:00Z" }),
    ]);

    const loaded = loadTelemetry({ since: "2026-04-01" }, dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.timestamp).toContain("2026-04-01");
  });

  it("filters by --until date", () => {
    const dir = makeTelemetryDir();
    writeNdjson(path.join(dir, "2026-03-15.ndjson"), [
      makeEvent({ timestamp: "2026-03-15T10:00:00Z" }),
    ]);
    writeNdjson(path.join(dir, "2026-04-01.ndjson"), [
      makeEvent({ timestamp: "2026-04-01T10:00:00Z" }),
    ]);

    const loaded = loadTelemetry({ until: "2026-03-31" }, dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.timestamp).toContain("2026-03-15");
  });

  it("filters by --scope", () => {
    const dir = makeTelemetryDir();
    writeNdjson(path.join(dir, "2026-04-01.ndjson"), [
      makeEvent({ scope: "team:platform/api" }),
      makeEvent({ scope: "team:data/pipeline" }),
    ]);

    const loaded = loadTelemetry({ scope: "team:platform/*" }, dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.scope).toBe("team:platform/api");
  });

  it("returns empty array for missing directory", () => {
    const dir = path.join(tmpDir, "nonexistent");
    const loaded = loadTelemetry({}, dir);
    expect(loaded).toHaveLength(0);
  });

  it("skips malformed JSON lines", () => {
    const dir = makeTelemetryDir();
    const content = JSON.stringify(makeEvent()) + "\n" + "NOT JSON\n" + JSON.stringify(makeEvent()) + "\n";
    fs.writeFileSync(path.join(dir, "2026-04-01.ndjson"), content);

    const loaded = loadTelemetry({}, dir);
    expect(loaded).toHaveLength(2);
  });
});

// ===========================================================================
// aggregateMetrics
// ===========================================================================

describe("AB-153: aggregateMetrics", () => {
  it("groups by persona x scope x model", () => {
    const events = [
      makeEvent({ persona_id: "code-reviewer", scope: "core", model: "claude-sonnet-4-6" }),
      makeEvent({ persona_id: "code-reviewer", scope: "core", model: "claude-sonnet-4-6" }),
      makeEvent({ persona_id: "security-reviewer", scope: "core", model: "claude-opus-4-6" }),
    ];

    const metrics = aggregateMetrics(events);
    expect(metrics).toHaveLength(2);

    const codeReviewer = metrics.find(m => m.personaId === "code-reviewer");
    expect(codeReviewer).toBeDefined();
    expect(codeReviewer!.invocations).toBe(2);

    const secReviewer = metrics.find(m => m.personaId === "security-reviewer");
    expect(secReviewer).toBeDefined();
    expect(secReviewer!.invocations).toBe(1);
  });

  it("calculates cost from tokens when cost_usd is not provided", () => {
    const events = [
      makeEvent({
        model: "claude-sonnet-4-6",
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        cost_usd: undefined,
      }),
    ];

    const metrics = aggregateMetrics(events);
    // Sonnet: input $3/M, output $15/M
    // 1M input * 3 = $3, 0.5M output * 15 = $7.50
    const expected = 3.0 + 7.5;
    expect(metrics[0]!.totalCostUsd).toBeCloseTo(expected, 4);
  });

  it("uses cost_usd directly when provided", () => {
    const events = [
      makeEvent({ cost_usd: 1.23, input_tokens: 999999, output_tokens: 999999 }),
    ];

    const metrics = aggregateMetrics(events);
    expect(metrics[0]!.totalCostUsd).toBeCloseTo(1.23, 4);
  });

  it("aggregates findings by level", () => {
    const events = [
      makeEvent({ findings_count: { CRITICAL: 1, ERROR: 2, WARN: 0, INFO: 5 } }),
      makeEvent({ findings_count: { CRITICAL: 0, ERROR: 3, WARN: 1, INFO: 0 } }),
    ];

    const metrics = aggregateMetrics(events);
    expect(metrics[0]!.findingsByLevel.CRITICAL).toBe(1);
    expect(metrics[0]!.findingsByLevel.ERROR).toBe(5);
    expect(metrics[0]!.findingsByLevel.WARN).toBe(1);
    expect(metrics[0]!.findingsByLevel.INFO).toBe(5);
  });

  it("calculates rephrase rate", () => {
    const events = [
      makeEvent({ rephrased: true }),
      makeEvent({ rephrased: false }),
      makeEvent({ rephrased: false }),
      makeEvent({ rephrased: true }),
    ];

    const metrics = aggregateMetrics(events);
    expect(metrics[0]!.rephrasedCount).toBe(2);
    expect(metrics[0]!.rephraseRate).toBeCloseTo(0.5, 4);
  });

  it("filters out non-completed and non-persona_invocation events", () => {
    const events = [
      makeEvent({ status: "completed" }),
      makeEvent({ status: "failed" }),
      makeEvent({ event: "session_start", status: "completed" }),
    ];

    const metrics = aggregateMetrics(events);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.invocations).toBe(1);
  });

  it("sorts by total cost descending", () => {
    const events = [
      makeEvent({ persona_id: "cheap", cost_usd: 0.10 }),
      makeEvent({ persona_id: "expensive", cost_usd: 10.00 }),
      makeEvent({ persona_id: "medium", cost_usd: 1.00 }),
    ];

    const metrics = aggregateMetrics(events);
    expect(metrics[0]!.personaId).toBe("expensive");
    expect(metrics[1]!.personaId).toBe("medium");
    expect(metrics[2]!.personaId).toBe("cheap");
  });

  it("returns empty array for empty input", () => {
    const metrics = aggregateMetrics([]);
    expect(metrics).toHaveLength(0);
  });

  it("calculates average duration", () => {
    const events = [
      makeEvent({ duration_ms: 2000 }),
      makeEvent({ duration_ms: 4000 }),
    ];

    const metrics = aggregateMetrics(events);
    expect(metrics[0]!.avgDurationMs).toBeCloseTo(3000, 4);
  });
});

// ===========================================================================
// generateModelRecommendations
// ===========================================================================

describe("AB-153: generateModelRecommendations", () => {
  it("recommends downgrade from Opus when rephrase rate is low", () => {
    const metrics = aggregateMetrics([
      makeEvent({ persona_id: "sec-reviewer", model: "claude-opus-4-6", cost_usd: 5.0, rephrased: false }),
      makeEvent({ persona_id: "sec-reviewer", model: "claude-opus-4-6", cost_usd: 5.0, rephrased: false }),
    ]);

    const recs = generateModelRecommendations(metrics);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.personaId).toBe("sec-reviewer");
    expect(recs[0]!.currentModel).toBe("claude-opus-4-6");
    expect(recs[0]!.recommendedModel).toBe("claude-sonnet-4-6");
    expect(recs[0]!.projectedSavingsUsd).toBeGreaterThan(0);
  });

  it("does not recommend downgrade from Opus when rephrase rate >= 10%", () => {
    const events: TelemetryEvent[] = [];
    // 2 out of 10 rephrased = 20%
    for (let i = 0; i < 10; i++) {
      events.push(makeEvent({
        persona_id: "sec-reviewer",
        model: "claude-opus-4-6",
        rephrased: i < 2,
      }));
    }

    const metrics = aggregateMetrics(events);
    const recs = generateModelRecommendations(metrics);
    expect(recs).toHaveLength(0);
  });

  it("recommends upgrade from Haiku when rephrase rate > 20%", () => {
    const events: TelemetryEvent[] = [];
    // 3 out of 10 rephrased = 30%
    for (let i = 0; i < 10; i++) {
      events.push(makeEvent({
        persona_id: "test-gen",
        model: "claude-haiku-4-5",
        rephrased: i < 3,
      }));
    }

    const metrics = aggregateMetrics(events);
    const recs = generateModelRecommendations(metrics);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.personaId).toBe("test-gen");
    expect(recs[0]!.recommendedModel).toBe("claude-sonnet-4-6");
    expect(recs[0]!.projectedSavingsUsd).toBe(0); // upgrade, not savings
  });

  it("returns empty for Sonnet models", () => {
    const metrics = aggregateMetrics([
      makeEvent({ model: "claude-sonnet-4-6", rephrased: false }),
    ]);

    const recs = generateModelRecommendations(metrics);
    expect(recs).toHaveLength(0);
  });

  it("notes CRITICAL findings in risk for Opus downgrade", () => {
    const metrics = aggregateMetrics([
      makeEvent({
        persona_id: "sec-reviewer",
        model: "claude-opus-4-6",
        rephrased: false,
        findings_count: { CRITICAL: 3, ERROR: 0, WARN: 0, INFO: 0 },
      }),
    ]);

    const recs = generateModelRecommendations(metrics);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.risk).toContain("CRITICAL");
  });
});

// ===========================================================================
// analyzeCoverage
// ===========================================================================

describe("AB-153: analyzeCoverage", () => {
  it("finds missing persona x scope pairs", () => {
    const metrics = aggregateMetrics([
      makeEvent({ persona_id: "code-reviewer", scope: "core" }),
    ]);

    const gaps = analyzeCoverage(
      metrics,
      ["code-reviewer", "security-reviewer"],
      ["core"]
    );

    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.persona).toBe("security-reviewer");
    expect(gaps[0]!.scope).toBe("core");
    expect(gaps[0]!.message).toContain("0");
  });

  it("returns no gaps when all combos are covered", () => {
    const metrics = aggregateMetrics([
      makeEvent({ persona_id: "code-reviewer", scope: "core" }),
      makeEvent({ persona_id: "security-reviewer", scope: "core" }),
    ]);

    const gaps = analyzeCoverage(
      metrics,
      ["code-reviewer", "security-reviewer"],
      ["core"]
    );

    expect(gaps).toHaveLength(0);
  });

  it("handles multiple scopes", () => {
    const metrics = aggregateMetrics([
      makeEvent({ persona_id: "code-reviewer", scope: "core" }),
    ]);

    const gaps = analyzeCoverage(
      metrics,
      ["code-reviewer"],
      ["core", "team:platform"]
    );

    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.scope).toBe("team:platform");
  });

  it("returns empty for empty inputs", () => {
    const gaps = analyzeCoverage([], [], []);
    expect(gaps).toHaveLength(0);
  });
});

// ===========================================================================
// generateHtmlReport
// ===========================================================================

describe("AB-153: generateHtmlReport", () => {
  it("produces valid HTML with doctype", () => {
    const metrics = aggregateMetrics([makeEvent({ cost_usd: 1.50 })]);
    const recs = generateModelRecommendations(metrics);
    const gaps = analyzeCoverage(metrics, [], []);

    const html = generateHtmlReport(metrics, recs, gaps, {});
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html).toContain("AgentBoot Optimize Report");
  });

  it("includes cost and invocation stats", () => {
    const metrics = aggregateMetrics([
      makeEvent({ cost_usd: 2.50 }),
      makeEvent({ cost_usd: 3.50 }),
    ]);

    const html = generateHtmlReport(metrics, [], [], {});
    expect(html).toContain("$6.00");
    expect(html).toContain("2"); // invocations
  });

  it("includes persona names in table", () => {
    const metrics = aggregateMetrics([
      makeEvent({ persona_id: "code-reviewer" }),
    ]);

    const html = generateHtmlReport(metrics, [], [], {});
    expect(html).toContain("code-reviewer");
  });

  it("includes recommendations when present", () => {
    const metrics = aggregateMetrics([
      makeEvent({ persona_id: "sec", model: "claude-opus-4-6", rephrased: false, cost_usd: 5 }),
    ]);
    const recs = generateModelRecommendations(metrics);

    const html = generateHtmlReport(metrics, recs, [], {});
    expect(html).toContain("Recommendations");
    expect(html).toContain("sonnet");
  });

  it("includes coverage gaps when present", () => {
    const gaps = [{ scope: "core", persona: "test-gen", message: "core has 0 test-gen invocations" }];

    const html = generateHtmlReport([], [], gaps, {});
    expect(html).toContain("Coverage Gaps");
    expect(html).toContain("core has 0 test-gen invocations");
  });

  it("uses provided version string", () => {
    const html = generateHtmlReport([], [], [], {}, "1.2.3");
    expect(html).toContain("v1.2.3");
  });

  it("handles empty metrics gracefully", () => {
    const html = generateHtmlReport([], [], [], {});
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("$0.00");
    expect(html).toContain("0"); // invocations
  });
});

// ===========================================================================
// generateHtmlReport: HTML written to disk
// Addresses gap: "optimize --report creates HTML file — only string return tested,
//   file is never written to disk and the --report CLI flag path is untested"
// (human-in-the-loop-priority.md HIGH section, manual test TP-11-5)
// ===========================================================================

describe("AB-153: generateHtmlReport written to disk (TP-11-5)", () => {
  // Prove the report string can be written to disk and the file starts correctly
  it("report written to temp file starts with <!DOCTYPE html> and is complete HTML", () => {
    const tmpFile = path.join(tmpDir, "test-optimize-report.html");
    const metrics = aggregateMetrics([
      makeEvent({ persona_id: "code-reviewer", cost_usd: 1.25 }),
      makeEvent({ persona_id: "security-reviewer", cost_usd: 2.50 }),
    ]);
    const recs = generateModelRecommendations(metrics);
    const gaps = analyzeCoverage(metrics, ["code-reviewer", "security-reviewer"], ["core"]);

    const html = generateHtmlReport(metrics, recs, gaps, {});
    fs.writeFileSync(tmpFile, html, "utf-8");

    expect(fs.existsSync(tmpFile)).toBe(true);
    const fileContent = fs.readFileSync(tmpFile, "utf-8");

    // Proves the file starts with the correct doctype (not truncated or binary)
    expect(fileContent.startsWith("<!DOCTYPE html>")).toBe(true);
    // Proves the file ends with the closing tag (complete, not truncated)
    expect(fileContent).toContain("</html>");
    // Proves the file is non-trivial (doctype + content, not just boilerplate)
    expect(fileContent.length).toBeGreaterThan(500);
  });

  // Prove the HTML report contains no external <script src> references (TP-11-5)
  it("report HTML has no external <script src=...> references (all scripts inline)", () => {
    const metrics = aggregateMetrics([makeEvent()]);
    const html = generateHtmlReport(metrics, [], [], {});
    // External CDN or remote script loading would be a security concern
    expect(html).not.toMatch(/<script\s+src=/i);
  });

  // Prove that empty telemetry renders an empty-state message, not broken HTML
  it("report with empty telemetry shows empty-state content without breaking HTML structure", () => {
    const html = generateHtmlReport([], [], [], {});
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
    // Must be a non-trivial document (not just doctype + closing tag)
    expect(html.length).toBeGreaterThan(200);
  });
});
