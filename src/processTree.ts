import { spawn, type ChildProcess } from 'node:child_process';

const stopping = new WeakMap<ChildProcess, Promise<void>>();

/** Do not release request-owned files until the original process and its pipes
 * close. Windows taskkill also has to complete before cancellation is reported. */
export function terminateProcessTree(child: ChildProcess): Promise<void> {
  const pending = stopping.get(child);
  if (pending) return pending;
  if (!child.pid) return Promise.resolve();
  const shutdown = new Promise<void>((resolve, reject) => {
    const exited = child.exitCode !== null || child.signalCode !== null;
    let closed = exited && child.stdio.every((stream) => !stream || stream.destroyed);
    let treeStopped = exited;
    let killer: ChildProcess | undefined;
    const finish = (): void => {
      if (!closed || !treeStopped) return;
      clearTimeout(timeout);
      child.removeListener('close', onClose);
      resolve();
    };
    const onClose = (): void => {
      closed = true;
      finish();
    };
    const timeout = setTimeout(() => {
      killer?.kill();
      child.kill('SIGKILL');
      child.removeListener('close', onClose);
      reject(new Error('Python process tree did not close within the shutdown timeout.'));
    }, 10000);
    child.once('close', onClose);
    if (!exited) {
      if (process.platform === 'win32') {
        killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.once('error', (error) => {
          child.kill('SIGKILL');
          clearTimeout(timeout);
          child.removeListener('close', onClose);
          reject(new Error('Could not terminate the Python process tree.', { cause: error }));
        });
        killer.once('close', () => {
          treeStopped = true;
          finish();
        });
      } else {
        // These children own a detached process group; no delayed PID-based
        // escalation can accidentally target a later process after PID reuse.
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
        treeStopped = true;
      }
    }
    finish();
  });
  stopping.set(child, shutdown);
  return shutdown;
}
