import { ALL_FORMATS, BlobSource, CanvasSink, Input, type WrappedCanvas } from 'mediabunny';
import type { DecodedFrame } from '../render/compositor';

/**
 * Decodes one looping clip for export. Export asks for steadily increasing
 * clip times, so frames stream from a single decoder pass; when the clip
 * loops, the time jumps back and the pass restarts from the beginning.
 */
export class ClipReader {
  private it: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  private cur: WrappedCanvas | null = null;
  private next: WrappedCanvas | null = null;
  private lastT = Infinity;

  private constructor(private input: Input, private sink: CanvasSink, private start: number) {}

  /** `maxWidth` caps decode size, so a 4K clip in a 1080p export isn't scaled on every frame. */
  static async open(blob: Blob, name: string, maxWidth: number): Promise<ClipReader> {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`${name} has no video track.`);
    if (!(await track.canDecode())) throw new Error(`This browser cannot decode the video in ${name}. Try an H.264 MP4.`);
    const width = Math.min(track.displayWidth, maxWidth);
    // Three canvases are in use at once (current, next, being decoded); a ring of four leaves headroom.
    const sink = new CanvasSink(track, { width, poolSize: 4 });
    return new ClipReader(input, sink, await track.getFirstTimestamp());
  }

  private async pull() {
    const r = await this.it!.next();
    return r.done ? null : r.value;
  }

  /** The frame on screen at clip time t (seconds from the clip's start). */
  async frameAt(t: number): Promise<DecodedFrame | null> {
    const ts = this.start + t;
    if (!this.it || ts < this.lastT) {
      await this.it?.return();
      this.it = this.sink.canvases(ts);
      this.cur = await this.pull();
      this.next = await this.pull();
    }
    this.lastT = ts;
    while (this.next && this.next.timestamp <= ts + 1e-6) {
      this.cur = this.next;
      this.next = await this.pull();
    }
    return this.cur?.canvas ?? null;
  }

  async close() {
    await this.it?.return();
    this.input.dispose();
  }
}
