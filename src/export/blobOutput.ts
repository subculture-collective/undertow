import { Mp4OutputFormat, Output, StreamTarget, WebMOutputFormat } from 'mediabunny';

export type Container = 'mp4' | 'webm';
export const CONTAINER_MIME: Record<Container, string> = { mp4: 'video/mp4', webm: 'video/webm' };

const CHUNK_SIZE = 4 * 1024 * 1024;

/** Seekable Blob chunks let the muxer patch MP4 and WebM headers without a file-sized ArrayBuffer. */
export class BlobChunks {
  private chunks = new Map<number, Blob>();
  private size = 0;

  constructor(private readonly type = 'video/mp4') {}

  write(data: Uint8Array<ArrayBuffer>, position: number) {
    for (let offset = 0; offset < data.length;) {
      const index = Math.floor(position / CHUNK_SIZE);
      const start = position % CHUNK_SIZE;
      const length = Math.min(data.length - offset, CHUNK_SIZE - start);
      const previous = this.chunks.get(index) ?? new Blob();
      this.chunks.set(index, new Blob([
        previous.slice(0, start),
        new Uint8Array(Math.max(0, start - previous.size)),
        data.subarray(offset, offset + length),
        previous.slice(start + length),
      ]));
      offset += length;
      position += length;
    }
    this.size = Math.max(this.size, position);
  }

  finish(): Blob {
    const parts: Blob[] = [];
    for (let index = 0; index * CHUNK_SIZE < this.size; index++) {
      const length = Math.min(CHUNK_SIZE, this.size - index * CHUNK_SIZE);
      const chunk = this.chunks.get(index) ?? new Blob();
      parts.push(new Blob([chunk, new Uint8Array(Math.max(0, length - chunk.size))]));
    }
    this.clear();
    return new Blob(parts, { type: this.type });
  }

  clear() { this.chunks.clear(); this.size = 0; }
}

export function createBlobOutput(container: Container = 'mp4') {
  const chunks = new BlobChunks(CONTAINER_MIME[container]);
  const target = new StreamTarget(new WritableStream({
    write: ({ data, position }) => chunks.write(data, position),
    abort: () => chunks.clear(),
  }), { chunked: true, chunkSize: CHUNK_SIZE });
  // Write media as it arrives, then patch the size header (MP4) or duration and cues (WebM) at the end.
  const format = container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: false });
  const output = new Output({ format, target });
  return { output, finish: () => chunks.finish(), clear: () => chunks.clear() };
}
