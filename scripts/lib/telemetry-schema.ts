/**
 * B6: The canonical telemetry event schema — the single source of truth for
 * what the generated audit-trail hook emits.
 *
 * The contract: generated hooks emit EXACTLY these shapes, nothing more. The
 * schema is versioned (`schema` field on every event); any change to a shape
 * must bump TELEMETRY_SCHEMA_VERSION and be called out in release notes.
 * tests/band-b.test.ts executes the generated hook and asserts its output
 * matches these shapes key-for-key, so hook and schema cannot drift silently.
 *
 * Content-bearing fields are prohibited BY SCHEMA: there is no field for
 * prompts, responses, file contents, file paths, or tool arguments, and the
 * conformance test fails if one appears.
 */

export const TELEMETRY_SCHEMA_VERSION = 1;

export interface TelemetryFieldSpec {
  /** Field data type as emitted. */
  type: "string" | "number";
  /** What the field is for. */
  purpose: string;
  /** Where the value comes from. */
  source: string;
  /** Can this field identify a person? */
  identifiesPerson: boolean;
}

export interface TelemetryEventSpec {
  /** When the hook emits this event. */
  emittedOn: string;
  fields: Record<string, TelemetryFieldSpec>;
}

const COMMON_FIELDS: Record<string, TelemetryFieldSpec> = {
  schema: {
    type: "number",
    purpose: "Telemetry schema version for this event",
    source: `constant ${TELEMETRY_SCHEMA_VERSION}`,
    identifiesPerson: false,
  },
  timestamp: {
    type: "string",
    purpose: "UTC time of the event (ISO-8601)",
    source: "date -u at emission",
    identifiesPerson: false,
  },
  dev_id: {
    type: "string",
    purpose:
      "Developer identifier. Empty unless telemetry.includeDevId is set. " +
      "'hashed' = SHA-256 of git email — PSEUDONYMOUS, not anonymous: the same " +
      "person always maps to the same hash, and anyone with the email list can " +
      "re-identify it. Treat as personal data under GDPR-style regimes.",
    source: "git config user.email (hashed or raw per config); '' when disabled",
    identifiesPerson: true,
  },
};

export const TELEMETRY_EVENTS: Record<string, TelemetryEventSpec> = {
  persona_invocation: {
    emittedOn: "SubagentStart / SubagentStop hook events",
    fields: {
      event: { type: "string", purpose: "Event type discriminator", source: "constant", identifiesPerson: false },
      persona_id: { type: "string", purpose: "Which persona ran (e.g. code-reviewer)", source: "hook payload agent_type", identifiesPerson: false },
      status: { type: "string", purpose: "'started' or 'completed'", source: "hook event name", identifiesPerson: false },
      ...COMMON_FIELDS,
    },
  },
  hook_execution: {
    emittedOn: "PostToolUse hook events (Edit/Write/Bash)",
    fields: {
      event: { type: "string", purpose: "Event type discriminator", source: "constant", identifiesPerson: false },
      persona_id: { type: "string", purpose: "Persona active when the tool ran", source: "hook payload agent_type", identifiesPerson: false },
      tool_name: { type: "string", purpose: "Which tool ran (name only — never its arguments)", source: "hook payload tool_name", identifiesPerson: false },
      ...COMMON_FIELDS,
    },
  },
  session_summary: {
    emittedOn: "SessionEnd hook event",
    fields: {
      event: { type: "string", purpose: "Event type discriminator", source: "constant", identifiesPerson: false },
      ...COMMON_FIELDS,
    },
  },
};

/** Field names that must NEVER appear in any telemetry event — content carriers. */
export const PROHIBITED_TELEMETRY_FIELDS = [
  "prompt", "response", "content", "input", "output", "arguments", "args",
  "file_path", "filePath", "path", "diff", "patch", "code", "text", "body",
];

/**
 * Build the machine-readable JSON Schema (draft-07) for telemetry events —
 * generated from TELEMETRY_EVENTS so it cannot contradict what the hooks
 * actually emit.
 *
 * v0.16.0 hardening: dist/schema/telemetry-event.v1.json used to be a second,
 * hand-written schema that required `persona_id` on every event (rejecting the
 * product's own `session_summary` events) and permitted fields the hooks never
 * emit. There is exactly one telemetry contract; this derives the validator
 * artifact from it.
 */
export function buildTelemetryJsonSchema(): {
  $schema: string;
  $id: string;
  title: string;
  description: string;
  oneOf: Array<{
    type: string;
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  }>;
} {
  const branches = Object.entries(TELEMETRY_EVENTS).map(([eventName, spec]) => {
    const properties: Record<string, unknown> = {};
    for (const [field, fieldSpec] of Object.entries(spec.fields)) {
      properties[field] =
        field === "event"
          ? { const: eventName, description: fieldSpec.purpose }
          : field === "schema"
            ? { const: TELEMETRY_SCHEMA_VERSION, description: fieldSpec.purpose }
            : { type: fieldSpec.type, description: fieldSpec.purpose };
    }
    return {
      type: "object",
      properties,
      // Hooks emit EXACTLY these shapes — every declared field is present on
      // every event (dev_id is "" when disabled), and nothing else is allowed.
      required: Object.keys(spec.fields),
      additionalProperties: false,
    };
  });

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://agentboot.dev/schema/telemetry-event/v1",
    title: "AgentBoot Telemetry Event",
    description:
      "Generated from the canonical telemetry event spec " +
      "(scripts/lib/telemetry-schema.ts). Every event the generated hooks " +
      "emit validates against exactly one branch; content-carrying fields " +
      "are structurally impossible (additionalProperties: false).",
    oneOf: branches,
  };
}

/** Build one illustrative sample event per type (for `telemetry-inspect`). */
export function sampleEvents(devIdMode: false | string): Record<string, Record<string, unknown>> {
  const dev = devIdMode === false ? "" :
    devIdMode === "hashed" ? "4f4a9…(sha-256 of git email — pseudonymous)" : "dev@example.com";
  const ts = "2026-01-01T00:00:00Z";
  return {
    persona_invocation: { event: "persona_invocation", persona_id: "code-reviewer", timestamp: ts, status: "completed", dev_id: dev, schema: TELEMETRY_SCHEMA_VERSION },
    hook_execution: { event: "hook_execution", persona_id: "code-reviewer", tool_name: "Edit", timestamp: ts, dev_id: dev, schema: TELEMETRY_SCHEMA_VERSION },
    session_summary: { event: "session_summary", timestamp: ts, dev_id: dev, schema: TELEMETRY_SCHEMA_VERSION },
  };
}
