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
import { StringDecoder } from "node:string_decoder";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "./provenance.js";
import type { McpServerEntry } from "./config.js";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** Hard ceiling on how long a fetch may take, spawn-to-answer. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Bounded response buffer (stdio AND http) — a misbehaving server cannot balloon memory. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Safety bound on tools/list pagination — a server cannot loop us forever. */
const MAX_PAGES = 100;

/**
 * Minimal, secret-free environment for a spawned stdio server. A pin probes a
 * possibly-compromised server; handing it the full process environment (CI
 * tokens, cloud creds) is a ready exfil channel. Pass only OS essentials plus
 * whatever the entry explicitly declares (entry.env, "$VAR" expanded).
 */
function spawnEnv(entry: McpServerEntry): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "SYSTEMROOT", "windir", "PATHEXT", "LANG", "LC_ALL"];
  const base: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k] !== undefined) base[k] = process.env[k];
  for (const [k, v] of Object.entries(entry.env ?? {})) {
    base[k] = v.startsWith("$") ? (process.env[v.slice(1)] ?? "") : v;
  }
  return base;
}

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
    // Disambiguate duplicate tool names so two tools sharing a name do NOT
    // collapse to one map entry (which would hide one of them from the
    // added/removed/changed diff and could steer an operator into re-pinning a
    // rug-pulled surface). A collision suffixes "#2", "#3", … deterministically.
    const base = toolSortKey(tool);
    let key = base;
    let n = 2;
    while (key in out) key = `${base}#${n++}`;
    out[key] = createHash("sha256").update(canonicalize(tool)).digest("hex");
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
  if (entry.command) return fetchStdio(entry, timeoutMs);
  if (entry.url) return fetchHttp(entry.url, timeoutMs);
  return { error: `server "${entry.name}" has neither a command nor a url — nothing to connect to` };
}

/** Pull result.tools (array) + result.nextCursor (string|undefined) from a tools/list result. */
function readToolsPage(result: unknown): { tools: unknown[]; nextCursor: string | null } | { error: string } {
  if (result === null || typeof result !== "object") return { error: "tools/list response carried no result object" };
  const tools = (result as Record<string, unknown>)["tools"];
  if (!Array.isArray(tools)) return { error: "tools/list response carried no result.tools array" };
  const cursor = (result as Record<string, unknown>)["nextCursor"];
  return { tools, nextCursor: typeof cursor === "string" && cursor.length > 0 ? cursor : null };
}

// ---- stdio transport (newline-delimited JSON-RPC) --------------------------

function fetchStdio(entry: McpServerEntry, timeoutMs: number): Promise<FetchResult> {
  const command = entry.command!;
  const args = entry.args ?? [];
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      // Secret-free env — never hand a possibly-compromised server all of CI's
      // environment (see spawnEnv). Servers that need vars declare entry.env.
      env: spawnEnv(entry),
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

    // Pagination state: accumulate tools across every tools/list page until the
    // server stops returning a nextCursor. Hashing only page 1 would let a
    // rug-pull hide malicious tools on page 2 behind a passing digest.
    const accumulated: unknown[] = [];
    let listId = 2;
    let pages = 0;

    function requestList(cursor: string | null): void {
      try {
        child.stdin.write(jsonRpcLine({ id: listId, method: "tools/list", params: cursor ? { cursor } : {} }));
      } catch (e) {
        finish({ error: `failed writing to server stdin: ${e instanceof Error ? e.message : String(e)}` });
      }
    }

    function handleMessage(msg: Record<string, unknown>): void {
      if (msg["id"] === 1) {
        if (msg["error"] !== undefined) {
          finish({ error: `initialize rejected: ${JSON.stringify(msg["error"])}` });
          return;
        }
        try {
          child.stdin.write(jsonRpcLine({ method: "notifications/initialized" }));
        } catch (e) {
          finish({ error: `failed writing to server stdin: ${e instanceof Error ? e.message : String(e)}` });
          return;
        }
        requestList(null);
      } else if (msg["id"] === listId) {
        if (msg["error"] !== undefined) {
          finish({ error: `tools/list rejected: ${JSON.stringify(msg["error"])}` });
          return;
        }
        const page = readToolsPage(msg["result"]);
        if ("error" in page) { finish(page); return; }
        accumulated.push(...page.tools);
        pages++;
        if (page.nextCursor && pages < MAX_PAGES) {
          listId++;
          requestList(page.nextCursor);
        } else {
          finish({ tools: accumulated });
        }
      }
      // Anything else (server-initiated requests, notifications) is ignored.
    }

    const decoder = new StringDecoder("utf8");
    let buf = "";
    let received = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_RESPONSE_BYTES) {
        finish({ error: `server stdout exceeded the ${MAX_RESPONSE_BYTES / (1024 * 1024)}MB buffer bound` });
        return;
      }
      // Decode via StringDecoder so a multibyte UTF-8 codepoint split across two
      // chunk boundaries is not corrupted (which would make the digest of an
      // honest server non-deterministic and raise false rug-pull alarms).
      buf += decoder.write(chunk);
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

/**
 * Read a fetch Response body with a hard byte cap. `res.text()` buffers an
 * unbounded body — a hostile server could return gigabytes within the timeout
 * and exhaust memory. Stream instead and abort past MAX_RESPONSE_BYTES.
 */
async function readBodyBounded(res: Response, cap: number): Promise<{ body: string } | { error: string }> {
  if (!res.body) return { body: await res.text() };
  const reader = res.body.getReader();
  const decoder = new StringDecoder("utf8");
  let total = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      try { await reader.cancel(); } catch { /* already closed */ }
      return { error: `response body exceeded the ${cap / (1024 * 1024)}MB bound` };
    }
    out += decoder.write(Buffer.from(value));
  }
  out += decoder.end();
  return { body: out };
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
    const initBody = await readBodyBounded(initRes, MAX_RESPONSE_BYTES);
    if ("error" in initBody) return initBody;
    const initParsed = parseJsonRpcBody(initBody.body, initRes.headers.get("content-type"));
    if ("error" in initParsed) return initParsed;
    if (initParsed.message["error"] !== undefined) {
      return { error: `initialize rejected: ${JSON.stringify(initParsed.message["error"])}` };
    }

    // Streamable HTTP session continuity: echo the session id if one was issued.
    const listHeaders: Record<string, string> = { ...baseHeaders };
    const sessionId = initRes.headers.get("mcp-session-id");
    if (sessionId) listHeaders["mcp-session-id"] = sessionId;

    // Accumulate tools across paginated tools/list responses (nextCursor), same
    // as stdio — a digest over page 1 only is not a defense.
    const accumulated: unknown[] = [];
    let listId = 2;
    let cursor: string | null = null;
    for (let pages = 0; pages < MAX_PAGES; pages++) {
      const listRes = await fetch(url, {
        method: "POST",
        headers: listHeaders,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ jsonrpc: "2.0", id: listId, method: "tools/list", params: cursor ? { cursor } : {} }),
      });
      if (!listRes.ok) return { error: `tools/list POST returned HTTP ${listRes.status}` };
      const listBody = await readBodyBounded(listRes, MAX_RESPONSE_BYTES);
      if ("error" in listBody) return listBody;
      const listParsed = parseJsonRpcBody(listBody.body, listRes.headers.get("content-type"));
      if ("error" in listParsed) return listParsed;
      if (listParsed.message["error"] !== undefined) {
        return { error: `tools/list rejected: ${JSON.stringify(listParsed.message["error"])}` };
      }
      const page = readToolsPage(listParsed.message["result"]);
      if ("error" in page) return page;
      accumulated.push(...page.tools);
      if (!page.nextCursor) return { tools: accumulated };
      cursor = page.nextCursor;
      listId++;
    }
    return { tools: accumulated };
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
