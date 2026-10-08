import { mkdtemp, mkdir, symlink, rm, writeFile, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { containedPath, lexicalPath } from '../../src/paths';
import { parseWebviewRequest } from '../../src/shared/guards';
import { BridgeClient } from '../../src/bridgeClient';

describe('host boundaries', () => {
  it('rejects unknown commands and malformed document versions', () => {
    expect(() => parseWebviewRequest({ type: 'executeShell', requestId: '1' })).toThrow();
    expect(() =>
      parseWebviewRequest({
        type: 'mutate',
        requestId: '1',
        projectId: 'p',
        documentVersions: { 'a.yaml': -1 },
        mutation: { kind: 'delete', actionId: 'a' },
      }),
    ).toThrow();
    expect(
      parseWebviewRequest({
        type: 'createInstance',
        requestId: '1',
        values: {
          kind: 'blueprint',
          name: '',
          pipeline: '',
          definition: 'spec',
          targetPath: 'pipelines/instance.yaml',
          parameters: {},
        },
      }).type,
    ).toBe('createInstance');
  });
  it('contains paths lexically and through filesystem symlinks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lhp-path-'));
    try {
      for (const unsafe of ['../x', '/tmp/x', 'C:/x', 'a\\x', 'a/../x', 'a//x'])
        expect(() => lexicalPath(root, unsafe)).toThrow();
      await mkdir(path.join(root, 'project'));
      await mkdir(path.join(root, 'outside'));
      await symlink(
        path.join(root, 'outside'),
        path.join(root, 'project/link'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await expect(containedPath(path.join(root, 'project'), 'link/new.yaml')).rejects.toThrow(
        'Symlink',
      );
      expect(await containedPath(path.join(root, 'project'), 'new/file.yaml')).toContain('new');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('cancels the actual Python child process tree', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lhp-tree-'));
    const python =
      process.env.LHP_TEST_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
    const file = path.join(root, 'worker.py');
    const pidFile = path.join(root, 'pid');
    await writeFile(
      file,
      `import subprocess,sys,time,pathlib\nsys.stdin.readline()\np=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])\npathlib.Path(${JSON.stringify(pidFile)}).write_text(str(p.pid))\ntime.sleep(60)\n`,
    );
    const client = new BridgeClient(file, () => undefined);
    const controller = new AbortController();
    try {
      const result = client.call({
        operation: 'health',
        interpreter: python,
        signal: controller.signal,
      });
      // Attach a rejection handler before cancellation to avoid unhandled errors.
      const outcome = result.catch((error) => error as Error);
      let pid = 0;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          pid = Number(await readFile(pidFile, 'utf8'));
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      expect(pid).toBeGreaterThan(0);
      controller.abort();
      expect(((await outcome) as Error).message).toContain('cancelled');
      await new Promise((resolve) => setTimeout(resolve, 150));
      let running = false;
      try {
        process.kill(pid, 0);
        running = true;
        if (process.platform === 'linux')
          running = !(await readFile(`/proc/${pid}/stat`, 'utf8')).includes(') Z ');
      } catch {
        running = false;
      }
      expect(running).toBe(false);
    } finally {
      client.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 10000);
});
