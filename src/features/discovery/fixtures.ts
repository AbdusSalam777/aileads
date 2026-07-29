import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

export const loadFixture = async <T>(name: string): Promise<T> => {
  const raw = await readFile(resolve(fixturesDir, name), 'utf8');
  return JSON.parse(raw) as T;
};

export const loadFixtureText = async (name: string): Promise<string> =>
  readFile(resolve(fixturesDir, name), 'utf8');
