---
name: Quality feedback
about: Report bad or unexpected output from a persona
title: "quality: [persona-id] [brief description]"
labels: quality-feedback
assignees: ""
---

## Persona name

<!-- Which persona produced the bad output? e.g., code-reviewer, security-reviewer -->

## What you asked it to do

<!-- Describe what you asked the persona to do. Include the exact prompt or command
     if you can. If the input is large, include the most relevant portion. -->

**Prompt / invocation:**
```
[paste your prompt here]
```

**Input (if relevant):**
```
[paste the code, file, or context you gave it, or a representative excerpt]
```

## What it actually did

<!-- Describe what the persona produced. If the output was long, include the most
     relevant portion — the finding that was wrong, the section that was missing,
     the format that was broken, etc. -->

**Actual output:**
```
[paste the relevant portion of the output here]
```

## What you expected

<!-- Describe what you expected it to do instead. Be specific. "Better output" is
     not actionable. "The persona should have flagged the missing null check on line 14
     but instead flagged a style preference" is actionable. -->

## Claude Code version

<!-- Run `claude --version` and paste the output here. -->

## Trait weight or config (if known)

<!-- If you know which trait weight was active for this persona (HIGH / MEDIUM / LOW),
     include it here. If you modified any agentboot.config.json settings that might
     be relevant, include those too. -->

## Is this a regression?

<!-- Did this persona work correctly before and then stop working? If so, when did you
     last see it working correctly, and do you know of any changes (to Claude Code,
     to AgentBoot, to the persona file) that happened around that time? -->

- [ ] Yes, this worked correctly before
- [ ] No, this is a first-time deployment and it has never worked correctly
- [ ] Unknown

## Additional context

<!-- Anything else that would help reproduce or understand the issue. -->
