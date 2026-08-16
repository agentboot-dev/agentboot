import { describe, it, expect } from "vitest";
import {
  PREDICATE_NAMESPACE, GOVERNANCE_IN_FORCE_V0_1, KNOWN_PREDICATES,
} from "../scripts/lib/attestation-predicate.js";

describe("attestation predicate namespace (XP2)", () => {
  it("is self-namespaced under a domain we control", () => {
    // Not an in-toto or SLSA URI: claiming someone else's namespace without
    // going through their process is exactly what makes a proposal unwelcome.
    expect(PREDICATE_NAMESPACE).toBe("https://agentboot.dev/attestation");
    expect(GOVERNANCE_IN_FORCE_V0_1.startsWith(PREDICATE_NAMESPACE)).toBe(true);
  });

  it("carries an explicit version segment", () => {
    // A predicate URI without a version cannot be evolved without breaking
    // every verifier that ever consumed it.
    expect(GOVERNANCE_IN_FORCE_V0_1).toMatch(/\/v\d+\.\d+$/);
  });

  it("is a stable literal — changing it is a breaking change", () => {
    // Pinned deliberately. This test failing means someone altered a durable
    // evidence contract; that should require deleting a test that says so.
    expect(GOVERNANCE_IN_FORCE_V0_1).toBe(
      "https://agentboot.dev/attestation/governance-in-force/v0.1"
    );
  });

  it("registers every known predicate", () => {
    expect(KNOWN_PREDICATES).toContain(GOVERNANCE_IN_FORCE_V0_1);
  });
});
