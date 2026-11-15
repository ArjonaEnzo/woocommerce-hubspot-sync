#!/usr/bin/env node
// Builds the n8n workflows in workflows/dist/ from the definitions in workflows/src/.
// The library code in src/lib is inlined into Code nodes, so the code n8n runs is the code the tests cover.
// The build fails if anything that looks like a secret ends up in the output.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function inlineModules(files) {
  const requires = new Set();
  const bodies = files.map((file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    const body = source
      .replace(/^import\s*\{([^}]+)\}\s*from\s*'node:(\w+)';\s*$/gm, (_m, names, mod) => {
        requires.add(`const { ${names.split(',').map((n) => n.trim()).join(', ')} } = require('${mod}');`);
        return '';
      })
      .replace(/^import\s[^;]+from\s+'\.[^']*';\s*$/gm, '') // sibling modules are inlined too
      .replace(/^export\s+/gm, '');
    return `// ---- ${file} ----\n${body.trim()}`;
  });
  return [...requires, ...bodies].join('\n\n');
}

const SECRET_PATTERNS = [
  /pat-[a-z0-9]{2,4}-[0-9a-f]{8}-[0-9a-f-]{20,}/i, // HubSpot private app / service key
  /Bearer\s+[A-Za-z0-9._-]{20,}/, // literal bearer tokens
  /\b(?:[A-Za-z0-9]{4} ){5}[A-Za-z0-9]{4}\b/, // WordPress application password
  /\b[0-9a-f]{64}\b/i, // 32-byte hex secrets (webhook secret)
  /\bc[ks]_[0-9a-f]{40}\b/, // WooCommerce consumer key/secret
];

export function findSecrets(text) {
  return SECRET_PATTERNS.flatMap((re) => {
    const m = text.match(re);
    return m ? [m[0].slice(0, 12) + '…'] : [];
  });
}

async function main() {
  const srcDir = join(ROOT, 'workflows', 'src');
  const outDir = join(ROOT, 'workflows', 'dist');
  mkdirSync(outDir, { recursive: true });
  const definitions = readdirSync(srcDir).filter((f) => f.endsWith('.workflow.mjs'));
  let failed = false;
  for (const file of definitions) {
    const { default: build } = await import(pathToFileURL(join(srcDir, file)));
    const workflow = build({ inline: inlineModules });
    const json = `${JSON.stringify(workflow, null, 2)}\n`;
    const secrets = findSecrets(json);
    if (secrets.length) {
      console.error(`✖ ${file}: possible secret(s) in output: ${secrets.join(', ')}`);
      failed = true;
      continue;
    }
    const outName = file.replace('.workflow.mjs', '.json');
    writeFileSync(join(outDir, outName), json);
    console.log(`✔ workflows/dist/${outName} (${workflow.nodes.length} nodes)`);
  }
  if (failed) process.exit(1);
}

if (import.meta.main) await main();
