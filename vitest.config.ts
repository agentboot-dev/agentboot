import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests share dist/ and repos.json — run files sequentially to avoid contention
    fileParallelism: false,
    // Isolate the global hub registry (~/.agentboot) into a temp dir so tests
    // never pollute the developer's real registry. See tests/setup.ts.
    setupFiles: ["./tests/setup.ts"],
    // Many tests spawn tsx subprocesses (CLI/compile/sync integration); the 5s
    // default produced repeated Windows-runner timeout flakes on tests that are
    // deterministic but slow to spawn. Headroom, not slack — fast tests are unaffected.
    testTimeout: 20_000,
  },
});
