import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests share dist/ and repos.json — run files sequentially to avoid contention
    fileParallelism: false,
    // Isolate the global hub registry (~/.agentboot) into a temp dir so tests
    // never pollute the developer's real registry. See tests/setup.ts.
    setupFiles: ["./tests/setup.ts"],
  },
});
