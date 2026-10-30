import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(
  import.meta.dirname,
  '../server/public/widget/v1/insureongo.js',
);
const BUDGET_BYTES = 15 * 1024;

mkdirSync(path.dirname(OUT), { recursive: true });

await build({
  entryPoints: [path.resolve(import.meta.dirname, 'src/index.ts')],
  outfile: OUT,
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  legalComments: 'none',
});

const gzipped = gzipSync(readFileSync(OUT)).length;
const raw = readFileSync(OUT).length;
console.log(`insureongo.js  ${raw} B raw  ${gzipped} B gzipped  (budget ${BUDGET_BYTES} B)`);

if (gzipped > BUDGET_BYTES) {
  console.error(`Over the gzipped budget by ${gzipped - BUDGET_BYTES} B`);
  process.exit(1);
}
