/**
 * File storage for render inputs and outputs. Local disk under RENDER_DIR;
 * the interface is small so an S3-compatible store can replace it.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, truncate } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '../env.js';

const root = resolve(env.RENDER_DIR);

function jobPath(jobId: string) {
  if (!/^rnd_[\w-]+$/.test(jobId)) throw new Error('Bad render job id.');
  return join(root, jobId);
}

/** Keys are "<jobId>/<name>"; anything that could escape the root is rejected. */
function pathFor(key: string) {
  if (!/^[\w-]+\/[\w.-]+$/.test(key)) throw new Error(`Bad storage key: ${key}`);
  return join(root, key);
}

export const storage = {
  /**
   * Writes a web stream to storage, stopping with an error past `maxBytes`. Returns the bytes written.
   * With `append`, adds to the end of an existing file (chunked uploads) instead of replacing it.
   */
  async put(key: string, body: ReadableStream<Uint8Array>, maxBytes: number, append = false): Promise<number> {
    const path = pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const before = append ? (await stat(path).catch(() => null))?.size ?? 0 : 0;
    let bytes = 0;
    const counted = Readable.fromWeb(body as never).on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) counted.destroy(new Error('too large'));
    });
    try {
      await pipeline(counted, createWriteStream(path, { flags: append ? 'a' : 'w' }));
    } catch (e) {
      // A failed append rolls back to the earlier chunks; a failed whole write leaves nothing.
      if (before > 0) await truncate(path, before);
      else await rm(path, { force: true });
      throw e;
    }
    return bytes;
  },
  /**
   * Streams a body to a new temporary file next to `key`, so a slow upload
   * holds no database lock. `commit` then moves it into place.
   */
  async stage(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<{ part: string; bytes: number }> {
    const part = `${key}.part-${randomBytes(6).toString('hex')}`;
    return { part, bytes: await storage.put(part, body, maxBytes) };
  },
  /**
   * Makes a staged file the content of `key` (replacing it) or, with `append`,
   * adds it to the end. Returns the size of `key` afterwards. Run it while
   * holding the lock that orders writers of `key`; it only touches local disk.
   */
  async commit(part: string, key: string, append: boolean): Promise<number> {
    try {
      if (!append) await rename(pathFor(part), pathFor(key));
      else {
        const before = await storage.size(key);
        try {
          await pipeline(createReadStream(pathFor(part)), createWriteStream(pathFor(key), { flags: 'a' }));
        } catch (e) {
          await truncate(pathFor(key), before);
          throw e;
        }
      }
    } finally {
      await rm(pathFor(part), { force: true });
    }
    return storage.size(key);
  },
  async discard(part: string) { await rm(pathFor(part), { force: true }); },
  path: pathFor,
  /** Size in bytes, or 0 if the file doesn't exist yet. */
  async size(key: string) { return (await stat(pathFor(key)).catch(() => null))?.size ?? 0; },
  read(key: string) { return Readable.toWeb(createReadStream(pathFor(key))) as ReadableStream<Uint8Array>; },
  async removeJob(jobId: string) { await rm(jobPath(jobId), { recursive: true, force: true }); },
  async jobIds() {
    const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    return entries.filter((e) => e.isDirectory() && /^rnd_[\w-]+$/.test(e.name)).map((e) => e.name);
  },
  /** Deletes a job's uploaded files (media-*), keeping its output. */
  async removeInputs(jobId: string) {
    const path = jobPath(jobId);
    const files = await readdir(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    await Promise.all(files.filter((f) => f.startsWith('media-')).map((f) => rm(join(path, f), { force: true })));
  },
};
