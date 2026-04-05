import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests share dist/ and repos.json — run files sequentially to avoid contention
    fileParallelism: false,
  },
});
