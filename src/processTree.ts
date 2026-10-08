import { spawn, type ChildProcess } from 'node:child_process';

/** Children are launched in their own POSIX process group. Windows taskkill
 * addresses this known PID and descendants without invoking a shell. */
export function terminateProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', () => child.kill());
    killer.unref();
  } else {
    // Kill the still-owned group immediately: delayed PID-based escalation can
    // race PID reuse after its leader exits, and pooled workers must not outlive cancellation.
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}
