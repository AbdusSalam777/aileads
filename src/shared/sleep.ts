export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const jitter = (minMs: number, maxMs: number) =>
  minMs >= maxMs ? minMs : minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
