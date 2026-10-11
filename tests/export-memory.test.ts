import { afterEach, expect, it, vi } from 'vitest';
import { ALL_FORMATS, BlobSource, BufferTarget, EncodedPacket, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output, EncodedPacketSink } from 'mediabunny';
import { BlobChunks, createBlobOutput } from '../src/export/blobOutput';

afterEach(() => vi.unstubAllGlobals());

it('preserves bytes when MP4 header writes overwrite earlier chunks', async () => {
  const chunks = new BlobChunks();
  const data = new Uint8Array(4 * 1024 * 1024 + 20).fill(7);
  chunks.write(data, 0);
  data.fill(0); // The writer may reuse its buffer after a write.
  const patch = new Uint8Array([1, 2, 3, 4]);
  chunks.write(patch, 4 * 1024 * 1024 - 2);
  const blob = chunks.finish();
  expect(blob.size).toBe(data.length);
  expect(blob.type).toBe('video/mp4');
  expect(new Uint8Array(await blob.slice(4 * 1024 * 1024 - 3, 4 * 1024 * 1024 + 3).arrayBuffer()))
    .toEqual(new Uint8Array([7, 1, 2, 3, 4, 7]));
  expect(chunks.finish().size).toBe(0);
});

async function mux(output: Output) {
  const video = new EncodedVideoPacketSource('vp9');
  output.addVideoTrack(video, { frameRate: 30 });
  await output.start();
  // Synthetic encoded packets test container writing; browser checks test decoding.
  for (let i = 0; i < 12; i++) {
    await video.add(new EncodedPacket(new Uint8Array(1024 * 1024).fill(i), 'key', i / 30, 1 / 30), {
      decoderConfig: { codec: 'vp09.00.10.08', codedWidth: 1280, codedHeight: 720 },
    });
  }
  video.close();
  await output.finalize();
}

it('exports and demuxes a file larger than the permitted individual ArrayBuffer allocation', async () => {
  const NativeArrayBuffer = globalThis.ArrayBuffer;
  vi.stubGlobal('ArrayBuffer', new Proxy(NativeArrayBuffer, {
    construct(target, args) {
      if (Number(args[0]) > 8 * 1024 * 1024 || Number(args[1]?.maxByteLength) > 8 * 1024 * 1024) {
        throw new RangeError('Array buffer allocation failed');
      }
      return Reflect.construct(target, args);
    },
  }));
  const original = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  await expect(mux(original)).rejects.toThrow('Array buffer allocation failed');
  await original.cancel();

  const fixed = createBlobOutput();
  await mux(fixed.output);
  const blob = fixed.finish();
  expect(blob.size).toBeGreaterThan(12 * 1024 * 1024);
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = (await input.getPrimaryVideoTrack())!;
    expect(track.codec).toBe('vp9');
    expect(await input.computeDuration()).toBeCloseTo(12 / 30);
    let count = 0;
    for await (const packet of new EncodedPacketSink(track).packets()) {
      expect(packet.data.length).toBe(1024 * 1024);
      expect(packet.data[0]).toBe(count++);
    }
    expect(count).toBe(12);
  } finally { input.dispose(); }
});
