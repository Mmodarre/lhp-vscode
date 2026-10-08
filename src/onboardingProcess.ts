import { spawn } from 'node:child_process';
import { lstat, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import type { BridgeClient } from './bridgeClient';
import { isRecord } from './shared/guards';
import { terminateProcessTree } from './processTree';

/** Reviewed public editor integration source; keep this pinned to an immutable commit. */
export const REVIEWED_LHP_SHA: string = '98d285ab8a7606867abb5708f2715ebe31a9befc';
export const REVIEWED_LHP_SOURCE: string | undefined =
  REVIEWED_LHP_SHA.length === 40
    ? `git+https://github.com/Mmodarre/Lakehouse_Plumber.git@${REVIEWED_LHP_SHA}`
    : undefined;

export function pythonInVenv(directory: string, platform = process.platform): string {
  return platform === 'win32'
    ? path.join(directory, 'Scripts', 'python.exe')
    : path.join(directory, 'bin', 'python');
}

export function isSupportedPython(version: string): boolean {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(version);
  return !!match && (Number(match[1]) > 3 || (Number(match[1]) === 3 && Number(match[2]) >= 11));
}

/** A target may be absent or empty; symlinks and populated directories are not init targets. */
export async function assertEmptyTarget(directory: string): Promise<void> {
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error('Choose an empty directory, not a file or symlink.');
    if ((await readdir(directory)).length > 0)
      throw new Error('This directory is not empty. Choose another location.');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
}

/** Recheck immediately before the public bootstrap API; that API rechecks too. */
export async function bootstrapProject(
  directory: string,
  name: string,
  bundle: boolean,
  interpreter: string,
  bridge: Pick<BridgeClient, 'call'>,
): Promise<void> {
  await assertEmptyTarget(directory);
  const response = await bridge.call({
    operation: 'init',
    interpreter,
    projectRoot: directory,
    options: { name, bundle },
  });
  if (!isRecord(response) || response.success !== true) {
    throw new Error(
      isRecord(response) && typeof response.error_message === 'string'
        ? response.error_message
        : 'LHP did not create the project.',
    );
  }
}

export class CommandError extends Error {
  constructor(
    readonly code: 'CANCELLED' | 'START_FAILED' | 'EXIT_FAILED' | 'TIMEOUT',
    message: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

/** Classify bounded stderr without revealing private paths, package indexes, or credentials. */
function failureGuidance(stderr: string, args: string[]): string {
  if (/certificate verify failed|ssl certificate|self.signed.certificate/i.test(stderr))
    return 'Check the Python package index certificate configuration, or choose a trusted local wheel.';
  if (
    /could not resolve host|name or service not known|temporary failure in name resolution|connection timed out|network is unreachable/i.test(
      stderr,
    )
  )
    return 'Check network access, or choose a local wheel or source checkout.';
  if (/git.*not found|cannot find command.*git|failed to clone/i.test(stderr))
    return 'Install Git, or choose a local wheel or source checkout.';
  if (/no module named pip|ensurepip is not available/i.test(stderr))
    return 'Choose a Python installation that includes pip and ensurepip.';
  if (/permission denied|access is denied|operation not permitted/i.test(stderr))
    return 'Choose a writable environment location and retry.';
  if (/no matching distribution found|requires a different python|unsupported python/i.test(stderr))
    return 'Check that the selected integration build supports this Python version.';
  if (args[1] === 'venv')
    return 'Choose another writable folder or a different Python 3.11+ interpreter.';
  return 'Retry with a compatible local wheel or source checkout, or choose another Python interpreter.';
}

/** Execute a fixed executable + argument array. Captured output is only classified, never displayed verbatim. */
export function runPythonCommand(
  executable: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = 15 * 60_000,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(new CommandError('CANCELLED', 'Setup was cancelled.'));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let settled = false;
    let stopping = false;
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 32_768) stderr += chunk.toString('utf8').slice(0, 32_768 - stderr.length);
    });
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const stop = (error: CommandError): void => {
      if (settled || stopping) return;
      stopping = true;
      void (async () => {
        try {
          await terminateProcessTree(child);
          finish(error);
        } catch {
          finish(
            new CommandError(
              error.code,
              `${error.message} A Python process may still be running; check it before retrying.`,
            ),
          );
        }
      })();
    };
    const abort = (): void => {
      stop(
        new CommandError(
          'CANCELLED',
          'Setup was cancelled. You can retry the installation or choose another environment folder.',
        ),
      );
    };
    const timeout = setTimeout(() => {
      stop(
        new CommandError(
          'TIMEOUT',
          'Python setup timed out. Check network access, then retry or choose another environment folder.',
        ),
      );
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => {
      if (!stopping)
        finish(new CommandError('START_FAILED', 'Could not start the selected Python executable.'));
    });
    child.on('close', (code) => {
      if (stopping) return;
      finish(
        code === 0
          ? undefined
          : new CommandError(
              'EXIT_FAILED',
              `Python setup failed (exit ${code ?? 'unknown'}). ${failureGuidance(stderr, args)} You can retry the installation or choose another environment folder.`,
            ),
      );
    });
  });
}
