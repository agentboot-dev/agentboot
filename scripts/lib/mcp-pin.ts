/**
 * v0.19.0: MCP tool-definition digest pinning (the rug-pull defense).
 *
 * A version/identity pin (command + args, or url) fixes WHICH server runs, but
 * a mutable server — a remote endpoint, or a package that resolves prompts at
 * runtime — can change its tool names, descriptions, and input schemas under
 * the same identity. Tool descriptions are injected into the model's context,
 * so a silent description change is a prompt-injection channel. The defense is
 * a content digest over the full tools/list surface, recorded at approval time
 * (`agentboot mcp-pin`) and re-hashed at use time (`agentboot mcp-verify`).
 *
 * This is a deliberately minimal MCP client — initialize /
 * notifications/initialized / tools/list over stdio (newline-delimited
 * JSON-RPC) or streamable HTTP — with no SDK dependency. On any transport
 * failure it returns { error }; it NEVER fabricates tool definitions.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "./provenance.js";
import type { McpServerEntry } from "./config.js";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** Hard ceiling on how long a fetch may take, spawn-to-answer. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Bounded stdout buffer — a misbehaving server cannot balloon memory. */
const MAX_STDOUT_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Digest computation
// ---------------------------------------------------------------------------

/**
 * Sort key for a tool definition: its `name` when present, otherwise its
 * canonical serialization (so malformed entries still sort deterministically).
 */
function toolSortKey(tool: unknown): string {
  if (tool !== null && typeof tool === "object" && !Array.isArray(tool)) {
    const name = (tool as Record<string, unknown>)["name"];
    if (typeof name === "string") return name;
  }
  return canonicalize(tool);
}

/**
 * sha256 over a canonicalized (recursively key-sorted, deterministic) JSON
 * serialization of the tools array, sorted by tool name. Key order inside a
 * tool definition and the order the server returns tools in are both
 * non-semantic; neither perturbs the digest.
 */
export function computeToolsDigest(tools: unknown[]): string {
  const sorted = [...tools].sort((a, b) => {
    const ka = toolSortKey(a);
    const kb = toolSortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return createHash("sha256").update(canonicalize(sorted)).digest("hex");
}

/**
 * Per-tool hashes (name → sha256 of the canonicalized single definition).
 * These are what make a digest mismatch ACTIONABLE — they let verify name
 * which tools were added/removed/changed instead of just "something differs".
 */
export function computePerToolHashes(tools: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tool of tools) {
    out[toolSortKey(tool)] = createHash("sha256").update(canonicalize(tool)).digest("hex");
  }
  return out;
}

/** Diff two per-tool hash maps into named added/removed/changed lists. */
export function diffToolHashes(
  baseline: Record<string, string>,
  current: Record<string, string>
): { added: string[]; removed: string[]; changed: string[] } {
  const added = Object.keys(current).filter((n) => !(n in baseline)).sort();
  const removed = Object.keys(baseline).filter((n) => !(n in current)).sort();
  const changed = Object.keys(current)
    .filter((n) => n in baseline && baseline[n] !== current[n])
    .sort();
  return { added, removed, changed };
}

// ---------------------------------------------------------------------------
// Minimal MCP client
// ---------------------------------------------------------------------------

export interface FetchOptions {
  /** Override the 15s default — primarily for tests. */
  timeoutMs?: number;
}

export type FetchResult = { tools: unknown[] } | { error: string };

function clientVersion(): string {
  try {
    const pkgPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"
    );
    const version = (JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string }).version;
    return version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function jsonRpcLine(msg: Record<string, unknown>): string {
  return JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n";
}

function initializeParams(): Record<string, unknown> {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "agentboot-mcp-pin", version: clientVersion() },
  };
}

/**
 * Fetch the server's live tool definitions over its declared transport.
 * stdio when the entry has a command; streamable HTTP when it has a url.
 * Returns { error } on ANY failure — a pin must anchor to what the server
 * actually said, never to a guess.
 */
export async function fetchToolDefinitions(
  entry: McpServerEntry,
  opts: FetchOptions = {}
): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (entry.command) return fetchStdio(entry.command, entry.args ?? [], timeoutMs);
  if (entry.url) return fetchHttp(entry.url, timeoutMs);
  return { error: `server "${entry.name}" has neither a command nor a url — nothing to connect to` };
}

// ---- stdio transport (newline-delimited JSON-RPC) --------------------------

function fetchStdio(command: string, args: string[], timeoutMs: number): Promise<FetchResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      killSignal: "SIGKILL",
    });

    let settled = false;
    function finish(r: FetchResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      resolve(r);
    }

    const timer = setTimeout(
      () => finish({ error: `timed out after ${timeoutMs}ms waiting for the server's MCP response` }),
      timeoutMs
    );

    child.on("error", (err) => finish({ error: `failed to spawn "${command}": ${err.message}` }));
    child.on("exit", (code, signal) => {
      if (!settled) {
        finish({ error: `server exited (${signal ?? `code ${String(code)}`}) before answering tools/list` });
      }
    });
    // EPIPE after we kill the child, or after a failed spawn — not actionable.
    child.stdin.on("error", () => { /* ignore */ });
    // Server stderr is diagnostics for humans; we drain it and never parse it.
    child.stderr.on("data", () => { /* drained */ });

    function handleMessage(msg: Record<string, unknown>): void {
      if (msg["id"] === 1) {
        if (msg["error"] !== undefined) {
          finish({ error: `initialize rejected: ${JSON.stringify(msg["error"])}` });
          return;
        }
        try {
          child.stdin.write(jsonRpcLine({ method: "notifications/initialized" }));
          child.stdin.write(jsonRpcLine({ id: 2, method: "tools/list", params: {} }));
        } catch (e) {
          finish({ error: `failed writing to server stdin: ${e instanceof Error ? e.message : String(e)}` });
        }
      } else if (msg["id"] === 2) {
        if (msg["error"] !== undefined) {
          finish({ error: `tools/list rejected: ${JSON.stringify(msg["error"])}` });
          return;
        }
        const result = msg["result"];
        if (result === null || typeof result !== "object") {
          finish({ error: "tools/list response carried no result object" });
          return;
        }
        const tools = (result as Record<string, unknown>)["tools"];
        if (!Array.isArray(tools)) {
          finish({ error: "tools/list response carried no result.tools array" });
          return;
        }
        finish({ tools });
      }
      // Anything else (server-initiated requests, notifications) is ignored.
    }

    let buf = "";
    let received = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_STDOUT_BYTES) {
        finish({ error: `server stdout exceeded the ${MAX_STDOUT_BYTES / (1024 * 1024)}MB buffer bound` });
        return;
      }
      buf += chunk.toString("utf-8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(line);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
          msg = parsed as Record<string, unknown>;
        } catch {
          continue; // non-JSON stdout noise — skip the line, keep listening
        }
        handleMessage(msg);
        if (settled) return;
      }
    });

    try {
      child.stdin.write(jsonRpcLine({ id: 1, method: "initialize", params: initializeParams() }));
    } catch (e) {
      finish({ error: `failed writing to server stdin: ${e instanceof Error ? e.message : String(e)}` });
    }
  });
}

// ---- streamable HTTP transport ---------------------------------------------

/**
 * Extract the data payload of the first SSE event in a body
 * (`data:` lines joined with \n, terminated by a blank line).
 */
function parseSseData(body: string): string | null {
  const data: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""));
    } else if (line.trim() === "" && data.length > 0) {
      break; // end of the first event
    }
  }
  return data.length > 0 ? data.join("\n") : null;
}

/** Parse a streamable-HTTP response body: plain JSON or a single SSE event. */
function parseJsonRpcBody(
  body: string,
  contentType: string | null
): { message: Record<string, unknown> } | { error: string } {
  let text: string | null = body;
  if ((contentType ?? "").includes("text/event-stream")) {
    text = parseSseData(body);
    if (text === null) return { error: "SSE response body contained no data: event" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Content-type was misleading or absent — try SSE framing as a fallback.
    const sse = parseSseData(body);
    if (sse === null) return { error: "response body is neither JSON nor a single SSE data: event" };
    try {
      parsed = JSON.parse(sse);
    } catch {
      return { error: "SSE data: payload is not valid JSON" };
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "response body is not a JSON-RPC message object" };
  }
  return { message: parsed as Record<string, unknown> };
}

async function fetchHttp(rawUrl: string, timeoutMs: number): Promise<FetchResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: `invalid url "${rawUrl}"` };
  }
  if (url.protocol !== "https:") {
    return { error: `refusing non-https url "${rawUrl}" — tool definitions fetched over cleartext cannot anchor a digest pin` };
  }

  const baseHeaders: Record<string, string> = {
    "accept": "application/json, text/event-stream",
    "content-type": "application/json",
  };

  try {
    const initRes = await fetch(url, {
      method: "POST",
      headers: baseHeaders,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams() }),
    });
    if (!initRes.ok) return { error: `initialize POST returned HTTP ${initRes.status}` };
    const initParsed = parseJsonRpcBody(await initRes.text(), initRes.headers.get("content-type"));
    if ("error" in initParsed) return initParsed;
    if (initParsed.message["error"] !== undefined) {
      return { error: `initialize rejected: ${JSON.stringify(initParsed.message["error"])}` };
    }

    // Streamable HTTP session continuity: echo the session id if one was issued.
    const listHeaders: Record<string, string> = { ...baseHeaders };
    const sessionId = initRes.headers.get("mcp-session-id");
    if (sessionId) listHeaders["mcp-session-id"] = sessionId;

    const listRes = await fetch(url, {
      method: "POST",
      headers: listHeaders,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    if (!listRes.ok) return { error: `tools/list POST returned HTTP ${listRes.status}` };
    const listParsed = parseJsonRpcBody(await listRes.text(), listRes.headers.get("content-type"));
    if ("error" in listParsed) return listParsed;
    if (listParsed.message["error"] !== undefined) {
      return { error: `tools/list rejected: ${JSON.stringify(listParsed.message["error"])}` };
    }
    const result = listParsed.message["result"];
    if (result === null || typeof result !== "object") {
      return { error: "tools/list response carried no result object" };
    }
    const tools = (result as Record<string, unknown>)["tools"];
    if (!Array.isArray(tools)) return { error: "tools/list response carried no result.tools array" };
    return { tools };
  } catch (e) {
    return { error: `HTTP transport failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Pin / verify
// ---------------------------------------------------------------------------

export interface PinResult {
  digest: string;
  toolCount: number;
  /** ISO datetime the pin was taken (becomes toolsDigestRecordedAt). */
  recordedAt: string;
  /** name → sha256, the baseline that makes future mismatches nameable. */
  toolHashes: Record<string, string>;
}

export async function pinServer(
  entry: McpServerEntry,
  opts: FetchOptions = {}
): Promise<PinResult | { error: string }> {
  const fetched = await fetchToolDefinitions(entry, opts);
  if ("error" in fetched) return fetched;
  return {
    digest: computeToolsDigest(fetched.tools),
    toolCount: fetched.tools.length,
    recordedAt: new Date().toISOString(),
    toolHashes: computePerToolHashes(fetched.tools),
  };
}

export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
  toolCount: number;
  added: string[];
  removed: string[];
  changed: string[];
}

export interface VerifyOptions extends FetchOptions {
  /**
   * Per-tool baseline hashes recorded at pin time (from the pin sidecar).
   * Without it a mismatch is still detected via the aggregate digest, but the
   * added/removed/changed lists cannot be populated — the aggregate sha256 is
   * not invertible into per-tool state.
   */
  baselineToolHashes?: Record<string, string>;
}

/**
 * Re-fetch the server's live tool definitions, re-hash, and compare against
 * the recorded toolsDigest. On mismatch, diff per-tool against the baseline
 * hashes (when available) so the output names the offending tools.
 */
export async function verifyServer(
  entry: McpServerEntry,
  opts: VerifyOptions = {}
): Promise<VerifyResult | { error: string }> {
  if (!entry.toolsDigest) {
    return { error: `server "${entry.name}" has no recorded toolsDigest — run \`agentboot mcp-pin --server ${entry.name} --write\` first` };
  }
  const fetched = await fetchToolDefinitions(entry, opts);
  if ("error" in fetched) return fetched;

  const actual = computeToolsDigest(fetched.tools);
  const ok = actual === entry.toolsDigest;
  let added: string[] = [];
  let removed: string[] = [];
  let changed: string[] = [];
  if (!ok && opts.baselineToolHashes) {
    const diff = diffToolHashes(opts.baselineToolHashes, computePerToolHashes(fetched.tools));
    added = diff.added;
    removed = diff.removed;
    changed = diff.changed;
  }
  return { ok, expected: entry.toolsDigest, actual, toolCount: fetched.tools.length, added, removed, changed };
}

// ---------------------------------------------------------------------------
// Pin sidecar (agentboot.mcp-pins.json, next to the hub config)
// ---------------------------------------------------------------------------
//
// The config carries only the aggregate toolsDigest (small, reviewable, the
// enforcement anchor). The per-tool hashes that make a mismatch nameable live
// in this sidecar, written by `mcp-pin --write` and read by `mcp-verify`.
// Losing the sidecar degrades verify's DIAGNOSTICS, never its DETECTION.

export interface PinSidecarEntry {
  digest: string;
  recordedAt: string;
  toolHashes: Record<string, string>;
}

export type PinSidecar = Record<string, PinSidecarEntry>;

export function pinSidecarPath(configPath: string): string {
  return path.join(path.dirname(configPath), "agentboot.mcp-pins.json");
}

export function loadPinSidecar(sidecarPath: string): PinSidecar {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(sidecarPath, "utf-8"));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PinSidecar;
    }
  } catch {
    /* absent or unreadable — verify still works, just without named diffs */
  }
  return {};
}

export function savePinSidecar(sidecarPath: string, sidecar: PinSidecar): void {
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + "\n");
}
