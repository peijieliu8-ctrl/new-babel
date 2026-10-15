import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const vendor = new URL('assets/vendor/', root);
await mkdir(vendor, { recursive: true });
for (const [source, name] of [
  ['dist/reveal.js', 'reveal.js'], ['dist/reveal.css', 'reveal.css'],
  ['dist/reset.css', 'reset.css'], ['dist/plugin/notes.js', 'notes.js'],
  ['LICENSE', 'REVEAL-LICENSE'],
]) await copyFile(new URL(`node_modules/reveal.js/${source}`, root), new URL(name, vendor));
console.log(`Vendored reveal.js into ${fileURLToPath(vendor)}`);
