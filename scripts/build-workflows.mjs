#!/usr/bin/env node
// Builds the n8n workflows in workflows/dist/ from the definitions in workflows/src/.
// The library code in src/lib is inlined into Code nodes, so the code n8n runs is the code the tests cover.
// The build fails if anything that looks like a secret ends up in the output.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Node's built-in type stripper (no npm dependency). It is still flagged experimental: silence only
// that one warning so the build output stays readable.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) =>
  (String(warning).includes('stripTypeScriptTypes') ? undefined : emitWarning.call(process, warning, ...rest));

/**
 * TypeScript → the JavaScript n8n runs. Node's 'strip' mode replaces every type annotation with spaces,
 * keeping positions, so both texts can be compared character by character: what differs was a type and
 * is dropped, together with the spaces that only separated it (`x: string` → `x`, `(e as Error)` → `(e)`).
 * Lines that held only types disappear. Everything else stays byte for byte.
 */
export function stripTypes(source) {
  const stripped = stripTypeScriptTypes(source, { mode: 'strip' });
  if (stripped.length !== source.length) throw new Error('type stripping changed positions; cannot clean output');
  const n = source.length;
  const erased = (i) => stripped[i] !== source[i];
  const blank = (i) => source[i] === ' ' || source[i] === '\t';
  let out = '';
  for (let i = 0; i < n; i++) {
    if (erased(i)) continue;
    if (blank(i)) {
      let r = i;
      while (r < n && blank(r) && !erased(r)) r++;
      if (r < n && erased(r)) {
        let l = i;
        while (l >= 0 && blank(l) && !erased(l)) l--;
        if (l >= 0 && erased(l)) continue; // inside a type
        let k = r;
        while (k < n && source[k] !== '\n' && (erased(k) || blank(k))) k++;
        if (k >= n || source[k] === '\n' || ')],;.'.includes(source[k])) continue; // before a trailing type
      }
    }
    out += source[i];
  }
  const srcLines = source.split('\n');
  const outLines = out.split('\n');
  if (srcLines.length !== outLines.length) throw new Error('type stripping changed the line count');
  return outLines
    .filter((line, i) => line.trim() !== '' || srcLines[i].trim() === '')
    .join('\n')
    // Removing a block of types can leave blank lines stacked: keep one, as the source does.
    .replace(/\n{3,}/g, (m) => (source.includes(m) ? m : '\n\n'));
}

export function inlineModules(files) {
  const requires = new Set();
  const bodies = files.map((file) => {
    const raw = readFileSync(join(ROOT, file), 'utf8');
    const source = file.endsWith('.ts') ? stripTypes(raw) : raw;
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
