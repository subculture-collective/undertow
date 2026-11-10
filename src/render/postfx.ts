import type { Effects } from '../effects';

/*
 * One WebGL2 pass over the composited frame: CRT curvature, chromatic aberration, scanlines, vignette, then grain.
 * Written for Undertow; LYGIA's shaders were not used (its licence does not allow commercial use).
 */

const VERT = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  uv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
out vec4 outColor;

uniform sampler2D src;
uniform vec2 res;        // output size in pixels
uniform float curve;     // CRT curvature, 0 = flat
uniform float lines;     // scanlines across the short side, 0 = off
uniform float lineStrength;
uniform float split;     // aberration in pixels at the frame edge, 0 = off
uniform float vigAmount; // 0 = off
uniform float vigSoft;
uniform float grainAmount; // 0 = off
uniform float grainCell;   // grain cell size in pixels
uniform uint seed;

// Integer hash (a 3D permutation in the style of PCG); same input, same output on every GPU.
uint mixBits(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v.x ^ v.y ^ v.z;
}

void main() {
  vec2 c = uv * 2.0 - 1.0; // -1..1 across each axis
  if (curve > 0.0) {
    // Barrel warp: the further from the centre, the further out we sample, so edges bow and corners go dark.
    c *= 1.0 + curve * dot(c, c);
    if (abs(c.x) > 1.0 || abs(c.y) > 1.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  }
  vec2 p = c * 0.5 + 0.5;

  vec3 col;
  if (split > 0.0) {
    // Red and blue move apart along the line from the centre, growing toward the edges.
    vec2 d = c * split / res;
    col = vec3(texture(src, p + d).r, texture(src, p).g, texture(src, p - d).b);
  } else {
    col = texture(src, p).rgb;
  }

  if (lines > 0.0) {
    float y = p.y * res.y / min(res.x, res.y) * lines;
    float wave = 0.5 + 0.5 * cos(6.2831853 * y);
    col *= 1.0 - lineStrength * wave;
  }

  if (vigAmount > 0.0) {
    float r = length(c) * 0.70710678; // 0 at the centre, 1 in the corners
    float inner = 1.0 - vigSoft;
    col *= 1.0 - vigAmount * smoothstep(inner * 0.75, inner * 0.75 + vigSoft * 0.9 + 0.1, r);
  }

  if (grainAmount > 0.0) {
    uvec2 cell = uvec2(gl_FragCoord.xy / grainCell);
    float n = float(mixBits(uvec3(cell, seed)) & 0xffffu) / 65535.0;
    col += (n - 0.5) * 2.0 * grainAmount;
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

let warned = false;
function warnOnce(msg: string, e?: unknown) {
  if (warned) return;
  warned = true;
  console.warn(`Effects are off: ${msg}`, e ?? '');
}

/** Owns the WebGL2 context for the effects pass. Create it only when an effect is on. */
export class PostFx {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private buf: WebGLBuffer;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private texW = 0;
  private texH = 0;

  /** Returns null, and warns once, when WebGL2 is unavailable or the shader fails to build. */
  static create(): PostFx | null {
    try {
      return new PostFx();
    } catch (e) {
      warnOnce('WebGL2 is unavailable in this browser.', e);
      return null;
    }
  }

  private constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false,
    });
    if (!gl) throw new Error('no webgl2 context');
    this.gl = gl;
    this.prog = link(gl, VERT, FRAG);
    for (const n of ['src', 'res', 'curve', 'lines', 'lineStrength', 'split', 'vigAmount', 'vigSoft', 'grainAmount', 'grainCell', 'seed']) {
      this.loc[n] = gl.getUniformLocation(this.prog, n);
    }
    this.vao = gl.createVertexArray()!;
    this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(this.prog, 'pos');
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    this.tex = newTexture(gl);
  }

  /**
   * Reads the 2D canvas, runs the pass and draws the result back over it. `t` seeds animated grain, so the same
   * time always gives the same frame. Returns false when the context is lost; the frame is then left as it was.
   */
  apply(ctx: CanvasRenderingContext2D, e: Effects, t: number, bass: number): boolean {
    const { gl, canvas } = this;
    if (gl.isContextLost()) { warnOnce('the WebGL2 context was lost.'); return false; }
    const W = ctx.canvas.width, H = ctx.canvas.height;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const unit = Math.min(W, H) / 1080;

    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (this.texW !== W || this.texH !== H) {
      // Immutable storage sized once; each frame then only copies pixels into it.
      gl.deleteTexture(this.tex);
      this.tex = newTexture(gl);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      this.texW = W; this.texH = H;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas);

    const l = this.loc;
    gl.uniform1i(l.src, 0);
    gl.uniform2f(l.res, W, H);
    gl.uniform1f(l.curve, e.crt.on ? e.crt.curvature : 0);
    // At least 3 pixels per line: finer lines alias into moiré rings, as in a small preview.
    gl.uniform1f(l.lines, e.crt.on && e.crt.strength > 0 ? Math.min(e.crt.density, Math.min(W, H) / 3) : 0);
    gl.uniform1f(l.lineStrength, e.crt.strength);
    gl.uniform1f(l.split, e.aberration.on ? e.aberration.offset * unit * (1 + e.aberration.bass * bass) : 0);
    gl.uniform1f(l.vigAmount, e.vignette.on ? e.vignette.amount : 0);
    gl.uniform1f(l.vigSoft, e.vignette.softness);
    gl.uniform1f(l.grainAmount, e.grain.on ? e.grain.amount : 0);
    gl.uniform1f(l.grainCell, Math.max(1, e.grain.size * unit));
    gl.uniform1ui(l.seed, e.grain.animated ? grainSeed(t) : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(canvas, 0, 0); // same task as the draw, so the buffer is still valid without preserveDrawingBuffer
    ctx.restore();
    return true;
  }

  dispose() {
    const { gl } = this;
    gl.deleteTexture(this.tex);
    gl.deleteBuffer(this.buf);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.prog);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.width = this.canvas.height = 0;
  }
}

/** A new grain pattern each millisecond of song time; export times are exact frame multiples, so re-exports match. */
export const grainSeed = (t: number) => (Math.round(t * 1000) >>> 0) + 1;

function newTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
    gl.attachShader(p, s);
    gl.deleteShader(s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'shader link failed');
  return p;
}
