import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeClient } from '../../src/bridgeClient';
import {
  assertEmptyTarget,
  bootstrapProject,
  CommandError,
  isSupportedPython,
  pythonInVenv,
  REVIEWED_LHP_SHA,
  REVIEWED_LHP_SOURCE,
  runPythonCommand,
} from '../../src/onboardingProcess';

describe('safe LHP onboarding boundaries', () => {
  let parent: string;
  beforeEach(async () => {
    parent = await mkdtemp(path.join(tmpdir(), 'lhp-onboarding-'));
  });
  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it('accepts absent and empty project targets, but rejects populated targets without invoking bootstrap', async () => {
    const target = path.join(parent, 'project');
    const call = vi.fn(async () => ({ success: true }));
    const bridge = { call } as unknown as Pick<BridgeClient, 'call'>;
    await assertEmptyTarget(target);
    await mkdir(target);
    await bootstrapProject(target, 'project', true, '/chosen/python', bridge);
    expect(call).toHaveBeenCalledWith({
      operation: 'init',
      interpreter: '/chosen/python',
      projectRoot: target,
      options: { name: 'project', bundle: true },
    });
    await writeFile(path.join(target, '.hidden-user-file'), 'keep');
    await expect(
      bootstrapProject(target, 'project', false, '/chosen/python', bridge),
    ).rejects.toThrow('not empty');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a symlink target even when its destination is empty',
    async () => {
      const destination = path.join(parent, 'destination');
      await mkdir(destination);
      const link = path.join(parent, 'project');
      await symlink(destination, link);
      await expect(assertEmptyTarget(link)).rejects.toThrow('symlink');
    },
  );

  it('surfaces public bootstrap failure without claiming the project was created', async () => {
    const target = path.join(parent, 'project');
    const bridge = {
      call: vi.fn(async () => ({
        success: false,
        error_message: 'Target changed during initialization.',
      })),
    } as unknown as Pick<BridgeClient, 'call'>;
    await expect(
      bootstrapProject(target, 'project', true, '/chosen/python', bridge),
    ).rejects.toThrow('Target changed');
  });

  it('uses the correct platform venv binary and requires Python 3.11+', () => {
    expect(pythonInVenv('/work/.venv', 'win32')).toBe(
      path.join('/work/.venv', 'Scripts', 'python.exe'),
    );
    expect(pythonInVenv('/work/.venv', 'darwin')).toBe(path.join('/work/.venv', 'bin', 'python'));
    expect(isSupportedPython('3.10.14')).toBe(false);
    expect(isSupportedPython('3.11.0')).toBe(true);
    expect(isSupportedPython('3.13.2')).toBe(true);
    expect(isSupportedPython('unknown')).toBe(false);
  });

  it('pins the recommended installer to the reviewed public editor integration commit', () => {
    expect(REVIEWED_LHP_SHA).toMatch(/^[a-f0-9]{40}$/);
    expect(REVIEWED_LHP_SOURCE).toBe(
      `git+https://github.com/Mmodarre/Lakehouse_Plumber.git@${REVIEWED_LHP_SHA}`,
    );
  });

  it('runs an executable with argument-array semantics and reports exit/cancel safely', async () => {
    await runPythonCommand(process.execPath, ['-e', 'process.exit(0)'], parent);
    await expect(
      runPythonCommand(process.execPath, ['-e', 'process.exit(9)'], parent),
    ).rejects.toMatchObject({ code: 'EXIT_FAILED' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      runPythonCommand(process.execPath, ['-e', 'process.exit(0)'], parent, controller.signal),
    ).rejects.toBeInstanceOf(CommandError);
  });

  it('classifies pip failure without echoing private stderr into the UI', async () => {
    const secret = 'https://user:password@example.invalid/private-index';
    let message = '';
    try {
      await runPythonCommand(
        process.execPath,
        ['-e', `process.stderr.write('certificate verify failed ${secret}'); process.exit(2)`],
        parent,
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('certificate configuration');
    expect(message).not.toContain(secret);
  });

  it.skipIf(process.platform === 'win32')(
    'cancels Python and its spawned worker process',
    async () => {
      const marker = path.join(parent, 'grandchild-marker');
      const childCode = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'), 350)`;
      const parentCode = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], { stdio: 'ignore' }); setTimeout(() => {}, 5000)`;
      const controller = new AbortController();
      const running = runPythonCommand(
        process.execPath,
        ['-e', parentCode],
        parent,
        controller.signal,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      controller.abort();
      await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
});
