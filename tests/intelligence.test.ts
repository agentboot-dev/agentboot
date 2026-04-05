/**
 * Tests for Harness Intelligence Pipeline pure functions.
 *
 * Covers:
 * - parseSourcesMd() and toFetchableUrl() from fetch-sources.ts
 * - buildPrompt() and validateReport() from run-sme.ts
 * - synthesizeReports() from synthesize.ts
 */

import { describe, it, expect } from "vitest";

import { parseSourcesMd, toFetchableUrl } from "../scripts/intelligence/fetch-sources.js";
import { buildPrompt, validateReport } from "../scripts/intelligence/run-sme.js";
import {
  synthesizeReports,
  generateRoadmapSuggestions,
  formatRoadmapSuggestionsMd,
} from "../scripts/intelligence/synthesize.js";
import type { RoadmapSuggestion } from "../scripts/intelligence/synthesize.js";

// ---------------------------------------------------------------------------
// parseSourcesMd
// ---------------------------------------------------------------------------

describe("parseSourcesMd", () => {
  it("parses valid markdown with tier headers and source entries", () => {
    const md = [
      "# Sources",
      "",
      "## Tier 1 — Primary",
      "",
      "- **Claude Code Releases**: https://github.com/anthropics/claude-code/releases",
      "  - Official release notes",
      "",
      "- **Docs Site**: https://docs.anthropic.com/changelog",
      "  - Changelog updates",
      "",
      "## Tier 2 — Secondary",
      "",
      "- **Community Forum**: https://community.anthropic.com/latest",
      "  - Community discussions",
      "",
      "## Tier 3 — Signals",
      "",
      "- **HN Mentions**: https://hn.algolia.com/?q=claude+code",
      "  - Hacker News chatter",
    ].join("\n");

    const sources = parseSourcesMd(md);
    expect(sources).toHaveLength(4);

    expect(sources[0]!.tier).toBe(1);
    expect(sources[0]!.label).toBe("Claude Code Releases");
    expect(sources[0]!.url).toBe("https://github.com/anthropics/claude-code/releases");

    expect(sources[1]!.tier).toBe(1);
    expect(sources[1]!.label).toBe("Docs Site");

    expect(sources[2]!.tier).toBe(2);
    expect(sources[2]!.label).toBe("Community Forum");

    expect(sources[3]!.tier).toBe(3);
    expect(sources[3]!.label).toBe("HN Mentions");
  });

  it("returns empty array for empty input", () => {
    expect(parseSourcesMd("")).toEqual([]);
  });

  it("returns empty array for content with no source entries", () => {
    const md = "# Just a heading\n\nSome text without any source entries.\n";
    expect(parseSourcesMd(md)).toEqual([]);
  });

  it("defaults to tier 1 when no tier header precedes entries", () => {
    const md = "- **Some Source**: https://example.com/feed\n";
    const sources = parseSourcesMd(md);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.tier).toBe(1);
  });

  it("handles missing description on next line", () => {
    const md = [
      "## Tier 2",
      "- **No Desc**: https://example.com/nodesc",
      "## Tier 3",
    ].join("\n");
    const sources = parseSourcesMd(md);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.description).toBe("");
  });
});

// ---------------------------------------------------------------------------
// toFetchableUrl
// ---------------------------------------------------------------------------

describe("toFetchableUrl", () => {
  it("rewrites GitHub releases page to API endpoint", () => {
    const url = "https://github.com/anthropics/claude-code/releases";
    const result = toFetchableUrl(url);
    expect(result).toBe(
      "https://api.github.com/repos/anthropics/claude-code/releases?per_page=5",
    );
  });

  it("rewrites GitHub releases page with trailing slash", () => {
    const url = "https://github.com/anthropics/claude-code/releases/";
    const result = toFetchableUrl(url);
    expect(result).toBe(
      "https://api.github.com/repos/anthropics/claude-code/releases?per_page=5",
    );
  });

  it("rewrites GitHub issues page to API endpoint", () => {
    const url = "https://github.com/anthropics/claude-code/issues";
    const result = toFetchableUrl(url);
    expect(result).toBe(
      "https://api.github.com/repos/anthropics/claude-code/issues?per_page=10&state=open&sort=updated",
    );
  });

  it("rewrites GitHub issues page with trailing slash", () => {
    const url = "https://github.com/anthropics/claude-code/issues/";
    const result = toFetchableUrl(url);
    expect(result).toContain("api.github.com");
  });

  it("passes through non-GitHub URLs unchanged", () => {
    const url = "https://docs.anthropic.com/changelog";
    expect(toFetchableUrl(url)).toBe(url);
  });

  it("passes through GitHub URLs that are not releases or issues", () => {
    const url = "https://github.com/anthropics/claude-code/blob/main/README.md";
    expect(toFetchableUrl(url)).toBe(url);
  });

  it("passes through a specific GitHub release (not the index)", () => {
    const url = "https://github.com/anthropics/claude-code/releases/tag/v1.0.0";
    expect(toFetchableUrl(url)).toBe(url);
  });
});

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

describe("buildPrompt", () => {
  const skillMd = "# CC SME\nYou are the Claude Code subject matter expert.";

  it("assembles prompt with source content", () => {
    const sources = [
      {
        url: "https://example.com/release",
        tier: 1 as const,
        label: "Releases",
        content: "v2.0 released with new features",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];
    const prompt = buildPrompt(skillMd, sources, "nightly", "cc");
    expect(prompt).toContain("Claude Code SME");
    expect(prompt).toContain(skillMd);
    expect(prompt).toContain("v2.0 released with new features");
    expect(prompt).toContain("--- SOURCE: Releases (Tier 1) ---");
    expect(prompt).toContain("nightly intelligence cycle");
  });

  it("includes failed source note when some sources have no content", () => {
    const sources = [
      {
        url: "https://example.com/ok",
        tier: 1 as const,
        label: "Good Source",
        content: "some content",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
      {
        url: "https://example.com/fail",
        tier: 2 as const,
        label: "Bad Source",
        content: null,
        error: "HTTP 404: Not Found",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];
    const prompt = buildPrompt(skillMd, sources, "weekly", "cc");
    expect(prompt).toContain("could not be fetched");
    expect(prompt).toContain("Bad Source");
    expect(prompt).toContain("HTTP 404: Not Found");
  });

  it("produces prompt with no source content blocks when all sources failed", () => {
    const sources = [
      {
        url: "https://example.com/fail",
        tier: 1 as const,
        label: "Failed",
        content: null,
        error: "timeout",
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];
    const prompt = buildPrompt(skillMd, sources, "ad-hoc", "cc");
    // No "--- SOURCE:" block since no content
    expect(prompt).not.toContain("--- SOURCE:");
    expect(prompt).toContain("could not be fetched");
    expect(prompt).toContain("Failed");
  });

  it("handles empty sources array", () => {
    const prompt = buildPrompt(skillMd, [], "nightly", "cc");
    expect(prompt).toContain("Claude Code SME");
    expect(prompt).not.toContain("--- SOURCE:");
    expect(prompt).not.toContain("could not be fetched");
  });

  it("truncates large source content", () => {
    const longContent = "x".repeat(15_000);
    const sources = [
      {
        url: "https://example.com/big",
        tier: 1 as const,
        label: "Big Source",
        content: longContent,
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    ];
    const prompt = buildPrompt(skillMd, sources, "nightly", "cc");
    expect(prompt).toContain("[TRUNCATED]");
    // Should not include the full 15k chars
    expect(prompt.length).toBeLessThan(longContent.length);
  });
});

// ---------------------------------------------------------------------------
// validateReport
// ---------------------------------------------------------------------------

describe("validateReport", () => {
  it("accepts a valid report", () => {
    const report = {
      harness: "cc",
      report_date: "2026-01-01",
      cycle: "nightly",
      findings: [
        {
          title: "New feature",
          category: "new-feature",
          source: "releases",
          summary: "A new thing",
          technical_impact: "medium",
          roadmap_signal: "monitor",
          action_required: "investigate",
          detail: "Details here",
        },
      ],
      summary: "One finding this cycle.",
      top_action_items: ["Investigate the new feature"],
    };
    expect(validateReport(report)).toBe(true);
  });

  it("accepts a report with empty findings", () => {
    const report = {
      harness: "cc",
      report_date: "2026-01-01",
      cycle: "nightly",
      findings: [],
      summary: "No findings.",
      top_action_items: [],
    };
    expect(validateReport(report)).toBe(true);
  });

  it("rejects null", () => {
    expect(validateReport(null)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(validateReport("not an object")).toBe(false);
  });

  it("rejects missing harness field", () => {
    expect(
      validateReport({
        report_date: "2026-01-01",
        cycle: "nightly",
        findings: [],
        summary: "x",
        top_action_items: [],
      }),
    ).toBe(false);
  });

  it("rejects missing findings field", () => {
    expect(
      validateReport({
        harness: "cc",
        report_date: "2026-01-01",
        cycle: "nightly",
        summary: "x",
        top_action_items: [],
      }),
    ).toBe(false);
  });

  it("rejects findings as non-array", () => {
    expect(
      validateReport({
        harness: "cc",
        report_date: "2026-01-01",
        cycle: "nightly",
        findings: "not an array",
        summary: "x",
        top_action_items: [],
      }),
    ).toBe(false);
  });

  it("rejects missing summary", () => {
    expect(
      validateReport({
        harness: "cc",
        report_date: "2026-01-01",
        cycle: "nightly",
        findings: [],
        top_action_items: [],
      }),
    ).toBe(false);
  });

  it("rejects top_action_items as non-array", () => {
    expect(
      validateReport({
        harness: "cc",
        report_date: "2026-01-01",
        cycle: "nightly",
        findings: [],
        summary: "x",
        top_action_items: "not an array",
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// synthesizeReports
// ---------------------------------------------------------------------------

describe("synthesizeReports", () => {
  function makeReport(overrides: Record<string, unknown> = {}) {
    return {
      harness: "cc",
      report_date: "2026-01-01",
      cycle: "nightly",
      findings: [] as Array<{
        title: string;
        category: string;
        source: string;
        summary: string;
        technical_impact: string;
        roadmap_signal: string;
        action_required: string;
        detail: string;
      }>,
      summary: "No significant findings.",
      top_action_items: [] as string[],
      ...overrides,
    };
  }

  it("generates markdown from multiple reports", () => {
    const reports = [
      makeReport({ harness: "cc", summary: "CC is stable." }),
      makeReport({ harness: "copilot", summary: "Copilot has updates." }),
    ];
    const md = synthesizeReports(reports);
    expect(md).toContain("Harness Intelligence Digest");
    expect(md).toContain("Harnesses analyzed**: 2");
    expect(md).toContain("CC is stable.");
    expect(md).toContain("Copilot has updates.");
  });

  it("generates markdown from empty reports (no findings)", () => {
    const reports = [makeReport()];
    const md = synthesizeReports(reports);
    expect(md).toContain("Total findings**: 0");
    expect(md).toContain("High/Critical findings**: 0");
    expect(md).not.toContain("## High-Priority Findings");
  });

  it("highlights high-priority findings", () => {
    const reports = [
      makeReport({
        harness: "cc",
        findings: [
          {
            title: "Breaking API Change",
            category: "breaking-change",
            source: "releases",
            summary: "The API changed significantly.",
            technical_impact: "critical",
            roadmap_signal: "implement",
            action_required: "escalate",
            detail: "Full details here.",
          },
          {
            title: "Minor Trend",
            category: "community-trend",
            source: "forum",
            summary: "Some discussion.",
            technical_impact: "low",
            roadmap_signal: "no-change",
            action_required: "none",
            detail: "Not important.",
          },
        ],
        top_action_items: ["Address the breaking change ASAP"],
      }),
    ];
    const md = synthesizeReports(reports);
    expect(md).toContain("## High-Priority Findings");
    expect(md).toContain("Breaking API Change");
    expect(md).toContain("**Impact**: critical");
    // The low-impact finding should NOT appear in high-priority section
    expect(md).toContain("## Action Items");
    expect(md).toContain("Address the breaking change ASAP");
    expect(md).toContain("Total findings**: 2");
    expect(md).toContain("High/Critical findings**: 1");
  });

  it("aggregates action items across multiple reports", () => {
    const reports = [
      makeReport({
        harness: "cc",
        top_action_items: ["Item 1 from CC"],
      }),
      makeReport({
        harness: "copilot",
        top_action_items: ["Item 2 from Copilot", "Item 3 from Copilot"],
      }),
    ];
    const md = synthesizeReports(reports);
    expect(md).toContain("Action items**: 3");
    expect(md).toContain("Item 1 from CC");
    expect(md).toContain("Item 2 from Copilot");
    expect(md).toContain("Item 3 from Copilot");
  });
});

// ---------------------------------------------------------------------------
// generateRoadmapSuggestions (AB-163)
// ---------------------------------------------------------------------------

describe("generateRoadmapSuggestions", () => {
  function makeReport(overrides: Record<string, unknown> = {}) {
    return {
      harness: "cc",
      report_date: "2026-01-01",
      cycle: "nightly",
      findings: [] as Array<{
        title: string;
        category: string;
        source: string;
        summary: string;
        technical_impact: string;
        roadmap_signal: string;
        action_required: string;
        detail: string;
      }>,
      summary: "No significant findings.",
      top_action_items: [] as string[],
      ...overrides,
    };
  }

  it("exports the RoadmapSuggestion type", () => {
    // Type-level check: if this compiles, the type is exported
    const suggestion: RoadmapSuggestion = {
      title: "Test",
      rationale: "Test rationale",
      evidence: ["evidence"],
      priority: "HIGH",
      suggestedPhase: "current",
      source: "telemetry",
    };
    expect(suggestion.priority).toBe("HIGH");
  });

  it("generates HIGH priority suggestions from critical findings", () => {
    const reports = [
      makeReport({
        findings: [
          {
            title: "Breaking API Change",
            category: "breaking-change",
            source: "releases",
            summary: "The API changed significantly.",
            technical_impact: "critical",
            roadmap_signal: "implement",
            action_required: "escalate",
            detail: "Full details here.",
          },
        ],
      }),
    ];
    const suggestions = generateRoadmapSuggestions(reports);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    const high = suggestions.filter((s) => s.priority === "HIGH");
    expect(high.length).toBeGreaterThanOrEqual(1);
    expect(high[0]!.title).toContain("Breaking API Change");
  });

  it("generates suggestions for recurring categories", () => {
    const reports = [
      makeReport({
        harness: "cc",
        findings: [
          {
            title: "Issue A",
            category: "community-trend",
            source: "forum",
            summary: "First occurrence.",
            technical_impact: "low",
            roadmap_signal: "no-change",
            action_required: "none",
            detail: "",
          },
          {
            title: "Issue B",
            category: "community-trend",
            source: "forum",
            summary: "Second occurrence.",
            technical_impact: "low",
            roadmap_signal: "no-change",
            action_required: "none",
            detail: "",
          },
        ],
      }),
    ];
    const suggestions = generateRoadmapSuggestions(reports);
    const recurring = suggestions.filter((s) => s.title.includes("Recurring pattern"));
    expect(recurring.length).toBeGreaterThanOrEqual(1);
  });

  it("generates LOW priority for silent harnesses", () => {
    const reports = [makeReport({ harness: "copilot" })];
    const suggestions = generateRoadmapSuggestions(reports);
    const silent = suggestions.filter((s) => s.title.includes("Silent harness"));
    expect(silent.length).toBe(1);
    expect(silent[0]!.priority).toBe("LOW");
  });

  it("sorts suggestions by priority (HIGH > MEDIUM > LOW)", () => {
    const reports = [
      makeReport({
        harness: "cc",
        findings: [
          {
            title: "Critical Thing",
            category: "breaking-change",
            source: "releases",
            summary: "Critical.",
            technical_impact: "critical",
            roadmap_signal: "implement",
            action_required: "escalate",
            detail: "",
          },
          {
            title: "Low Thing",
            category: "minor-update",
            source: "docs",
            summary: "Low impact.",
            technical_impact: "low",
            roadmap_signal: "no-change",
            action_required: "none",
            detail: "",
          },
        ],
        top_action_items: ["a", "b", "c"],
      }),
      makeReport({ harness: "copilot" }), // silent → LOW
    ];
    const suggestions = generateRoadmapSuggestions(reports);
    expect(suggestions.length).toBeGreaterThanOrEqual(2);

    const priorities = suggestions.map((s) => s.priority);
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    for (let i = 1; i < priorities.length; i++) {
      expect(order[priorities[i]!]).toBeGreaterThanOrEqual(order[priorities[i - 1]!]);
    }
  });

  it("returns empty array when no patterns detected", () => {
    const reports = [
      makeReport({
        harness: "cc",
        findings: [
          {
            title: "Minor Update",
            category: "minor-update",
            source: "docs",
            summary: "Minor.",
            technical_impact: "low",
            roadmap_signal: "no-change",
            action_required: "none",
            detail: "",
          },
        ],
        top_action_items: ["One item"],
      }),
    ];
    const suggestions = generateRoadmapSuggestions(reports);
    // Only non-critical single findings with <3 action items and >=1 finding → no suggestions
    expect(suggestions.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatRoadmapSuggestionsMd (AB-163)
// ---------------------------------------------------------------------------

describe("formatRoadmapSuggestionsMd", () => {
  const sampleSuggestions: RoadmapSuggestion[] = [
    {
      title: "Fix critical API issue",
      rationale: "Breaking change detected.",
      evidence: ["[releases] API v2 broke backward compat"],
      priority: "HIGH",
      suggestedPhase: "current",
      source: "incident",
    },
    {
      title: "Add new persona for monitoring",
      rationale: "Coverage gap identified.",
      evidence: ["[cc] Missing monitoring coverage"],
      priority: "MEDIUM",
      suggestedPhase: "next",
      source: "telemetry",
    },
    {
      title: "Review stale harness",
      rationale: "Harness produced no findings.",
      evidence: ["[copilot] Zero findings on 2026-01-01"],
      priority: "LOW",
      suggestedPhase: "backlog",
      source: "telemetry",
    },
  ];

  it("includes the human review disclaimer", () => {
    const md = formatRoadmapSuggestionsMd(sampleSuggestions);
    expect(md).toContain("Human review required before acting on any suggestion.");
  });

  it("includes a generated timestamp", () => {
    const md = formatRoadmapSuggestionsMd(sampleSuggestions);
    expect(md).toMatch(/Generated: \d{4}-\d{2}-\d{2}T/);
  });

  it("groups suggestions by priority with correct headers", () => {
    const md = formatRoadmapSuggestionsMd(sampleSuggestions);
    expect(md).toContain("## HIGH Priority");
    expect(md).toContain("## MEDIUM Priority");
    expect(md).toContain("## LOW Priority");
  });

  it("contains valid JSON in the Raw JSON block", () => {
    const md = formatRoadmapSuggestionsMd(sampleSuggestions);
    const jsonMatch = md.match(/```json\n([\s\S]*?)\n```/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(jsonMatch![1]!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].priority).toBe("HIGH");
  });

  it("handles empty suggestions array", () => {
    const md = formatRoadmapSuggestionsMd([]);
    expect(md).toContain("No suggestions generated");
    expect(md).toContain("```json\n[]\n```");
  });

  it("omits priority sections that have no items", () => {
    const highOnly: RoadmapSuggestion[] = [
      {
        title: "Only high",
        rationale: "Test",
        evidence: ["e1"],
        priority: "HIGH",
        suggestedPhase: "current",
        source: "incident",
      },
    ];
    const md = formatRoadmapSuggestionsMd(highOnly);
    expect(md).toContain("## HIGH Priority");
    expect(md).not.toContain("## MEDIUM Priority");
    expect(md).not.toContain("## LOW Priority");
  });
});
