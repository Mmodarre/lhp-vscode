import * as path from 'node:path';
import { realpath, lstat } from 'node:fs/promises';

export function ignoredProjectPath(relative: string): boolean {
  return ignoredInventoryPath(relative) || relative.startsWith('generated/');
}

export const SANDBOX_PROFILE_PATH = '.lhp/profile.yaml' as const;
export function isSandboxProfilePath(relative: string): boolean {
  return relative === SANDBOX_PROFILE_PATH;
}

/** Shared eligibility for physical discovery and incremental source events. */
export function ignoredInventoryPath(relative: string): boolean {
  if (isSandboxProfilePath(relative) || relative === '.lhp') return false;
  const parts = relative.split('/');
  return (
    parts.some((part) =>
      [
        'node_modules',
        '.venv',
        'venv',
        '.git',
        '.tmp',
        '.superdesign',
        '.lhp',
        '.databricks',
        '.ruff_cache',
        '.pytest_cache',
        '.mypy_cache',
        '__pycache__',
        'dist',
      ].includes(part),
    ) ||
    (parts.at(-1)?.startsWith('.env') ?? false) ||
    parts.at(-1) === '.DS_Store'
  );
}

export function relativePath(root: string, filename: string): string | undefined {
  const relative = path.relative(root, filename);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  )
    return undefined;
  return relative.split(path.sep).join('/');
}
export function lexicalPath(root: string, relative: string): string {
  if (
    !relative ||
    relative.includes('\\') ||
    relative.includes('\0') ||
    path.posix.isAbsolute(relative) ||
    /^[A-Za-z]:/.test(relative) ||
    relative.split('/').some((p) => !p || p === '..' || p === '.')
  ) {
    throw new Error('Expected a safe project-relative path.');
  }
  const result = path.resolve(root, ...relative.split('/'));
  if (!relativePath(root, result)) throw new Error('Path must stay inside the project.');
  return result;
}
/** Existing and newly-created paths are contained after resolving every parent. */
export async function containedPath(root: string, relative: string): Promise<string> {
  const result = lexicalPath(root, relative);
  const canonicalRoot = await realpath(root);
  let existing = result;
  while (true) {
    try {
      await lstat(existing);
      break;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error('Cannot resolve project path.', { cause: error });
      existing = parent;
    }
  }
  const canonical = await realpath(existing);
  if (canonical !== canonicalRoot && !relativePath(canonicalRoot, canonical))
    throw new Error('Symlink points outside the project.');
  return result;
}
