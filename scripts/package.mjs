import { execFileSync } from 'node:child_process';
import { createVSIX } from '@vscode/vsce';
import { readFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit))
  throw new Error('A committed source revision is required for packaging.');
await createVSIX({
  packagePath: `.tmp/lhp-vscode-${version}.vsix`,
  dependencies: false,
  baseContentUrl: `https://github.com/Mmodarre/lhp-vscode/blob/${commit}`,
  baseImagesUrl: `https://github.com/Mmodarre/lhp-vscode/raw/${commit}`,
});
