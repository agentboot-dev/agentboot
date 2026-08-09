/**
 * The stdin-reading prelude shared by every generated hook.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * I1 bounded what a hook will read from stdin, and it did so by pasting the same
 * six lines of shell into four different hook templates in compile.ts. Two
 * defects then lived in all four copies at once:
 *
 *   R1-1  `${#INPUT}` counts CHARACTERS while the limit is expressed in BYTES.
 *         In a UTF-8 locale a multibyte payload (CJK, emoji, accented text) is
 *         over the byte cap long before it is over the character cap, so
 *         `head -c` truncated the payload mid-sequence, the comparison decided
 *         nothing was truncated, JSON.parse failed inside the node one-liner,
 *         the catch printed '', and the blocking hooks exited 0. The DLP scan
 *         and the denyTools gate both FAILED OPEN with no stdout and no stderr.
 *
 *   R1-2  `AGENTBOOT_MAX_HOOK_INPUT_BYTES` was interpolated straight into
 *         `$(( ))` and `[ -gt ]`. A non-numeric value makes both error under
 *         `set -u`, leaving INPUT one byte long and INPUT_TRUNCATED=0 — one
 *         environment variable silently disabled controls the product sells as
 *         non-overridable org policy.
 *
 * "Two lists that must agree will drift" applies to duplicated shell just as it
 * does to duplicated data. There is now one implementation; the four call sites
 * differ only in the sentences they say and the posture they take at the
 * boundary, which is exactly the axis on which they legitimately differ.
 */

/**
 * What a hook does when it cannot read its whole payload.
 *
 * `block`    — blocking gate (input scan, PreToolUse deny). An unscannable
 *              payload is an unscanned payload; refuse and exit 2.
 * `exit0`    — fail-open gate (Stop-hook output scan). A Stop hook that blocks
 *              on its own failure strands the session, so it stops — but says
 *              so on stderr, because an unscanned response must never look like
 *              a clean one.
 * `continue` — best-effort recorder (telemetry). Carry on with what was read,
 *              having said on stderr that the record is incomplete.
 */
export type HookOverCapAction = "block" | "exit0" | "continue";

export interface HookInputCapOptions {
  /** stderr sentence for the over-cap case, minus the "AgentBoot: " prefix. */
  overCapStderr: string;
  /** What to do at the boundary. */
  action: HookOverCapAction;
  /**
   * `reason` for the block JSON emitted on stdout. Required when
   * `action === "block"`, meaningless otherwise.
   */
  blockReason?: string;
}

/** The built-in cap: 1 MiB, larger than any legitimate prompt or tool payload. */
export const DEFAULT_MAX_HOOK_INPUT_BYTES = 1048576;

/**
 * The largest cap an operator may set — INT32_MAX.
 *
 * R1-2 validated the FORM of the operator's value (all digits, no leading zero)
 * and left its RANGE unchecked, which put the original fail-open back verbatim:
 * `AGENTBOOT_MAX_HOOK_INPUT_BYTES=9223372036854775807` is all digits with no
 * leading zero, so it passed, then overflowed `$((MAX + 1))` to a negative
 * number; `head -c -9223372036854775808` errors, INPUT is empty, INPUT_BYTES=0,
 * INPUT_TRUNCATED=0, the node one-liner's catch prints '', and a blocking gate
 * exits 0. Measured unpiped on a scratch hub: the DLP input scan went 2 → 0 on
 * `password: hunter2`, the PreToolUse deny gate went 2 → 0 on a denied WebFetch,
 * and the Stop-hook output scan went silent with no SKIPPED line.
 *
 * 2 GiB is far past any real payload, so nothing legitimate is refused, and it
 * is comfortably inside what `head -c` and shell arithmetic handle on every
 * supported platform. The bound is asserted in the shell by DIGIT COUNT first
 * (`${#VAR}`), because comparing an overflowing value with `-gt` is itself the
 * arithmetic that cannot be trusted here.
 */
export const MAX_ALLOWED_HOOK_INPUT_BYTES = 2147483647;

function blockJson(reason: string): string {
  // Single-quoted shell string; the reasons are authored here, not user input.
  if (reason.includes("'")) throw new Error(`hook block reason must not contain a single quote: ${reason}`);
  return `echo '${JSON.stringify({ decision: "block", reason })}'`;
}

/**
 * Emit the bounded-stdin prelude. The caller pastes the result into its hook
 * template; on return `INPUT` holds the payload and is known to be complete.
 */
export function hookInputCapPrelude(opts: HookInputCapOptions): string {
  if (opts.action === "block" && !opts.blockReason) {
    throw new Error("a blocking hook prelude must carry a blockReason");
  }

  // What the hook does when the operator's limit is unusable. A blocking gate
  // cannot safely guess a limit, so it refuses and names the value. A
  // non-blocking one falls back to the built-in default — degrading to a
  // working scan beats skipping the scan — and says so.
  const invalidAction =
    opts.action === "block"
      ? [
          `  echo "AgentBoot: AGENTBOOT_MAX_HOOK_INPUT_BYTES=\\"$MAX_HOOK_INPUT_BYTES\\" is not a usable byte count (want 1..${MAX_ALLOWED_HOOK_INPUT_BYTES}) — refusing to run an unbounded gate." >&2`,
          `  ${blockJson(
            `AgentBoot: AGENTBOOT_MAX_HOOK_INPUT_BYTES is not a usable byte count (want 1..${MAX_ALLOWED_HOOK_INPUT_BYTES}). Fix or unset it; the gate will not run with an unusable limit.`
          )}`,
          `  exit 2`,
        ].join("\n")
      : [
          `  echo "AgentBoot: AGENTBOOT_MAX_HOOK_INPUT_BYTES=\\"$MAX_HOOK_INPUT_BYTES\\" is not a usable byte count (want 1..${MAX_ALLOWED_HOOK_INPUT_BYTES}) — falling back to ${DEFAULT_MAX_HOOK_INPUT_BYTES}." >&2`,
          `  MAX_HOOK_INPUT_BYTES=${DEFAULT_MAX_HOOK_INPUT_BYTES}`,
        ].join("\n");

  // What a hook does when `head` itself fails — a class strictly larger than
  // "the operator's cap was silly": head unavailable, EINTR, a read error on the
  // fd. The old prelude could not see any of it, because
  // `INPUT=$(head -c "$N"; printf X)` takes the substitution's status from
  // printf (always 0) and `set -o pipefail` does not apply to a command LIST.
  // Any head failure therefore left INPUT empty, INPUT_TRUNCATED=0, and a
  // blocking gate at exit 0 — a component that failed and did not say so.
  const readFailAction =
    opts.action === "block"
      ? [
          `  echo "AgentBoot: could not read the hook payload from stdin (head exited $_ab_read_status) — refusing to run a gate on an unread payload." >&2`,
          `  ${blockJson(
            "AgentBoot: could not read the hook payload from stdin. The gate will not run on an unread payload."
          )}`,
          `  exit 2`,
        ].join("\n")
      : opts.action === "exit0"
        ? [
            `  echo "AgentBoot: could not read the hook payload from stdin (head exited $_ab_read_status) — output scan SKIPPED, this response was NOT scanned." >&2`,
            `  exit 0`,
          ].join("\n")
        : `  echo "AgentBoot: could not read the hook payload from stdin (head exited $_ab_read_status) — record is incomplete." >&2`;

  const overCapAction =
    opts.action === "block"
      ? [
          `  echo "AgentBoot: ${opts.overCapStderr}" >&2`,
          `  ${blockJson(opts.blockReason!)}`,
          `  exit 2`,
        ].join("\n")
      : opts.action === "exit0"
        ? [`  echo "AgentBoot: ${opts.overCapStderr}" >&2`, `  exit 0`].join("\n")
        : `  echo "AgentBoot: ${opts.overCapStderr}" >&2`;

  return `# I1: bound what a hook will read from stdin.
#
# INPUT=$(cat) read an unbounded payload into a shell variable. A hook runs on
# every prompt / tool call on a developer's machine, so an oversized payload is
# a memory and latency problem on the machine's critical path.
#
# The cap is deliberately generous (1 MiB) — larger than any legitimate prompt or
# tool payload — and the over-cap ACTION follows each hook's own declared
# posture rather than inventing a new one:
#   * blocking hooks (input scan, deny-tools) FAIL CLOSED. An unscannable
#     payload is an unscanned payload, and this is a DLP gate.
#   * non-blocking hooks (output scan, telemetry) degrade as they already do on
#     any other failure — but say so on stderr, never silently.
MAX_HOOK_INPUT_BYTES="\${AGENTBOOT_MAX_HOOK_INPUT_BYTES:-${DEFAULT_MAX_HOOK_INPUT_BYTES}}"
# The limit is operator-supplied and lands in \$(( )) and [ -gt ]. It is validated
# on BOTH axes, because validating one and not the other is how R1-2's fail-open
# came back:
#
#   FORM (R1-2)   — a non-numeric value makes \$(( )) and [ -gt ] error under
#                   \`set -u\`, leaving the payload unread and the gate exiting 0.
#                   A leading zero is rejected too: \$(( 0100 )) is octal 64 while
#                   [ 0100 -gt … ] is decimal 100, so the two would disagree.
#   RANGE (R3)    — 9223372036854775807 is all digits with no leading zero, so it
#                   passed the FORM check, then overflowed \$(( MAX + 1 )) to a
#                   negative number. \`head -c -9223372036854775808\` errors, INPUT
#                   is empty, INPUT_TRUNCATED=0, and the gate exits 0 — the exact
#                   fail-open R1-2 was written to close, restored through the code
#                   that closed it.
#
# The range test is by DIGIT COUNT first. Comparing a possibly-overflowing value
# with [ -gt ] is the same arithmetic that cannot be trusted here, and on a value
# past 19 digits it errors ('integer expression expected') — an error that the
# old prelude swallowed.
_ab_cap_invalid=0
case "$MAX_HOOK_INPUT_BYTES" in
  ''|*[!0-9]*|0*) _ab_cap_invalid=1 ;;
esac
if [ "$_ab_cap_invalid" -eq 0 ] && [ "\${#MAX_HOOK_INPUT_BYTES}" -gt 10 ]; then
  _ab_cap_invalid=1
fi
if [ "$_ab_cap_invalid" -eq 0 ] && [ "$MAX_HOOK_INPUT_BYTES" -gt ${MAX_ALLOWED_HOOK_INPUT_BYTES} ]; then
  _ab_cap_invalid=1
fi
if [ "$_ab_cap_invalid" -eq 1 ]; then
${invalidAction}
fi
# R1-1: measure BYTES, not characters. \${#INPUT} is a character count in a UTF-8
# locale, so a multibyte payload sailed past a byte limit, got truncated by
# \`head -c\`, failed to parse, and was allowed through. The \`printf X\` sentinel
# preserves trailing newlines that \$( ) strips, so the count is of exactly what
# \`head\` returned.
#
# \`head && printf\` (not \`head; printf\`): with \`;\` the substitution's status is
# printf's — always 0 — so EVERY head failure was invisible. With \`&&\` the status
# is head's whenever head fails, and printf's (0) only when head succeeded.
_ab_read_status=0
INPUT=$(head -c "$((MAX_HOOK_INPUT_BYTES + 1))" && printf X) || _ab_read_status=$?
# Backstop for a head that fails with status 0: the sentinel is missing, so the
# read did not complete.
case "$INPUT" in
  *X) INPUT="\${INPUT%X}" ;;
  *) if [ "$_ab_read_status" -eq 0 ]; then _ab_read_status=1; fi ;;
esac
if [ "$_ab_read_status" -ne 0 ]; then
${readFailAction}
fi
INPUT_BYTES=$(printf '%s' "$INPUT" | wc -c | tr -d '[:space:]')
INPUT_TRUNCATED=0
if [ "$INPUT_BYTES" -gt "$MAX_HOOK_INPUT_BYTES" ]; then INPUT_TRUNCATED=1; fi
if [ "$INPUT_TRUNCATED" -eq 1 ]; then
${overCapAction}
fi`;
}
