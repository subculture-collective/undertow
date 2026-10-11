import { Mp4OutputFormat, Output, StreamTarget } from 'mediabunny';

const CHUNK_SIZE = 4 * 1024 * 1024;

/** Seekable Blob chunks let the muxer patch MP4 headers without a file-sized ArrayBuffer. */
export class BlobChunks {
  private chunks = new Map<number, Blob>();
  private size = 0;

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
    return new Blob(parts, { type: 'video/mp4' });
  }

  clear() { this.chunks.clear(); this.size = 0; }
}

export function createBlobOutput() {
  const chunks = new BlobChunks();
  const target = new StreamTarget(new WritableStream({
    write: ({ data, position }) => chunks.write(data, position),
    abort: () => chunks.clear(),
  }), { chunked: true, chunkSize: CHUNK_SIZE });
  // Write media as it arrives, then patch the size header and append metadata.
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
  return { output, finish: () => chunks.finish(), clear: () => chunks.clear() };
}
