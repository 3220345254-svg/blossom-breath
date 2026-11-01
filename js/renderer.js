/* 花息 — WebGL2 particle renderer with a custom two-scale bloom.
 * No image assets, no external 3D library. Everything is drawn procedurally.
 */

const VERT_PARTICLES = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aOpen;
layout(location = 1) in vec3 aClosed;
layout(location = 2) in float aSize;
layout(location = 3) in float aSeed;
layout(location = 4) in float aDelay;
layout(location = 5) in float aTint;
layout(location = 6) in float aAlpha;
layout(location = 7) in float aGlow;
layout(location = 8) in float aKind;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uTime;
uniform float uOpen;
uniform float uSizeScale;
uniform vec2 uHand;
uniform vec2 uHandVelocity;
uniform float uHandActive;

out vec3 vColor;
out float vAlpha;
out float vSeed;
out float vSoft;

float ease(float x) {
  return x * x * (3.0 - 2.0 * x);
}

vec3 palette(float t) {
  vec3 gold = vec3(1.00, 0.800, 0.500);
  vec3 coral = vec3(1.00, 0.490, 0.390);
  vec3 rose = vec3(0.960, 0.205, 0.390);
  vec3 violet = vec3(0.520, 0.330, 1.000);
  vec3 c = mix(gold, coral, smoothstep(0.0, 0.38, t));
  c = mix(c, rose, smoothstep(0.38, 0.83, t));
  c = mix(c, violet, smoothstep(0.86, 1.04, t) * 0.40);
  return c;
}

void main() {
  float local = smoothstep(aDelay, 1.0, uOpen);

  // The bud is a compact object; give it a little more presence before it
  // unfolds into the much larger blossom.
  vec3 budPos = (aClosed - vec3(0.0, -0.02, 0.0)) * 1.18 + vec3(0.0, -0.02, 0.0);
  budPos.x *= 1.14;
  budPos.z *= 1.10;
  vec3 pos = mix(budPos, aOpen, local);
  if ((aKind > 7.5 && aKind < 8.5) || aKind > 10.5) pos = aClosed;

  // A soft outward arc while the flower travels between bud and blossom.
  float arc = sin(clamp(local, 0.0, 1.0) * 3.14159265);
  vec2 radialDir = normalize(pos.xy + vec2(0.0001));
  pos.xy += radialDir * arc * (0.025 + 0.035 * aSeed);
  pos.z += arc * 0.075;

  // Petal breathing.
  if (aKind < 0.5) {
    float breath = sin(uTime * 0.73 + aSeed * 6.283 + aTint * 1.4);
    pos.xy *= 1.0 + breath * 0.0065 * (0.35 + local);
    pos.z += sin(uTime * 0.51 + aSeed * 13.0) * 0.008;
  }

  // Core keeps a quiet heartbeat.
  if (aKind > 0.5 && aKind < 1.5) {
    float pulse = sin(uTime * 1.35 + aSeed * 4.0);
    pos.xy *= 1.0 + pulse * 0.007;
    pos.z += pulse * 0.006;
  }

  // Pollen rotates slowly around the flower and gets livelier when open.
  if (aKind > 1.5 && aKind < 2.5) {
    float angle = uTime * (0.045 + aSeed * 0.085) * (0.25 + 0.75 * local);
    float c = cos(angle);
    float s = sin(angle);
    pos.xy = mat2(c, -s, s, c) * pos.xy;
    pos.xy *= 1.0 + sin(uTime * 0.47 + aSeed * 21.0) * 0.024 * local;
    pos.z += sin(uTime * 0.33 + aSeed * 31.0) * 0.03;
  }

  // Fingertip attraction: only a whisper, enough to feel alive.
  float influence = 0.0;
  if (uHandActive > 0.001) {
    float d = distance(pos.xy, uHand);
    influence = (1.0 - smoothstep(0.04, 0.95, d)) * uHandActive;
    pos.xy += (uHand - pos.xy) * influence * 0.105;
    pos.xy += uHandVelocity * influence * 0.045;
    pos.z += influence * 0.095;
  }

  vec3 col = palette(aTint);
  if (aKind > 1.5 && aKind < 2.5 && aSeed > 0.84) {
    col = mix(col, vec3(0.58, 0.92, 1.0), 0.75);
  }
  if (aKind > 2.5 && aKind < 3.5) {
    col = mix(col, vec3(0.55, 0.72, 1.0), 0.22);
  }
  if (aKind > 7.5 && aKind < 8.5) {
    // A muted mossy stem against the warm flower.
    col = mix(vec3(0.47, 0.59, 0.27), vec3(0.84, 0.74, 0.36), aTint * 2.2);
  }
  if (aKind > 10.5) {
    col = mix(vec3(0.52, 0.66, 0.29), vec3(0.96, 0.81, 0.40), aTint * 0.65);
  }
  if (aKind < 0.5 && aGlow > 1.05) {
    col = mix(col, vec3(1.0, 0.92, 0.78), 0.26);
  }
  col *= 0.74 + 0.48 * aGlow;
  col += vec3(1.0, 0.66, 0.34) * influence * 0.42;

  float openEase = smoothstep(0.0, 0.55, uOpen);

  float alpha = aAlpha;
  // The bud is tiny on screen, so the same 40k additive points would clip to
  // white. Dim the petals as they gather, then recover their light as the
  // flower opens and the same particles spread across the frame.
  if (aKind < 0.5) {
    alpha *= mix(0.20, 1.0, openEase);
    // Keep the crowded petal bases from forming a hot ring at the heart; the
    // core and pollen own that part of the flower.
    float rNorm = clamp(length(aOpen.xy) / 1.70, 0.0, 1.0);
    alpha *= mix(0.30, 1.0, smoothstep(0.02, 0.30, rNorm));
  }
  if (aKind > 0.5 && aKind < 1.5) {
    alpha *= mix(0.05, 0.38, smoothstep(0.04, 0.50, uOpen));
  }
  if (aKind > 1.5 && aKind < 2.5) {
    alpha *= mix(0.30, 1.0, openEase);
  }
  if (aKind > 3.5 && aKind < 5.5) {
    alpha *= 1.0 - smoothstep(0.06, 0.50, uOpen);
  }
  if (aKind > 5.5 && aKind < 6.5) {
    alpha *= smoothstep(0.42, 0.06, uOpen);
  }
  if (aKind > 6.5 && aKind < 8.5) {
    alpha *= 1.0 - smoothstep(0.08, 0.42, uOpen);
  }
  if (aKind > 9.5) {
    // A veil of soft, wide points gives the petals body without stealing the
    // crisp edge light.
    alpha *= mix(0.16, 1.0, openEase);
  }
  if (aKind > 2.5 && aKind < 3.5) {
    alpha *= mix(0.55, 1.0, uOpen);
  }
  if (aKind > 7.5 && aKind < 8.5) {
    alpha *= mix(1.0, 0.72, openEase);
  }
  if (aKind > 10.5) {
    alpha *= 1.0 - smoothstep(0.06, 0.40, uOpen);
  }
  alpha *= 1.0 + influence * 0.65;
  alpha *= 0.84 + 0.16 * sin(uTime * 1.7 + aSeed * 40.0);

  vColor = col;
  vAlpha = alpha;
  vSeed = aSeed;
  vSoft = aKind > 9.5 ? 1.0 : 0.0;

  vec4 world = uModel * vec4(pos, 1.0);
  vec4 mv = uView * world;
  gl_Position = uProj * mv;

  float pointSize = aSize * uSizeScale * (18.0 / max(-mv.z, 0.35));
  pointSize *= mix(0.64, 1.0, openEase);
  if (aKind > 3.5) pointSize /= mix(0.64, 1.0, openEase);
  if (aKind > 6.5) pointSize *= 1.15;
  gl_PointSize = clamp(pointSize, 1.2, 24.0);
}
`;

const FRAG_PARTICLES = `#version 300 es
precision highp float;

in vec3 vColor;
in float vAlpha;
in float vSeed;
in float vSoft;

out vec4 outColor;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;

  float core = exp(-r2 * 8.5);
  float soft = exp(-r2 * 2.7) * 0.42 + exp(-r2 * 7.0) * 0.16;
  float alpha = mix((core + exp(-r2 * 2.35) * 0.26) * vAlpha, soft * vAlpha, vSoft);

  vec3 col = vColor * (0.72 + 0.72 * core);
  outColor = vec4(col, alpha);
}
`;

const VERT_QUAD = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAG_BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
out vec4 outColor;
void main() {
  vec3 c = texture(uSource, vUv).rgb;
  float lum = max(c.r, max(c.g, c.b));
  float keep = smoothstep(0.18, 0.62, lum);
  outColor = vec4(c * keep, 1.0);
}
`;

const FRAG_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform vec2 uDir;
out vec4 outColor;
void main() {
  vec2 d = uTexel * uDir;
  vec3 c = texture(uSource, vUv).rgb * 0.2270270270;
  c += texture(uSource, vUv + d * 1.3846153846).rgb * 0.3162162162;
  c += texture(uSource, vUv - d * 1.3846153846).rgb * 0.3162162162;
  c += texture(uSource, vUv + d * 3.2307692308).rgb * 0.0702702703;
  c += texture(uSource, vUv - d * 3.2307692308).rgb * 0.0702702703;
  outColor = vec4(c, 1.0);
}
`;

const FRAG_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;

uniform sampler2D uScene;
uniform sampler2D uBloomSoft;
uniform sampler2D uBloomWide;
uniform vec2 uResolution;
uniform vec2 uFlowerScreen;
uniform vec2 uHandScreen;
uniform float uHandActive;
uniform float uTime;
uniform float uOpen;

out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += valueNoise(p) * a;
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 fp = (uv - uFlowerScreen) * vec2(aspect, 1.0);
  float dist = length(fp);

  vec3 col = mix(vec3(0.0035, 0.0055, 0.0120), vec3(0.0090, 0.0042, 0.0095), uv.y);
  col += vec3(1.00, 0.255, 0.360) * 0.030 * exp(-dist * dist * 5.3);
  col += vec3(0.235, 0.470, 0.880) * 0.012 * exp(-dist * dist * 1.72);

  // slow atmospheric folds
  float n = fbm(uv * vec2(aspect, 1.0) * 2.35 + vec2(uTime * 0.0065, -uTime * 0.0042));
  vec3 haze = mix(vec3(0.055, 0.014, 0.045), vec3(0.010, 0.038, 0.060), n);
  col += haze * (n * n) * 0.24 * smoothstep(0.9, 0.15, dist);

  // faint hand light in the room
  vec2 hp = (uv - uHandScreen) * vec2(aspect, 1.0);
  float handGlow = exp(-dot(hp, hp) * 58.0);
  col += vec3(1.0, 0.58, 0.32) * 0.020 * handGlow * uHandActive;

  // bloom halo around the flower
  float halo = exp(-dist * 3.1);
  col += vec3(1.0, 0.32, 0.40) * 0.012 * halo * (0.45 + uOpen * 0.55);

  vec3 scene = texture(uScene, uv).rgb;
  vec3 soft = texture(uBloomSoft, uv).rgb;
  vec3 wide = texture(uBloomWide, uv).rgb;

  col += scene;
  col += soft * 0.78;
  col += wide * 0.98;

  // soft shoulder, keeps the highlights coloured instead of white
  col = 1.0 - exp(-col * 2.05);

  // vignette
  float vig = smoothstep(1.25, 0.28, length(p));
  col *= mix(0.52, 1.0, vig);

  // fine film grain
  float grain = hash21(gl_FragCoord.xy + fract(uTime) * 731.0) - 0.5;
  col += grain * 0.010;

  outColor = vec4(max(col, 0.0), 1.0);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }
  return program;
}

function createTarget(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: ${status}`);
  }
  return { texture, fbo, width, height };
}

function deleteTarget(gl, target) {
  if (!target) return;
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.fbo);
}

// Column-major 4x4 helpers
function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function mat4Translation(x, y, z) {
  const m = mat4Identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

function mat4RotationX(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function mat4RotationY(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function mat4RotationZ(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function mat4Scale(s) {
  return new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
}

export class FlowerRenderer {
  constructor(canvas, geometry) {
    this.canvas = canvas;
    this.geometry = geometry;
    this.gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!this.gl) throw new Error('WebGL2 is not available in this browser');

    const gl = this.gl;
    this.camera = { fov: (34 * Math.PI) / 180, z: 8.8, near: 0.1, far: 40 };
    this.view = mat4Translation(0, 0, -this.camera.z);
    this.projection = mat4Perspective(this.camera.fov, 1, this.camera.near, this.camera.far);
    this.viewProj = mat4Multiply(this.projection, this.view);

    this.programs = {
      particles: createProgram(gl, VERT_PARTICLES, FRAG_PARTICLES),
      bright: createProgram(gl, VERT_QUAD, FRAG_BRIGHT),
      blur: createProgram(gl, VERT_QUAD, FRAG_BLUR),
      composite: createProgram(gl, VERT_QUAD, FRAG_COMPOSITE),
    };
    this.uniformCache = new Map();

    this.quadVao = gl.createVertexArray();
    this.particleVao = gl.createVertexArray();
    this.createParticleBuffers();

    this.sceneTarget = null;
    this.halfA = null;
    this.halfB = null;
    this.quarterA = null;
    this.quarterB = null;
    this.width = 1;
    this.height = 1;
    this.resize();
  }

  uniform(program, name) {
    let cache = this.uniformCache.get(program);
    if (!cache) {
      cache = new Map();
      this.uniformCache.set(program, cache);
    }
    let location = cache.get(name);
    if (location === undefined) {
      location = this.gl.getUniformLocation(program, name);
      cache.set(name, location);
    }
    return location;
  }

  createParticleBuffers() {
    const gl = this.gl;
    const g = this.geometry;
    gl.bindVertexArray(this.particleVao);

    const attrs = [
      [0, g.open, 3],
      [1, g.closed, 3],
      [2, g.size, 1],
      [3, g.seed, 1],
      [4, g.delay, 1],
      [5, g.tint, 1],
      [6, g.alpha, 1],
      [7, g.glow, 1],
      [8, g.kind, 1],
    ];

    for (const [location, data, size] of attrs) {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }

    gl.bindVertexArray(null);
  }

  resize() {
    const gl = this.gl;
    const cssWidth = Math.max(1, this.canvas.clientWidth);
    const cssHeight = Math.max(1, this.canvas.clientHeight);
    const maxPixels = 3600000;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    while (cssWidth * cssHeight * dpr * dpr > maxPixels && dpr > 1) {
      dpr -= 0.1;
    }
    dpr = Math.max(1, dpr);
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));

    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    // On portrait screens the flower would overflow the horizontal field of
    // view, so pull the camera back until the bloom fits with breathing room.
    const aspect = width / height;
    this.camera.z = Math.max(8.8, 7.15 / Math.max(aspect, 0.2));
    this.view = mat4Translation(0, 0, -this.camera.z);
    this.projection = mat4Perspective(this.camera.fov, aspect, this.camera.near, this.camera.far);
    this.viewProj = mat4Multiply(this.projection, this.view);

    deleteTarget(gl, this.sceneTarget);
    deleteTarget(gl, this.halfA);
    deleteTarget(gl, this.halfB);
    deleteTarget(gl, this.quarterA);
    deleteTarget(gl, this.quarterB);

    this.sceneTarget = createTarget(gl, width, height);
    const hw = Math.max(1, Math.floor(width / 2));
    const hh = Math.max(1, Math.floor(height / 2));
    const qw = Math.max(1, Math.floor(width / 4));
    const qh = Math.max(1, Math.floor(height / 4));
    this.halfA = createTarget(gl, hw, hh);
    this.halfB = createTarget(gl, hw, hh);
    this.quarterA = createTarget(gl, qw, qh);
    this.quarterB = createTarget(gl, qw, qh);
    this.halfSize = [hw, hh];
    this.quarterSize = [qw, qh];
  }

  projectWorld(world, model) {
    const x = model[0] * world.x + model[4] * world.y + model[8] * world.z + model[12];
    const y = model[1] * world.x + model[5] * world.y + model[9] * world.z + model[13];
    const z = model[2] * world.x + model[6] * world.y + model[10] * world.z + model[14];
    const w = model[3] * world.x + model[7] * world.y + model[11] * world.z + model[15];
    const nx = x / (w || 1);
    const ny = y / (w || 1);
    const nz = z / (w || 1);
    const cx = this.viewProj[0] * nx + this.viewProj[4] * ny + this.viewProj[8] * nz + this.viewProj[12];
    const cy = this.viewProj[1] * nx + this.viewProj[5] * ny + this.viewProj[9] * nz + this.viewProj[13];
    const cw = this.viewProj[3] * nx + this.viewProj[7] * ny + this.viewProj[11] * nz + this.viewProj[15];
    return {
      x: (cx / (cw || 1)) * 0.5 + 0.5,
      y: (cy / (cw || 1)) * 0.5 + 0.5,
    };
  }

  render(state) {
    const gl = this.gl;
    this.resize();

    const { open, time, offsetX, offsetY, rotX, rotY, rotZ, scale, hand, handVelocity, handActive } = state;

    const model = mat4Multiply(
      mat4Translation(offsetX, offsetY, 0),
      mat4Multiply(
        mat4RotationZ(rotZ),
        mat4Multiply(
          mat4RotationY(rotY),
          mat4Multiply(mat4RotationX(rotX), mat4Scale(scale))
        )
      )
    );

    const flowerScreen = this.projectWorld({ x: 0, y: 0, z: 0 }, model);
    const handScreen = this.projectWorld({ x: hand.x, y: hand.y, z: 0.05 }, model);

    // ---------- particle scene ----------
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    const particleProgram = this.programs.particles;
    gl.useProgram(particleProgram);
    gl.uniformMatrix4fv(this.uniform(particleProgram, 'uModel'), false, model);
    gl.uniformMatrix4fv(this.uniform(particleProgram, 'uView'), false, this.view);
    gl.uniformMatrix4fv(this.uniform(particleProgram, 'uProj'), false, this.projection);
    gl.uniform1f(this.uniform(particleProgram, 'uTime'), time);
    gl.uniform1f(this.uniform(particleProgram, 'uOpen'), open);
    gl.uniform1f(this.uniform(particleProgram, 'uSizeScale'), this.height / 900);
    gl.uniform2f(this.uniform(particleProgram, 'uHand'), hand.x, hand.y);
    gl.uniform2f(this.uniform(particleProgram, 'uHandVelocity'), handVelocity.x, handVelocity.y);
    gl.uniform1f(this.uniform(particleProgram, 'uHandActive'), handActive);
    gl.bindVertexArray(this.particleVao);
    gl.drawArrays(gl.POINTS, 0, this.geometry.count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);

    // ---------- bright pass ----------
    const brightProgram = this.programs.bright;
    this.drawPass(brightProgram, this.halfA, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.texture);
      gl.uniform1i(this.uniform(brightProgram, 'uSource'), 0);
    });

    // ---------- bloom chain: half ----------
    this.blurPass(this.halfA, this.halfB, 1.75, true);
    this.blurPass(this.halfB, this.halfA, 1.75, false);
    this.blurPass(this.halfA, this.halfB, 3.5, true);
    this.blurPass(this.halfB, this.halfA, 3.5, false);

    // ---------- bloom chain: quarter ----------
    const copyProgram = this.programs.blur;
    this.drawPass(copyProgram, this.quarterA, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.halfA.texture);
      gl.uniform1i(this.uniform(copyProgram, 'uSource'), 0);
      gl.uniform2f(this.uniform(copyProgram, 'uTexel'), 1 / this.halfSize[0], 1 / this.halfSize[1]);
      gl.uniform2f(this.uniform(copyProgram, 'uDir'), 0, 0);
    });
    this.blurPass(this.quarterA, this.quarterB, 2.25, true);
    this.blurPass(this.quarterB, this.quarterA, 2.25, false);

    // ---------- composite ----------
    const composite = this.programs.composite;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(composite);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.quadVao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.texture);
    gl.uniform1i(this.uniform(composite, 'uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.halfA.texture);
    gl.uniform1i(this.uniform(composite, 'uBloomSoft'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.quarterA.texture);
    gl.uniform1i(this.uniform(composite, 'uBloomWide'), 2);

    gl.uniform2f(this.uniform(composite, 'uResolution'), this.width, this.height);
    gl.uniform2f(this.uniform(composite, 'uFlowerScreen'), flowerScreen.x, flowerScreen.y);
    gl.uniform2f(this.uniform(composite, 'uHandScreen'), handScreen.x, handScreen.y);
    gl.uniform1f(this.uniform(composite, 'uHandActive'), handActive);
    gl.uniform1f(this.uniform(composite, 'uTime'), time);
    gl.uniform1f(this.uniform(composite, 'uOpen'), open);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  drawPass(program, target, setUniforms) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
    gl.useProgram(program);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.quadVao);
    setUniforms();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  blurPass(source, target, radius, horizontal) {
    const gl = this.gl;
    const program = this.programs.blur;
    this.drawPass(program, target, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source.texture);
      gl.uniform1i(this.uniform(program, 'uSource'), 0);
      gl.uniform2f(this.uniform(program, 'uTexel'), 1 / source.width, 1 / source.height);
      gl.uniform2f(this.uniform(program, 'uDir'), horizontal ? radius : 0, horizontal ? 0 : radius);
    });
  }
}
