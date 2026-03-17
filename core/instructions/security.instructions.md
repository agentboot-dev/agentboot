---
description: AgentBoot security guardrails — active on sensitive file paths
applyTo: "**/*.env*, **/secrets/**, **/auth/**, **/crypto/**, **/keys/**, **/tokens/**, **/credentials/**"
---

# Security Instructions

These instructions activate on files that are likely to contain security-sensitive
content: authentication, cryptography, secrets management, and credential handling.
They define a higher standard of scrutiny for these paths.

---

## Credentials and Secrets

**Never suggest hardcoded credentials.** Passwords, API keys, tokens, certificates,
and connection strings must not appear as literal values in source code, regardless
of the environment they are intended for. This applies to:

- Hardcoded strings that look like secrets (high-entropy values, "password", "secret",
  "apikey", "token", "key" in variable names)
- Default credentials in configuration files shipped with the codebase
- Credentials in comments, even if commented out
- Test credentials that are the same values as production credentials

**The correct pattern is always external configuration.** Environment variables,
a secrets manager, or a vault are the accepted patterns. When reviewing code that
hardcodes a credential, flag it as CRITICAL regardless of the apparent environment.
"This is only for local dev" is not a safe rationale — local dev patterns get committed,
copied, and promoted.

**Flag secrets in the wrong place.** Even when a value is loaded from the environment
correctly, flag it if it is logged, included in error messages, serialized to disk, or
returned in an API response. Correct loading is necessary but not sufficient.

---

## Insecure Defaults

Flag insecure defaults, even when they are technically valid. Defaults that are insecure
in production create risk when they are not overridden, which happens more often than
intended. The standard is: the default should be the secure choice, and the override
should require explicit intention.

Common insecure defaults to flag:

- TLS verification disabled by default (`rejectUnauthorized: false`, `verify=False`,
  `-k` / `--insecure` in curl equivalents)
- CORS configured to allow all origins (`*`) in non-development code
- Authentication or rate limiting disabled by default in middleware
- Debug mode or verbose logging enabled in a configuration that ships to production
- Cookie security flags (`httpOnly`, `secure`, `sameSite`) absent or set to insecure
  values
- Session tokens with no expiry or an impractically long expiry
- Cryptographic operations with a hardcoded or static initialization vector

---

## Cryptography

**Recommend established libraries over custom implementations.** Do not suggest
implementing cryptographic primitives (hashing, encryption, signing, key derivation)
from scratch, and flag any custom implementation you encounter. The standard advice
is to use the platform's built-in cryptographic library or a well-vetted third-party
library maintained by specialists.

**Flag deprecated or weak algorithms.** When you see these, flag them as ERROR or
CRITICAL depending on what they protect:

- Hash functions: MD5 and SHA-1 are broken for security purposes. Use SHA-256 or higher.
- Symmetric encryption: DES and 3DES are deprecated. Use AES-256-GCM.
- Asymmetric encryption/signing: RSA below 2048 bits is insufficient. Prefer 4096 or
  elliptic curve (P-256, X25519, Ed25519).
- Key derivation: MD5 or SHA-1 based KDFs. Use PBKDF2 (with SHA-256), bcrypt, scrypt,
  or Argon2 for password hashing.
- Random number generation: `Math.random()` or any non-cryptographic RNG for security
  purposes. Use `crypto.getRandomValues()` (browser), `crypto.randomBytes()` (Node.js),
  or the platform equivalent.

**Flag ECB mode.** AES-ECB does not use an initialization vector and leaks patterns in
the plaintext. Always use a mode that includes an IV (GCM, CBC, CTR).

**Flag static or reused IVs.** An initialization vector must be unique per encryption
operation. A hardcoded IV or one that is reused across operations defeats the purpose
of the IV. Flag any IV that is not generated freshly for each encryption call.

---

## Injection Risks

**SQL injection.** Flag any query construction that concatenates user-supplied input
into a SQL string. Parameterized queries and prepared statements are the required pattern.
ORMs that construct queries from untrusted input without parameterization are also
vulnerable. Flag them.

**Command injection.** Flag any use of `exec`, `spawn`, `system`, `popen`, or equivalent
functions that passes unsanitized user input as part of a shell command. The preferred
pattern is to use a library that handles the operation natively, or to use argument
arrays (rather than shell strings) when invoking subprocesses.

**Path traversal.** Flag any file path that is constructed from user input without
canonicalization and containment. The pattern `path.join(baseDir, userInput)` is
insufficient if the result is not verified to still be under `baseDir` after resolution.
A `..` in the user input can escape the intended directory.

**Template injection.** Flag any template rendering that passes user-controlled strings
as the template itself rather than as data into a fixed template. Server-side template
injection can lead to arbitrary code execution.

**Prototype pollution (JavaScript/TypeScript).** Flag any pattern that merges or assigns
properties from user-supplied objects without key validation, particularly when merging
into plain objects or class prototypes.

---

## Input Validation

**Validate at system boundaries.** Input should be validated at the point it enters
the system: API handlers, message queue consumers, file parsers, webhook receivers.
Internal functions that receive already-validated data can be more trusting, but the
boundary must enforce constraints.

The elements to validate at each boundary:

- **Type:** Is the value the type the handler expects?
- **Shape:** Does the object have the fields the handler requires?
- **Range:** Is a numeric value within the expected range? Is a string within the
  expected length bounds?
- **Enumeration:** Is a string value one of the allowed values?
- **Format:** Does the value match the expected format (email, UUID, date)?

**Reject early.** Validation failures should return an error immediately, before any
processing occurs. Do not partially process a request and then fail validation.

**Sanitize for the output context, not the input context.** A string that is safe to
store in a database may not be safe to render in HTML, include in a shell command, or
embed in a SQL query. Sanitize or escape for the specific context where the value will
be used, not at the input stage.

---

## Authentication and Authorization

**Verify authentication before authorization.** A route that checks permissions without
first verifying that the requester is authenticated will grant unauthenticated access
to anyone who can guess a valid permission check value.

**Check authorization at the resource level, not just the route level.** A check that
a user is authenticated to access "orders" does not verify that they are authorized to
access order #12345. Object-level authorization must be checked per resource.

**Flag missing authorization checks.** When reviewing code that retrieves, modifies, or
deletes a resource, verify that the code checks whether the requesting user is permitted
to perform that operation on that specific resource. Missing checks here are a CRITICAL
finding.

**JWT handling.** When reviewing JWT validation:
- The expected algorithm must be fixed server-side. Do not read the algorithm from the
  token header.
- The signature must be verified before trusting any claim in the payload.
- Expiry (`exp`) and not-before (`nbf`) claims must be checked.
- The audience (`aud`) and issuer (`iss`) claims should be validated against expected
  values.

**Session security.** Session tokens should be:
- Cryptographically random and of sufficient length (128 bits minimum)
- Stored in `httpOnly`, `secure`, `sameSite=Strict` cookies when possible
- Invalidated server-side on logout (not just cleared client-side)
- Rotated after privilege escalation (login, role change, sensitive action)

---

## Dependency Security

When reviewing `package.json`, `requirements.txt`, `pom.xml`, `go.mod`, or equivalent
dependency files:

- Flag dependencies with known vulnerabilities if a patched version is available.
  This is an ERROR, not a WARN.
- Flag dependencies that are unmaintained (no releases in two or more years) in
  security-sensitive code paths. Note this as a WARN with a recommendation to evaluate
  alternatives.
- Flag unusually broad permission scopes if the dependency is a browser extension,
  mobile SDK, or similar component where permissions are declared.
- Do not flag vulnerabilities without linking the CVE identifier if one is available.
  Vague "this has security issues" flags are not actionable.
