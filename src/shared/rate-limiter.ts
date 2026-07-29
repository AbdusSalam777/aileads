import { sleep } from './sleep.js';

/**
 * Serializes calls and guarantees at least `minIntervalMs` between the start of
 * consecutive tasks. Used to stay inside the fair-use limits of free/donated
 * services (Overpass, Groq free tier) where bursting gets you banned.
 */
export const createSpacedRunner = (minIntervalMs: number) => {
  let chain: Promise<unknown> = Promise.resolve();
  let lastStartedAt = 0;

  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = chain.then(async () => {
      const waitFor = lastStartedAt + minIntervalMs - Date.now();

      if (waitFor > 0) {
        await sleep(waitFor);
      }

      lastStartedAt = Date.now();
      return task();
    });

    chain = result.catch(() => undefined);
    return result;
  };
};
