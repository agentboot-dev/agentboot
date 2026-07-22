#!/usr/bin/env tsx
/**
 * Release version-string guard.
 *
 * The public site and docs hardcode the CURRENT release version in a few prose
 * locations (see scripts/version-strings.manifest.json). If a release bumps
 * package.json but forgets these, the site advertises a stale version — exactly
 * the drift that shipped v0.11.1's docs claiming a version npm didn't have.
 *
 * This checker enforces, for every file in the manifest:
 *   1. it contains `v<version>` at least `occurrences` times (nothing was missed), and
 *   2. it contains no OTHER patch of the same minor line (e.g. a leftover
 *      `v0.11.1` when releasing `v0.11.2`) — catches partial bumps.
 *
 * Version source: package.json, or `--version X.Y.Z` (release.yml passes the
 * resolved release version so the gate runs before the tag is cut).
 *
 * Dynamic surfaces that read package.json (website hero, announcement bar,
 * JSON-LD softwareVersion) are intentionally NOT listed — they cannot drift.
 * Future-milestone references (v1.0 / v1.0 GA) are conceptual, not tracked.
 *
 * Usage:
 *   tsx scripts/check-version-strings.ts                 # check against package.json
 *   tsx scripts/check-version-strings.ts --version 0.11.2
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

interface ManifestFile {
  path: string;
  occurrences: number;
  note?: string;
}
interface Manifest {
  versionSource: string;
  files: ManifestFile[];
}

function resolveVersion(): string {
  const argIdx = process.argv.indexOf("--version");
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return process.argv[argIdx + 1]!.replace(/^v/, "");
  }
  const pkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8")
  ) as { version: string };
  return pkg.version;
}

function main(): void {
  const version = resolveVersion();
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) {
    console.error(`✗ Not a semver version: "${version}"`);
    process.exit(1);
  }
  const [major, minor, patch] = [m[1], m[2], m[3]];

  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "scripts", "version-strings.manifest.json"),
      "utf-8"
    )
  ) as Manifest;

  console.log(`AgentBoot — version-string check (target v${version})\n`);

  const errors: string[] = [];
  const anyVersion = /v(\d+)\.(\d+)\.(\d+)/g;
  const currentToken = `v${version}`;

  for (const file of manifest.files) {
    const abs = path.join(repoRoot, file.path);
    if (!fs.existsSync(abs)) {
      errors.push(`${file.path}: file not found (manifest is stale)`);
      continue;
    }
    const content = fs.readFileSync(abs, "utf-8");

    // 1. current version present the expected number of times
    const count = content.split(currentToken).length - 1;
    if (count < file.occurrences) {
      errors.push(
        `${file.path}: expected ≥${file.occurrences} occurrence(s) of "${currentToken}", found ${count}` +
          (file.note ? ` — ${file.note}` : "")
      );
    }

    // 2a. no stale patch of the same minor line (v-prefixed)
    for (const match of content.matchAll(anyVersion)) {
      const [full, maj, min, pat] = match;
      if (maj === major && min === minor && pat !== patch) {
        errors.push(
          `${file.path}: stale version "${full}" of the current minor line — expected "${currentToken}"`
        );
      }
    }

    // 2b. no stale `agentboot@<version>` pin of ANY minor line — with or without
    // the v prefix. A CI template pinning `agentboot@0.15.0` while the release
    // is v0.19.0 evaded (2a) twice over: no v prefix AND a different minor. A
    // pinned agentboot version in a tracked file must be the current release.
    const agentbootPin = /agentboot@v?(\d+)\.(\d+)\.(\d+)/g;
    for (const match of content.matchAll(agentbootPin)) {
      const [full, maj, min, pat] = match;
      if (!(maj === major && min === minor && pat === patch)) {
        errors.push(
          `${file.path}: stale agentboot pin "${full}" — expected "agentboot@${currentToken}"`
        );
      }
    }

    if (!errors.some((e) => e.startsWith(file.path))) {
      console.log(`  ✓ ${file.path} (${count}× ${currentToken})`);
    }
  }

  if (errors.length > 0) {
    console.error(`\n✗ ${errors.length} version-string problem(s):\n`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error(
      `\nFix: bump every tracked string to v${version}. ` +
        `See scripts/version-strings.manifest.json and the release directive.`
    );
    process.exit(1);
  }

  console.log(`\n✓ All tracked version strings match v${version}.`);
}

main();
