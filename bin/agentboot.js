#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cli = join(__dirname, "..", "scripts", "cli.ts");

// Resolve tsx from this package's own node_modules, not the user's cwd.
// When installed globally (npm -g, brew), Node resolves bare specifiers
// from cwd which fails. Using createRequire anchors resolution to this file.
const require = createRequire(import.meta.url);
const tsxPkgDir = dirname(require.resolve("tsx/package.json"));
const tsxEntry = join(tsxPkgDir, "dist", "esm", "index.mjs");

const result = spawnSync(
  process.execPath,
  ["--import", `file://${tsxEntry}`, cli, ...process.argv.slice(2)],
  { stdio: "inherit", env: { ...process.env } }
);

process.exit(result.status ?? 1);
