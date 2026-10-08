import { execFileSync } from 'node:child_process';
import { createVSIX } from '@vscode/vsce';
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit))
  throw new Error('A committed source revision is required for packaging.');
await createVSIX({
  packagePath: '.tmp/lhp-vscode-0.1.0.vsix',
  dependencies: false,
  baseContentUrl: `https://github.com/Mmodarre/lhp-vscode/blob/${commit}`,
  baseImagesUrl: `https://github.com/Mmodarre/lhp-vscode/raw/${commit}`,
});
