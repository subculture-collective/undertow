import { createMiddleware } from 'hono/factory';
import { fail } from './problem.js';

export const JSON_MAX_BYTES = 2 * 1024 * 1024;
export const THUMBNAIL_MAX_BYTES = 256 * 1024;

/** Cap control requests before parsers buffer them. Render media stays streamed to storage. */
export const limitRequestBody = createMiddleware(async (c, next) => {
  const path = c.req.path;
  if (/^\/v1\/renders\/[^/]+\/media\/[^/]+$/.test(path)
    || /^\/internal\/worker\/jobs\/[^/]+\/output$/.test(path)
    || !c.req.raw.body) return next();
  const limit = /^\/v1\/(projects|templates)\/[^/]+\/thumbnail$/.test(path) ? THUMBNAIL_MAX_BYTES : JSON_MAX_BYTES;
  const tooLarge = () => fail(413, `This endpoint accepts up to ${limit} bytes.`);
  const declared = Number(c.req.header('content-length'));
  if (declared > limit) tooLarge();
  const reader = c.req.raw.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel().catch(() => {});
        tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  c.req.raw = new Request(c.req.raw, {
    body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }),
    duplex: 'half',
  } as RequestInit);
  await next();
});
