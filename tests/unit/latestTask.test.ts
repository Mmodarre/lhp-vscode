import { expect, it } from 'vitest';
import { LatestTask } from '../../src/latestTask';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it('does not resolve a superseded discovery until its current successor publishes', async () => {
  const queue = new LatestTask();
  const first = deferred();
  const second = deferred();
  const published: string[] = [];
  let firstDone = false;
  const a = queue
    .run(async (current) => {
      await first.promise;
      if (current()) published.push('obsolete');
    })
    .then(() => {
      firstDone = true;
    });
  await Promise.resolve();
  const b = queue.run(async (current) => {
    await second.promise;
    if (current()) published.push('current');
  });
  first.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(firstDone).toBe(false);
  expect(published).toEqual([]);
  second.resolve();
  await Promise.all([a, b]);
  expect(published).toEqual(['current']);
  expect(firstDone).toBe(true);
});

it('joins multiple replacements and delivers the latest failure to all callers', async () => {
  const queue = new LatestTask();
  const first = deferred();
  const second = deferred();
  const third = deferred();
  const a = queue.run(async () => first.promise);
  const b = queue.run(async () => second.promise);
  const c = queue.run(async () => third.promise);
  const results = Promise.allSettled([a, b, c]);
  first.reject(new Error('obsolete lookup failed'));
  second.resolve();
  third.reject(new Error('current lookup failed'));
  const settled = await results;
  expect(settled.map((value) => value.status)).toEqual(['rejected', 'rejected', 'rejected']);
  for (const value of settled)
    if (value.status === 'rejected') expect(value.reason.message).toBe('current lookup failed');
});
