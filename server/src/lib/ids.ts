import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Short, URL-safe, prefixed ids like `prj_4fK9qZ2mXy7aB1cD`, so an id says what it refers to. */
export function newId(prefix: 'prj' | 'tpl' | 'pal' | 'rnd') {
  const bytes = randomBytes(16);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}
