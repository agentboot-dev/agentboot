#!/usr/bin/env node

/**
 * AB-152: AgentBoot Marketplace Catalog Builder
 *
 * Generates static HTML pages from registry.json for agentboot.dev/marketplace.
 * Usage: tsx scripts/build-catalog.ts [--registry path] [--output path]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface RegistryEntry {
  id: string; name: string; type: string; layer: string; version: string;
  description: string; author: { handle: string; org?: string };
  license: string; tags: string[];
  stats?: { downloads?: number; orgs?: number };
  path: string; sha: string;
}

interface Registry { components: RegistryEntry[] }

function layerBadge(layer: string): string {
  const cls = layer === "core" ? "badge-core" : layer === "verified" ? "badge-verified" : "badge-community";
  return `<span class="badge ${cls}">${layer}</span>`;
}

function baseLayout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — AgentBoot Marketplace</title>
<style>
:root{--primary:#2563eb;--bg:#fff;--surface:#f8fafc;--border:#e2e8f0;--text:#1e293b;--muted:#64748b}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--text);line-height:1.6}
.container{max-width:1100px;margin:0 auto;padding:0 20px}
header{background:var(--text);color:#fff;padding:16px 0}header a{color:#fff;text-decoration:none}header h1{font-size:1.25rem;display:inline}
main{padding:30px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.card{border:1px solid var(--border);border-radius:8px;padding:20px;background:#fff;transition:box-shadow .2s}.card:hover{box-shadow:0 4px 12px rgba(0,0,0,.08)}
.card h3{margin-bottom:6px}.card h3 a{color:var(--text);text-decoration:none}
.card p{color:var(--muted);font-size:.9rem;margin-bottom:12px}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75rem;font-weight:600}
.badge-core{background:#dbeafe;color:#1d4ed8}.badge-verified{background:#dcfce7;color:#166534}.badge-community{background:#f1f5f9;color:#475569}
.meta{display:flex;gap:12px;font-size:.8rem;color:var(--muted);margin-top:10px}
.install{background:var(--surface);padding:8px 12px;border-radius:6px;font-family:monospace;font-size:.85rem;margin-top:10px;border:1px solid var(--border)}
.tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.tag{background:var(--surface);padding:2px 8px;border-radius:4px;font-size:.75rem;color:var(--muted)}
.search-box{width:100%;padding:10px 16px;border:1px solid var(--border);border-radius:8px;font-size:1rem;margin-bottom:20px}
.stats-row{display:flex;gap:40px;justify-content:center;padding:30px 0}
.stat{text-align:center}.stat .value{font-size:2.5rem;font-weight:bold}.stat .label{color:var(--muted);font-size:.9rem}
footer{border-top:1px solid var(--border);padding:20px 0;margin-top:40px;color:var(--muted);font-size:.85rem;text-align:center}footer a{color:var(--primary)}
</style></head><body>
<header><div class="container"><h1><a href="index.html">AgentBoot Marketplace</a></h1></div></header>
<main><div class="container">${content}</div></main>
<footer><div class="container"><p>Built with <a href="https://agentboot.dev">AgentBoot</a></p></div></footer>
</body></html>`;
}

function generateIndex(registry: Registry): string {
  const cards = registry.components.map(e => `<div class="card" data-search="${e.name} ${e.description} ${e.tags.join(" ")}">
  <h3><a href="${e.type}/${e.name}.html">${e.name}</a> ${layerBadge(e.layer)}</h3>
  <p>${e.description}</p>
  <div class="tags">${e.tags.map(t => `<span class="tag">${t}</span>`).join("")}</div>
  <div class="install">agentboot pull ${e.id}</div>
  <div class="meta"><span>${e.type}</span><span>v${e.version}</span><span>${e.license}</span></div>
</div>`).join("\n");

  return baseLayout("Browse", `
<div class="stats-row">
  <div class="stat"><div class="value">${registry.components.length}</div><div class="label">Components</div></div>
  <div class="stat"><div class="value">${registry.components.filter(c => c.layer === "verified").length}</div><div class="label">Verified</div></div>
</div>
<input type="text" class="search-box" placeholder="Search components..." oninput="document.querySelectorAll('.card').forEach(c=>c.style.display=c.dataset.search.toLowerCase().includes(this.value.toLowerCase())?'':'none')">
<div class="grid">${cards}</div>`);
}

function generateDetail(entry: RegistryEntry): string {
  return baseLayout(entry.name, `
<h2>${entry.name} ${layerBadge(entry.layer)}</h2>
<p style="color:var(--muted);margin:10px 0">${entry.description}</p>
<div class="install" style="display:inline-block">agentboot pull ${entry.id}</div>
<table style="margin-top:20px;border-collapse:collapse">
  <tr><td style="color:var(--muted);padding:4px 12px">Version</td><td>${entry.version}</td></tr>
  <tr><td style="color:var(--muted);padding:4px 12px">License</td><td>${entry.license}</td></tr>
  <tr><td style="color:var(--muted);padding:4px 12px">Type</td><td>${entry.type}</td></tr>
  <tr><td style="color:var(--muted);padding:4px 12px">Author</td><td>${entry.author.handle}</td></tr>
</table>
<div class="tags" style="margin-top:15px">${entry.tags.map(t => `<span class="tag">${t}</span>`).join("")}</div>`);
}

function main(): void {
  const args = process.argv.slice(2);
  let registryPath = "";
  let outputDir = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--registry" && args[i + 1]) registryPath = args[++i]!;
    if (args[i] === "--output" && args[i + 1]) outputDir = args[++i]!;
  }
  if (!outputDir) outputDir = path.join(ROOT, "dist", "catalog");

  let registry: Registry;
  if (registryPath && fs.existsSync(registryPath)) {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  } else {
    // Generate from core components
    const components: RegistryEntry[] = [];
    const traitsDir = path.join(ROOT, "core", "traits");
    if (fs.existsSync(traitsDir)) {
      for (const f of fs.readdirSync(traitsDir).filter(f => f.endsWith(".md"))) {
        const name = path.basename(f, ".md");
        components.push({ id: `trait/${name}`, name, type: "trait", layer: "core", version: "1.0.0",
          description: `Core trait: ${name}`, author: { handle: "agentboot" }, license: "Apache-2.0",
          tags: ["core"], path: `traits/core/${name}`, sha: "" });
      }
    }
    const personasDir = path.join(ROOT, "core", "personas");
    if (fs.existsSync(personasDir)) {
      for (const d of fs.readdirSync(personasDir)) {
        const cp = path.join(personasDir, d, "persona.config.json");
        if (fs.existsSync(cp)) {
          try {
            const pc = JSON.parse(fs.readFileSync(cp, "utf-8"));
            components.push({ id: `persona/${d}`, name: d, type: "persona", layer: "core", version: "1.0.0",
              description: pc.description ?? d, author: { handle: "agentboot" }, license: "Apache-2.0",
              tags: ["core"], path: `personas/core/${d}`, sha: "" });
          } catch {}
        }
      }
    }
    registry = { components };
  }

  console.log(chalk.bold("\nAgentBoot — build catalog"));
  console.log(chalk.gray(`Components: ${registry.components.length}, Output: ${outputDir}\n`));

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "index.html"), generateIndex(registry), "utf-8");
  console.log(chalk.green("  ✓ index.html"));

  for (const type of ["trait", "gotcha", "persona", "domain"]) {
    const items = registry.components.filter(c => c.type === type);
    if (items.length === 0) continue;
    const typeDir = path.join(outputDir, type);
    fs.mkdirSync(typeDir, { recursive: true });
    for (const entry of items) {
      fs.writeFileSync(path.join(typeDir, `${entry.name}.html`), generateDetail(entry), "utf-8");
    }
    console.log(chalk.green(`  ✓ ${type}/ (${items.length} pages)`));
  }

  console.log(chalk.bold(`\n✓ Catalog: ${registry.components.length} components → ${outputDir}/`));
}

main();
