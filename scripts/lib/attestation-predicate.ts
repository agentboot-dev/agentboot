/**
 * Attestation predicate namespace (XP2, pre-GA slice of the attestation work).
 *
 * WHY THIS EXISTS BEFORE THE ATTESTATION ITSELF
 * ---------------------------------------------
 * Attestations are DURABLE EVIDENCE. One signed at v1.0 may be presented years
 * later, so a later change to the predicate type means maintaining a compatible
 * verifier forever AND re-issuing across every spoke that verifies. The predicate
 * URI is a naming contract in the same class as the artifact identifier, and the
 * 1.0 tag is what freezes it.
 *
 * WHY SELF-NAMESPACED RATHER THAN PROPOSED UPSTREAM
 * ------------------------------------------------
 * Verification (2026-08-07) corrected two assumptions that had made an upstream
 * in-toto predicate proposal look cheap and obvious:
 *
 *   1. "The shape doesn't exist" — FALSE. in-toto's SVR predicate already records
 *      "artifact evaluated against policies, with the policies named", SCAI
 *      asserts arbitrary attributes, and an `agent-decision` RFC has been pending
 *      in adjacent space since 2026-05-19.
 *   2. "We are the only ones who need it" — FALSE, per the same finding.
 *
 * Every standards body gates on adoption evidence and staffed stewardship. A
 * proposal is the REWARD for adoption at scale, never the opening move — the same
 * lesson that removed the OpenTelemetry semantic-convention play from the
 * roadmap. Self-namespacing is fully conformant with the in-toto spec, requires
 * no permission, and leaves the upstream door open once there is usage to cite.
 *
 * SCOPE: this file names the contract. It does not sign, attest, or migrate —
 * that work is post-GA and gated on an unresolved signing-identity decision
 * (Fulcio publishes the signer's email to a permanent public transparency log).
 */

/** Stable namespace for AgentBoot-issued in-toto predicate types. */
export const PREDICATE_NAMESPACE = "https://agentboot.dev/attestation";

/**
 * "This governance content was in force, here, at this time."
 *
 * v0.1 while the payload shape settles. The MAJOR version in the URI is the
 * compatibility boundary a verifier keys on; additive fields do not bump it,
 * removed or re-meaning fields do.
 */
export const GOVERNANCE_IN_FORCE_V0_1 = `${PREDICATE_NAMESPACE}/governance-in-force/v0.1`;

/** Every predicate type this version of AgentBoot knows how to issue. */
export const KNOWN_PREDICATES = [GOVERNANCE_IN_FORCE_V0_1] as const;
