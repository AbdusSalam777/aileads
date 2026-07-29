import { describe, expect, it } from 'vitest';
import { createSpacedRunner } from './rate-limiter.js';
import { jitter } from './sleep.js';

describe('createSpacedRunner', () => {
  it('serializes tasks and spaces their start times', async () => {
    const run = createSpacedRunner(50);
    const startedAt: number[] = [];

    const task = () => {
      startedAt.push(Date.now());
      return Promise.resolve('ok');
    };

    await Promise.all([run(task), run(task), run(task)]);

    expect(startedAt).toHaveLength(3);
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(45);
    expect(startedAt[2] - startedAt[1]).toBeGreaterThanOrEqual(45);
  });

  it('keeps running after a task rejects', async () => {
    const run = createSpacedRunner(1);

    await expect(run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(run(() => Promise.resolve('still alive'))).resolves.toBe('still alive');
  });
});

describe('jitter', () => {
  it('stays within bounds', () => {
    for (let i = 0; i < 100; i += 1) {
      const value = jitter(10, 20);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(20);
    }
  });

  it('returns the minimum when the range is degenerate', () => {
    expect(jitter(7, 7)).toBe(7);
    expect(jitter(9, 3)).toBe(9);
  });
});
