import { build, context } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const watch = process.argv.includes('--watch');
await mkdir('dist', { recursive: true });
const common = {
  bundle: true,
  sourcemap: false,
  minify: !watch,
  logLevel: 'info',
  legalComments: 'eof',
};
const configurations = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: ['webview/src/main.tsx'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
    loader: { '.woff': 'file', '.woff2': 'file' },
  },
  {
    ...common,
    entryPoints: ['tests/extension/index.ts'],
    outfile: 'out/extension-tests.cjs',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
  },
];
for (const config of configurations) {
  if (watch) await (await context(config)).watch();
  else await build(config);
}
// Preserve notices for every production dependency, including transitives.
const require = createRequire(import.meta.url);
const root = JSON.parse(await readFile('package.json', 'utf8'));
const visited = new Set();
const notices = [];
async function licenseFor(name, resolver) {
  let manifestPath;
  try {
    manifestPath = resolver.resolve(`${name}/package.json`);
  } catch {
    let directory = path.dirname(resolver.resolve(name));
    while (directory !== path.dirname(directory)) {
      try {
        const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
        if (manifest.name === name) {
          manifestPath = path.join(directory, 'package.json');
          break;
        }
      } catch {
        /* Continue towards package root. */
      }
      directory = path.dirname(directory);
    }
  }
  if (!manifestPath || visited.has(manifestPath)) return;
  visited.add(manifestPath);
  const pkg = JSON.parse(await readFile(manifestPath, 'utf8'));
  const directory = path.dirname(manifestPath);
  let license = '';
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENSE-MIT']) {
    try {
      license = await readFile(path.join(directory, file), 'utf8');
      break;
    } catch {
      /* Alternate conventional filename. */
    }
  }
  if (!license) throw new Error(`Missing bundled dependency licence for ${name}`);
  notices.push(`${name}@${pkg.version}\n${license}\n`);
  const local = createRequire(manifestPath);
  for (const child of Object.keys(pkg.dependencies ?? {})) await licenseFor(child, local);
}
for (const name of Object.keys(root.dependencies ?? {})) await licenseFor(name, require);
await writeFile(
  'dist/THIRD_PARTY_LICENSES.txt',
  notices.join('\n----------------------------------------\n'),
);
await copyFile('NOTICE', 'dist/NOTICE');
