import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// One unsupported feature makes an older iPhone / Safari / Firefox fail to load the whole app (a blank page),
// so the browser code is kept to features every phone in use can parse and run. This test keeps it that way.
const FORBIDDEN: [RegExp, string][] = [
  [/\(\?<[=!]/, 'regex lookbehind (Safari before 16.4 cannot parse the file)'],
  [/\bstructuredClone\b/, 'structuredClone (Safari before 15.4, Firefox before 94)'],
  [/\.at\(\s*-?\d/, 'Array/String .at() (Safari before 15.4)'],
  [/\.replaceAll\(/, 'replaceAll (Safari before 13.1; use replace with /g)'],
  [/Object\.hasOwn\b/, 'Object.hasOwn (Safari before 15.4)'],
  [/\.(?:findLast|findLastIndex|toSorted|toReversed|toSpliced)\(/, 'newer array methods (Safari before 16)'],
  [/\brandomUUID\b/, 'crypto.randomUUID outside uid() in db.ts (missing on http pages and Safari before 15.4)'],
  [/Array\.fromAsync|AbortSignal\.(?:timeout|any)\b|\bgroupBy\(/, 'very new APIs'],
];

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) && !p.includes('testdata')) yield p;
  }
}

describe('browser code stays loadable on older Safari and Firefox', () => {
  for (const [re, why] of FORBIDDEN) {
    it(`does not use ${why}`, () => {
      const hits = [...sources('src')].filter((f) => !(f === join('src', 'db.ts') && /randomUUID/.test(re.source))).filter((f) => re.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
      expect(hits).toEqual([]);
    });
  }
});

describe('ids work without crypto.randomUUID (plain-http pages, older iPhones)', () => {
  it('uid() makes valid, unique v4 ids when randomUUID is missing', async () => {
    const real = globalThis.crypto;
    const noUuid = { getRandomValues: real.getRandomValues.bind(real) } as unknown as Crypto;
    Object.defineProperty(globalThis, 'crypto', { value: noUuid, configurable: true });
    try {
      const { uid } = await import('./db');
      const ids = new Set(Array.from({ length: 2000 }, () => uid()));
      expect(ids.size).toBe(2000);
      for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true });
    }
  });
});
