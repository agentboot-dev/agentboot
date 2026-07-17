/**
 * Global test isolation.
 *
 * Points AGENTBOOT_HOME at a throwaway temp dir so the AgentBoot global hub
 * registry (~/.agentboot/config.json) is isolated per test file and never
 * touches the developer's real registry. Without this, install/scaffold/CLI
 * tests register temp hubs into the real registry and leave thousands of dead
 * entries behind (observed: 2000+ leftover hubs from repeated `npm test` runs).
 *
 * Runs in the worker before each test file (vitest `setupFiles`), so both
 * in-process code and spawned CLI subprocesses (which inherit process.env)
 * resolve the registry under the temp home.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-testhome-"));
process.env["AGENTBOOT_HOME"] = testHome;
