---
description: Healthcare baseline — day-to-day guardrails for health-data codebases
applyTo: "**"
---

# Healthcare Baseline Instructions

> **Disclaimer:** This starter pack provides generic engineering guardrails for
> health-data codebases. It does not establish HIPAA compliance or any regulatory
> posture; compliance is a property of your organization's overall program, not of
> any template.

You are working in a codebase that handles health data. These rules apply to every
session in this domain.

---

## Data in the session

- **Never introduce real patient data** into prompts, code, fixtures, logs,
  examples, comments, or documentation. Only a use explicitly approved through the
  organization's named approval process is an exception — and you should assume no
  such approval exists unless the user names it.
- **Minimum necessary:** when health data must be discussed or handled, use only
  the fields the task requires — never a full record for a one-field question.
- **Synthetic data only** in tests and examples: invented identifiers in the style
  of `MRN-000000`, invented people (`Alex Example`, `alex@example.com`), invented
  orgs (`acme-health`), and no combination of fields that could re-identify a real
  person.
- **If you cannot tell whether data is regulated health data, stop and ask a
  human** before processing, storing, or generating code around it.

## Code you write or review

- **Redact by default:** health-data fields must not appear in log lines, error
  messages, stack traces, or telemetry. Log identifiers only when required, and
  prefer opaque internal IDs over natural identifiers.
- **Audit data access:** reads, writes, and exports of health data emit a
  structured audit event (actor, record, action, timestamp). Flag paths that
  don't, and don't accept "middleware handles it" without evidence.
- **Check access control per record:** healthcare endpoints authenticate the
  caller and authorize access to the specific record — not just the route. Where
  consent applies, check and record it. Break-glass paths must be audited,
  time-bounded, and reviewable.
- **New data stores need a retention decision:** when code creates a store,
  cache, backup, or derived dataset of health data, flag that it needs an owner
  and a retention decision under the organization's retention schedule.
- **Treat exports as egress:** CSVs, report attachments, screenshots, and sample
  payloads leaving the system carry the same access-control and redaction
  requirements as the API — and examples shared in PRs or docs must be synthetic.

## When something is wrong

- If you encounter real patient data anywhere it should not be, stop, surface it
  to the user immediately, and do not copy it further — the human owns
  remediation.
- Prefer flagging a missing organizational policy (approval process, retention
  schedule, break-glass procedure) over inventing one.
