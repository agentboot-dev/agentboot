#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cli = join(__dirname, "..", "scripts", "cli.ts");

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", cli, ...process.argv.slice(2)],
  { stdio: "inherit", env: { ...process.env } }
);

process.exit(result.status ?? 1);
