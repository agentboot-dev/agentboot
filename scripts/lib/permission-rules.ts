/**
 * Claude Code permission-rule VERB semantics.
 *
 * `claude.permissions` is a pass-through: whatever the hub author writes is
 * validated for SHAPE (allow/deny are arrays), signed into the manifest, and
 * distributed to the managed-settings channel verbatim. Nothing inspected the
 * rule VERBS, so a rule the platform never consults compiled clean, passed
 * `validate --strict`, and shipped as a control that enforces nothing — the
 * exact failure the product exists to catch. One instance of this is live in a
 * beta adopter's policy, protecting `.env` files and enforcing nothing.
 *
 * ── Ground truth (verified, not assumed) ────────────────────────────────────
 * Claude Code's own settings validator carries this rule. Read out of the
 * shipping binary (v2.1.226, the same build the hook-matcher regex semantics in
 * compile.ts were established against):
 *
 *     if (o.ruleContent !== undefined) {
 *       let a = o.toolName === "Write" || o.toolName === "NotebookEdit" ||
 *               o.toolName === "MultiEdit" ? "Edit"
 *             : o.toolName === "Glob"     ? "Read"
 *             : undefined;
 *       if (a !== undefined && !o.ruleContent.includes(":*"))
 *         return { valid: true, warning:
 *           `${rule} is not matched by file permission checks — only ${a}(path)`
 *           + ` rules are. Use ${a}(${content}) instead (${a} rules cover all`
 *           + ` file-${a === "Edit" ? "editing" : "reading"} tools).` };
 *     }
 *
 * So the mechanism is NOT "Write creates new files while Edit modifies existing
 * ones" — that framing would leave `Write(path)` partially effective. The file
 * permission check consults exactly two rule verbs, `Edit(path)` and
 * `Read(path)`, and each covers its whole tool family. A `Write(path)`,
 * `MultiEdit(path)` or `NotebookEdit(path)` rule is matched by nothing at all,
 * in either direction: an inert `deny` blocks no write, an inert `allow`
 * pre-approves no write.
 *
 * Claude Code only *warns* about this, in an interactive settings edit. A hub
 * author never sees that warning: the rule is authored in
 * `agentboot.config.json` and reaches `managed-settings.json` through the
 * compiler. AgentBoot is the only surface positioned to object, which is why
 * the deny form is an error here rather than a warning.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * This is the VERB check and nothing more. Validating rule *content* generally
 * (do the globs match anything, is the path reachable, does the platform honour
 * the specifier shape) is a different and much larger piece of work, and is
 * deliberately not started here.
 *
 * Lives in lib/ rather than in validate.ts because `build` and `sync` never
 * call validate — the same reason hook-safety.ts exists. A check only validate
 * can reach is a check the pipeline routes around.
 */

/**
 * Rule verbs the file-permission check never consults, mapped to the verb that
 * covers the same tool family. Keys are Claude Code tool names, exactly as they
 * appear in a `Tool(specifier)` rule.
 */
export const INERT_PATH_RULE_VERBS: Readonly<Record<string, string>> = Object.freeze({
  Write: "Edit",
  MultiEdit: "Edit",
  NotebookEdit: "Edit",
  Glob: "Read",
});

export interface ParsedPermissionRule {
  /** Tool name — the text before `(`, or the whole rule when unparenthesised. */
  toolName: string;
  /** Specifier inside the parens; `undefined` for a bare `Tool` rule. */
  ruleContent: string | undefined;
}

/**
 * Split `Tool(specifier)` into its parts.
 *
 * A BARE `Tool` rule (no parens) is deliberately reported with
 * `ruleContent: undefined` and is never inert — `deny: ["Write"]` blocks the
 * Write tool outright and works fine. Only the path-scoped form is dead.
 *
 * Returns null for a rule that is not of the form `Tool` or `Tool(...)` — a
 * malformed rule is a different defect and this function does not invent an
 * opinion about it.
 */
export function parsePermissionRule(rule: string): ParsedPermissionRule | null {
  const trimmed = rule.trim();
  if (trimmed.length === 0) return null;

  const open = trimmed.indexOf("(");
  if (open === -1) return { toolName: trimmed, ruleContent: undefined };
  if (!trimmed.endsWith(")")) return null;
  const toolName = trimmed.slice(0, open).trim();
  if (toolName.length === 0) return null;
  return { toolName, ruleContent: trimmed.slice(open + 1, -1) };
}

export interface InertRuleFinding {
  /** The rule as authored. */
  rule: string;
  /** The verb that is not consulted. */
  toolName: string;
  /** The verb that is. */
  effectiveTool: string;
  /** The same rule rewritten with the effective verb. */
  suggestion: string;
  /** Ready-to-print explanation; identical wording for validate and compile. */
  message: string;
}

/**
 * Find the semantically inert rules in one `allow`/`deny` list.
 *
 * `where` names the config location (e.g. `claude.permissions.deny`) so the
 * message points at the key the author has to edit, not just at the rule.
 */
export function inertPermissionRules(
  rules: readonly string[] | undefined,
  where: string,
): InertRuleFinding[] {
  const findings: InertRuleFinding[] = [];
  // A non-array here is a SHAPE defect other checks own. Iterating it would
  // walk a string character by character and invent findings, so refuse it:
  // this check has one job and reporting nothing is the honest answer.
  if (!Array.isArray(rules)) return findings;
  for (const rule of rules) {
    if (typeof rule !== "string") continue;
    const parsed = parsePermissionRule(rule);
    if (!parsed || parsed.ruleContent === undefined) continue;
    // `:*` is Bash prefix syntax, not a path — Claude Code exempts it from this
    // warning and so do we. Whether it is legal on a file tool at all is that
    // validator's business, not this check's.
    if (parsed.ruleContent.includes(":*")) continue;
    const effectiveTool = INERT_PATH_RULE_VERBS[parsed.toolName];
    if (!effectiveTool) continue;

    const suggestion = `${effectiveTool}(${parsed.ruleContent})`;
    const family = effectiveTool === "Edit" ? "editing" : "reading";
    findings.push({
      rule,
      toolName: parsed.toolName,
      effectiveTool,
      suggestion,
      message:
        `${where}: "${rule}" is semantically inert — Claude Code's file permission check ` +
        `never consults ${parsed.toolName}(path) rules, only ${effectiveTool}(path) rules, ` +
        `so this rule matches nothing and enforces nothing. Use "${suggestion}" instead ` +
        `(${effectiveTool} rules cover every file-${family} tool, including ${parsed.toolName}).`,
    });
  }
  return findings;
}

/**
 * Every permission list a hub config can declare, as `[where, rules]` pairs.
 *
 * Both call sites read the surface from here so a future permission-bearing key
 * cannot be picked up by one and missed by the other.
 */
export function permissionRuleLists(config: {
  claude?: { permissions?: { allow?: string[]; deny?: string[] } | undefined } | undefined;
  groups?: Record<string, { permissions?: { allow?: string[]; deny?: string[] } | undefined }> | undefined;
}): Array<{ where: string; kind: "allow" | "deny"; rules: string[] | undefined }> {
  const lists: Array<{ where: string; kind: "allow" | "deny"; rules: string[] | undefined }> = [
    { where: "claude.permissions.deny", kind: "deny", rules: config.claude?.permissions?.deny },
    { where: "claude.permissions.allow", kind: "allow", rules: config.claude?.permissions?.allow },
  ];
  for (const [name, group] of Object.entries(config.groups ?? {})) {
    lists.push({ where: `groups.${name}.permissions.deny`, kind: "deny", rules: group?.permissions?.deny });
    lists.push({ where: `groups.${name}.permissions.allow`, kind: "allow", rules: group?.permissions?.allow });
  }
  return lists.filter((l) => Array.isArray(l.rules));
}
