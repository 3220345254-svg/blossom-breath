/* 花息 — procedural flower point cloud
 * Every particle carries both an open-flower position and a closed-bud position.
 * The vertex shader blends between the two, so the whole transformation stays on the GPU.
 */

const TAU = Math.PI * 2;

const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function buildPetalVeil(layer, petals, perPetal, out) {
  const isInner = layer.index === 1;
  const length = layer.length;
  const width = layer.width;
  const layerZ = layer.z;
  const angleOffset = layer.angleOffset;

  // Broad, faint points that sit between the crisp petals. They are not a
  // replacement for geometry; they are the warm air inside the bloom, so the
  // flower reads as light rather than as a wireframe.
  for (let p = 0; p < petals; p++) {
    const baseAngle = angleOffset + (p / petals) * TAU;
    const ca = Math.cos(baseAngle);
    const sa = Math.sin(baseAngle);

    for (let i = 0; i < perPetal; i++) {
      const u = Math.pow(Math.random(), 0.60);
      const v = rand(-0.9, 0.9);
      const profile = Math.sin(Math.PI * Math.pow(u, 0.76));
      const localWidth =
        width *
        (0.045 + 0.955 * Math.pow(profile, 0.82)) *
        (1 - 0.16 * u);

      const across = v * localWidth;
      const radial = u * length;
      const vNorm = localWidth > 1e-5 ? across / localWidth : 0;

      const ox = ca * radial - sa * across;
      const oy = sa * radial + ca * across;
      const oz =
        layerZ +
        Math.sin(Math.PI * u) * (0.035 + 0.20 * vNorm * vNorm) +
        0.11 * u * u +
        Math.sin(baseAngle * 3 + p * 1.7) * 0.025;

      const bu = clamp(u * 0.985, 0, 1);
      const budProfile = Math.sin(Math.PI * clamp((bu + 0.10) / 1.12, 0, 1));
      const fold = 0.40 + 0.55 * (1 - Math.abs(vNorm));
      const budRadius =
        (0.045 + 0.245 * Math.pow(budProfile, 0.72)) *
        (isInner ? 0.84 : 1.045) *
        fold;
      const phi =
        baseAngle * 0.68 +
        bu * 0.55 +
        vNorm * 0.52 +
        (isInner ? 2.0 : 0) +
        0.30;
      const lean = 0.085 * bu * bu;
      const cx = Math.cos(phi) * budRadius * 1.02 + lean;
      const cy =
        -0.70 +
        1.34 * bu +
        (isInner ? -0.035 : 0.025) +
        vNorm * 0.022 +
        Math.sin(baseAngle * 2.3 + (isInner ? 1.1 : 0)) * 0.035 * bu * bu;
      const cz =
        0.21 +
        Math.sin(phi) * budRadius * 0.92 +
        (isInner ? 0.075 : 0) +
        Math.sin(bu * Math.PI) * 0.035;

      out.push({
        open: [ox, oy, oz],
        closed: [cx, cy, cz],
        size: rand(2.5, 5.0),
        seed: Math.random(),
        delay: clamp(u * 0.23 + (isInner ? 0.08 : 0) + Math.random() * 0.035, 0, 0.34),
        tint: clamp(0.04 + u * (isInner ? 0.62 : 0.9) + rand(-0.05, 0.05), 0, 1),
        alpha: rand(0.030, 0.072) * (0.24 + 0.76 * Math.min(1, u * 1.7)),
        glow: rand(0.12, 0.30),
        kind: 10,
      });
    }
  }
}

function buildPetal(layer, petals, perPetal, out) {
  const isInner = layer.index === 1;
  const length = layer.length;
  const width = layer.width;
  const layerZ = layer.z;
  const angleOffset = layer.angleOffset;

  for (let p = 0; p < petals; p++) {
    const baseAngle = angleOffset + (p / petals) * TAU;
    const ca = Math.cos(baseAngle);
    const sa = Math.sin(baseAngle);

    for (let i = 0; i < perPetal; i++) {
      const roll = Math.random();
      let type; // 0 fill, 1 vein, 2 rim
      if (roll < 0.24) type = 2;
      else if (roll < 0.58) type = 1;
      else type = 0;

      let u;
      let v;
      let rim = 0;

      if (type === 2) {
        // bright petal edge, with a few double-outline sparkles
        const side = Math.random() < 0.5 ? -1 : 1;
        u = Math.pow(Math.random(), 0.92);
        v = side * rand(0.86, 1.0);
        rim = 1;
      } else if (type === 1) {
        // fine filaments following the length of the petal
        const vein = Math.round(rand(-5, 5));
        u = Math.pow(Math.random(), 0.9);
        v = (vein / 5) * 0.76 + Math.sin(u * 8 + p) * 0.018;
      } else {
        u = Math.pow(Math.random(), 0.96);
        v = rand(-1, 1);
      }

      const profile = Math.sin(Math.PI * Math.pow(u, 0.76));
      const localWidth =
        width *
        (0.045 + 0.955 * Math.pow(profile, 0.82)) *
        (1 - 0.16 * u);

      const across = v * localWidth;
      const radial = u * length;
      const vNorm = localWidth > 1e-5 ? across / localWidth : 0;

      // ---------- open blossom ----------
      let ox = ca * radial - sa * across;
      let oy = sa * radial + ca * across;
      let oz =
        layerZ +
        Math.sin(Math.PI * u) * (0.035 + 0.20 * vNorm * vNorm) +
        0.11 * u * u +
        Math.sin(baseAngle * 3 + p * 1.7) * 0.025;

      // a whisper of asymmetry so the flower never feels mechanically perfect
      const wobble = Math.sin(baseAngle * 5.0 + u * 3.2 + p) * 0.012;
      ox += -sa * wobble;
      oy += ca * wobble;

      // ---------- closed bud ----------
      const bu = clamp(u * 0.985, 0, 1);
      const budProfile = Math.sin(Math.PI * clamp((bu + 0.10) / 1.12, 0, 1));
      // Fold the petal around a solid core instead of keeping every point on
      // the outer skin: the spine stays proud, the edges tuck inward. This is
      // what turns the closed silhouette into a bud with volume rather than a
      // hollow ring of light.
      const fold =
        type === 2
          ? 1.0
          : type === 1
            ? 0.72 + 0.26 * (1 - Math.abs(vNorm))
            : 0.40 + 0.55 * (1 - Math.abs(vNorm));
      const budRadius =
        (0.045 + 0.245 * Math.pow(budProfile, 0.72)) *
        (isInner ? 0.84 : 1.045) *
        fold;
      const phi =
        baseAngle * 0.68 +
        bu * 0.55 +
        vNorm * 0.52 +
        (isInner ? 2.0 : 0) +
        0.30;
      const lean = 0.085 * bu * bu;
      const cx = Math.cos(phi) * budRadius * 1.02 + lean;
      const cy =
        -0.70 +
        1.34 * bu +
        (isInner ? -0.035 : 0.025) +
        vNorm * 0.022 +
        Math.sin(baseAngle * 2.3 + (isInner ? 1.1 : 0)) * 0.035 * bu * bu;
      const cz =
        0.21 +
        Math.sin(phi) * budRadius * 0.92 +
        (isInner ? 0.075 : 0) +
        Math.sin(bu * Math.PI) * 0.035;

      const edgeBoost = rim ? 1 : 0;
      const veinBoost = type === 1 ? 0.35 : 0;
      const tint = clamp(
        0.025 +
          u * (isInner ? 0.64 : 0.94) +
          (isInner ? 0.05 : 0.11) +
          (Math.random() - 0.5) * 0.12 +
          edgeBoost * 0.035,
        0,
        1
      );
      const alpha =
        (type === 2 ? rand(0.44, 0.9) : type === 1 ? rand(0.22, 0.52) : rand(0.16, 0.46)) *
        (isInner ? 0.9 : 0.82);
      const size =
        type === 2
          ? rand(1.05, 2.45) + (Math.random() < 0.07 ? rand(0.8, 1.8) : 0)
          : type === 1
            ? rand(0.65, 1.48)
            : rand(0.62, 1.85);
      const glow =
        type === 2 ? rand(0.95, 1.55) : type === 1 ? rand(0.32, 0.78) : rand(0.08, 0.42);
      const delay = clamp(u * 0.23 + (isInner ? 0.08 : 0) + Math.random() * 0.035, 0, 0.34);

      out.push({
        open: [ox, oy, oz],
        closed: [cx, cy, cz],
        size,
        seed: Math.random(),
        delay,
        tint,
        alpha,
        glow,
        kind: 0,
      });
    }
  }
}

function buildCore(out) {
  const coreCount = 3300;
  for (let i = 0; i < coreCount; i++) {
    const mode = Math.random();
    let ox;
    let oy;
    let oz;
    let cx;
    let cy;
    let cz;
    let size;
    let alpha;
    let tint;
    let glow;

    if (mode < 0.58) {
      // luminous pollen heart
      const a = rand(0, TAU);
      const r = 0.035 + 0.205 * Math.pow(Math.random(), 1.55);
      const zBias = rand(-0.055, 0.12);
      ox = Math.cos(a) * r;
      oy = Math.sin(a) * r * 0.88;
      oz = 0.18 + zBias + Math.sin(a * 3) * 0.02;
      cx = ox * 0.30;
      cy = oy * 0.34 + 0.13;
      cz = 0.33 + zBias * 0.7;
      size = rand(0.46, 1.40);
      alpha = rand(0.12, 0.36);
      tint = rand(0.0, 0.17);
      glow = rand(0.8, 1.75);
    } else if (mode < 0.9) {
      // stamen filaments radiating into the petals
      const a = rand(0, TAU);
      const rr = rand(0.16, 0.44);
      const along = Math.pow(Math.random(), 0.75);
      const bend = Math.sin(along * 2.1) * 0.05;
      ox = Math.cos(a) * rr * along + Math.cos(a + 1.57) * bend;
      oy = Math.sin(a) * rr * along * 0.88 + Math.sin(a + 1.57) * bend;
      oz = 0.19 + along * 0.11 + rand(-0.02, 0.02);
      cx = Math.cos(a) * 0.08 + Math.cos(a + 1.57) * bend * 0.5;
      cy = Math.sin(a) * 0.09 + 0.13;
      cz = 0.34 + along * 0.04;
      size = rand(0.44, 1.10);
      alpha = rand(0.09, 0.30);
      tint = rand(0.02, 0.24);
      glow = rand(0.55, 1.2);
    } else {
      // floating hot sparks
      const a = rand(0, TAU);
      const r = rand(0.02, 0.5);
      ox = Math.cos(a) * r;
      oy = Math.sin(a) * r * 0.9;
      oz = rand(0.25, 0.52);
      cx = ox * 0.34;
      cy = oy * 0.36 + 0.12;
      cz = 0.35;
      size = rand(0.8, 2.4);
      alpha = rand(0.10, 0.30);
      tint = rand(0.0, 0.1);
      glow = rand(1.0, 2.2);
    }

    out.push({
      open: [ox, oy, oz],
      closed: [cx, cy, cz],
      size,
      seed: Math.random(),
      delay: Math.random() * 0.1,
      tint,
      alpha,
      glow,
      kind: 1,
    });
  }
}

function buildPollen(out) {
  const count = 1050;
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU);
    const ring = Math.random();
    const radius = 1.08 + 1.75 * Math.pow(ring, 1.55);
    const ox = Math.cos(a) * radius;
    const oy = Math.sin(a) * radius * 0.76;
    const oz = rand(-1.15, 1.1);

    const ca = rand(0, TAU);
    const cr = rand(0.34, 0.68);
    const cx = Math.cos(ca) * cr;
    const cy = 0.02 + Math.sin(ca) * cr * 0.82 + 0.10;
    const cz = rand(0.18, 0.64);

    const cyan = Math.random() < 0.16;
    const tint = cyan ? rand(0.88, 1.08) : rand(0.42, 0.98);
    out.push({
      open: [ox, oy, oz],
      closed: [cx, cy, cz],
      size: cyan ? rand(1.0, 2.7) : rand(0.55, 2.25),
      seed: Math.random(),
      delay: rand(0.02, 0.22),
      tint,
      alpha: cyan ? rand(0.30, 0.8) : rand(0.12, 0.62),
      glow: cyan ? rand(0.9, 1.8) : rand(0.25, 1.05),
      kind: 2,
    });
  }
}

function buildDust(out) {
  const count = 560;
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU);
    const radius = rand(2.2, 7.6);
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius * rand(0.5, 0.95);
    const z = rand(-4.2, -1.3);
    out.push({
      open: [x, y, z],
      closed: [x, y, z],
      size: rand(0.55, 1.7),
      seed: Math.random(),
      delay: 0,
      tint: rand(0.28, 0.95),
      alpha: rand(0.035, 0.18),
      glow: rand(0.2, 0.8),
      kind: 3,
    });
  }
}

function budSurfaceRadius(bu) {
  const profile = Math.sin(Math.PI * clamp((bu + 0.08) / 1.10, 0, 1));
  return (0.045 + 0.250 * Math.pow(profile, 0.7)) * 1.10;
}

function buildBudShell(out) {
  // A translucent outer skin that only exists while the flower is a bud.
  const shellCount = 3200;
  for (let i = 0; i < shellCount; i++) {
    const bu = Math.pow(Math.random(), 0.92);
    const a = rand(0, TAU) + bu * 0.7;
    const radius = budSurfaceRadius(bu) * rand(0.52, 1.03);
    const y = -0.72 + 1.40 * bu + rand(-0.02, 0.02);
    const x = Math.cos(a) * radius + 0.085 * bu * bu;
    const z = 0.22 + Math.sin(a) * radius * 0.92;
    out.push({
      open: [x, y, z],
      closed: [x, y, z],
      size: rand(0.8, 2.2),
      seed: Math.random(),
      delay: 0,
      tint: rand(0.55, 1.04),
      alpha: rand(0.08, 0.24),
      glow: rand(0.2, 0.7),
      kind: 4,
    });
  }

  // Fine golden seams spiralling around the bud.
  const seamCount = 6;
  for (let s = 0; s < seamCount; s++) {
    const offset = (s / seamCount) * TAU;
    for (let i = 0; i < 95; i++) {
      const bu = clamp(i / 94 + rand(-0.006, 0.006), 0, 1);
      const radius = budSurfaceRadius(bu) * 1.015;
      const a = offset + bu * 1.1;
      const x = Math.cos(a) * radius + 0.085 * bu * bu;
      const y = -0.72 + 1.40 * bu;
      const z = 0.22 + Math.sin(a) * radius * 0.92 + 0.015;
      out.push({
        open: [x, y, z],
        closed: [x, y, z],
        size: rand(0.6, 1.7),
        seed: Math.random(),
        delay: 0,
        tint: rand(0.02, 0.22),
        alpha: rand(0.22, 0.7),
        glow: rand(0.8, 1.5),
        kind: 5,
      });
    }
  }
}

function buildBudBody(out) {
  // Solid luminous heart of the bud. The shell gives the silhouette, these
  // particles give it body so the closed flower reads as a bud, not a wire.
  const count = 6800;
  for (let i = 0; i < count; i++) {
    const bu = Math.pow(Math.random(), 0.9);
    const profile = Math.sin(Math.PI * clamp((bu + 0.08) / 1.10, 0, 1));
    const shell = budSurfaceRadius(bu);
    const r = 0.010 + shell * 0.94 * Math.pow(Math.random(), 0.58);
    const a = rand(0, TAU) + bu * 0.7;
    const y = -0.70 + 1.35 * bu + rand(-0.015, 0.015);
    const x = Math.cos(a) * r + 0.085 * bu * bu;
    const z = 0.212 + Math.sin(a) * r * 0.92;
    const depthMix = clamp(r / Math.max(shell, 0.001), 0, 1);
    out.push({
      open: [x, y, z],
      closed: [x, y, z],
      size: rand(1.0, 2.7),
      seed: Math.random(),
      delay: 0,
      tint: clamp(0.18 + bu * 0.62 + (Math.random() - 0.5) * 0.16 + depthMix * 0.08, 0.03, 1),
      alpha: rand(0.08, 0.22),
      glow: rand(0.25, 0.8),
      kind: 6,
    });
  }
}

function buildBudOutline(out) {
  // A thin gold contour makes the teardrop silhouette legible at a glance,
  // even when the volumetric core is soft and low-contrast.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 300; i++) {
      const bu = Math.pow(i / 299, 0.94);
      const radius = budSurfaceRadius(bu) * 1.005;
      const lean = 0.095 * bu * bu;
      const x = side * radius + lean;
      const y = -0.70 + 1.35 * bu;
      const z = 0.235;
      out.push({
        open: [x, y, z],
        closed: [x, y, z],
        size: rand(0.85, 1.9),
        seed: Math.random(),
        delay: 0,
        tint: rand(0.02, 0.15),
        alpha: rand(0.32, 0.62),
        glow: rand(0.7, 1.4),
        kind: 7,
      });
    }
  }
  for (let i = 0; i < 90; i++) {
    const bu = 0.975 + Math.random() * 0.08;
    const radius = budSurfaceRadius(Math.min(bu, 1.0)) * 1.01;
    const lean = 0.095 * Math.pow(Math.min(bu, 1.0), 2);
    const x = lean + rand(-radius * 0.35, radius * 0.35);
    const y = -0.70 + 1.35 * Math.min(bu, 1.03);
    out.push({
      open: [x, y, 0.235],
      closed: [x, y, 0.235],
      size: rand(1.0, 2.3),
      seed: Math.random(),
      delay: 0,
      tint: rand(0.01, 0.12),
      alpha: rand(0.40, 0.78),
      glow: rand(0.9, 1.7),
      kind: 7,
    });
  }
}


function buildBudSeams(out) {
  // Five soft ridges on the front of the bud read as folded petals. They
  // converge on the tip, breaking the smooth seed-like silhouette.
  for (let k = 0; k < 5; k++) {
    const xb = -0.17 + k * 0.085;
    const xt = 0.09 + (k - 2) * 0.006;
    for (let i = 0; i < 78; i++) {
      const t = i / 77;
      const bow = Math.sin(Math.PI * t) * (k - 2) * 0.006;
      const x = xb * (1 - t) + xt * t + bow + rand(-0.008, 0.008);
      const y = 0.28 + 0.47 * t + rand(-0.006, 0.006);
      const z = 0.245 - t * 0.01;
      out.push({
        open: [x, y, z],
        closed: [x, y, z],
        size: rand(0.8, 1.55),
        seed: Math.random(),
        delay: 0,
        tint: rand(0.025, 0.16),
        alpha: rand(0.16, 0.34),
        glow: rand(0.6, 1.2),
        kind: 7,
      });
    }
  }

  // A small star of sepals anchors the bud to the stem.
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k - 2) * 0.42;
    for (let i = 0; i < 95; i++) {
      const t = Math.pow(Math.random(), 0.85);
      const len = 0.27 * t;
      const x = Math.cos(a) * len * 0.9 + 0.02 + rand(-0.012, 0.012);
      const y = -0.66 - Math.sin(t * 1.25) * 0.26 + rand(-0.01, 0.01);
      const z = 0.205 + Math.sin(a) * len * 0.45 + rand(-0.015, 0.015);
      out.push({
        open: [x, y, z],
        closed: [x, y, z],
        size: rand(0.6, 1.5),
        seed: Math.random(),
        delay: 0,
        tint: rand(0.08, 0.26),
        alpha: rand(0.08, 0.22),
        glow: rand(0.2, 0.6),
        kind: 7,
      });
    }
  }
}

function buildBudFrontPetals(out) {
  // Five overlapping front panels. The volumetric bud supplies the body; these
  // panels supply the readable flower anatomy: a pointed tip, a bright fold and
  // a darker inner face. Without them the closed state reads as a seed.
  for (let k = 0; k < 5; k++) {
    const lean = (k - 2) * 0.058;
    const baseY = -0.62;
    const tipY = 0.58 - Math.abs(k - 2) * 0.035;
    const height = tipY - baseY;

    for (let i = 0; i < 300; i++) {
      const t = Math.pow(Math.random(), 0.92);
      const halfW = 0.16 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.9)), 0.62) * (1 - 0.22 * t);
      const across = rand(-1, 1) * halfW;
      const edge = Math.abs(across) / Math.max(halfW, 1e-4) > 0.8;
      const x = 0.02 + lean * t + across;
      const y = baseY + height * t + rand(-0.006, 0.006);
      const z = 0.272 + Math.cos(across * 7.0) * 0.012;
      out.push({
        open: [x, y, z],
        closed: [x, y, z],
        size: edge ? rand(1.05, 2.05) : rand(0.72, 1.6),
        seed: Math.random(),
        delay: 0,
        tint: edge ? rand(0.0, 0.14) : rand(0.18, 0.6),
        alpha: edge ? rand(0.42, 0.72) : rand(0.14, 0.34),
        glow: edge ? rand(0.9, 1.5) : rand(0.2, 0.55),
        kind: 7,
      });
    }

    // central fold
    for (let i = 0; i < 55; i++) {
      const t = Math.pow(Math.random(), 0.9);
      const x = 0.02 + lean * t + rand(-0.006, 0.006);
      const y = baseY + height * t;
      out.push({
        open: [x, y, 0.285],
        closed: [x, y, 0.285],
        size: rand(0.8, 1.5),
        seed: Math.random(),
        delay: 0,
        tint: rand(0.01, 0.1),
        alpha: rand(0.28, 0.52),
        glow: rand(0.7, 1.2),
        kind: 7,
      });
    }
  }
}

function buildCalyx(out) {
  // Five real sepals fanning out below the bud. They are the strongest
  // botanical cue in the closed state: without them the bud reads as a seed.
  for (let k = 0; k < 5; k++) {
    const angle = -1.15 + k * 0.575;
    for (let i = 0; i < 300; i++) {
      const t = Math.pow(Math.random(), 0.8);
      const len = 0.55 * t;
      const width = 0.13 * Math.pow(Math.sin(Math.PI * t), 0.55);
      const across = rand(-1, 1) * width;
      const x = 0.02 + Math.sin(angle) * len + Math.cos(angle) * across;
      const z = 0.225 + Math.cos(angle) * len * 0.58 - Math.sin(angle) * across * 0.55;
      const y = -0.66 - Math.sin(t * 1.3) * 0.44 + across * 0.18 + rand(-0.008, 0.008);
      out.push({
        open: [x, y, z],
        closed: [x, y, z],
        size: rand(0.85, 2.0),
        seed: Math.random(),
        delay: 0,
        tint: rand(0.1, 0.6),
        alpha: rand(0.19, 0.44),
        glow: rand(0.25, 0.65),
        kind: 11,
      });
    }
  }
}

function addLeaf(out, cx, cy, length, width, angle) {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  for (let i = 0; i < 260; i++) {
    const t = Math.random();
    const s = rand(-1, 1);
    const taper = Math.pow(Math.sin(Math.PI * t), 0.7);
    const lx = (t - 0.12) * length;
    const ly = s * width * taper;
    const x = cx + lx * ca - ly * sa;
    const y = cy + lx * sa + ly * ca;
    const z = 0.16 + rand(-0.035, 0.035);
    out.push({
      open: [x, y, z],
      closed: [x, y, z],
      size: rand(0.6, 1.7),
      seed: Math.random(),
      delay: 0,
      tint: rand(0.10, 0.30),
      alpha: rand(0.08, 0.20),
      glow: rand(0.25, 0.65),
      kind: 8,
    });
  }
}

function buildStem(out) {
  const count = 620;
  for (let i = 0; i < count; i++) {
    const t = Math.random();
    const x = 0.02 + Math.sin(t * 2.2) * 0.035 - 0.06 * t * t + rand(-0.014, 0.014);
    const y = -0.66 - 1.62 * t;
    const z = 0.17 + rand(-0.02, 0.02);
    out.push({
      open: [x, y, z],
      closed: [x, y, z],
      size: rand(0.55, 1.35),
      seed: Math.random(),
      delay: 0,
      tint: rand(0.06, 0.20),
      alpha: rand(0.28, 0.58),
      glow: rand(0.3, 0.7),
      kind: 8,
    });
  }
  addLeaf(out, 0.02, -1.28, 0.52, 0.10, -2.55);
  addLeaf(out, 0.01, -1.58, 0.60, 0.11, -0.52);
}

export function createFlowerGeometry() {
  const items = [];

  buildPetalVeil(
    {
      index: 0,
      length: 1.70,
      width: 0.82,
      z: -0.035,
      angleOffset: Math.PI / 8,
    },
    8,
    1400,
    items
  );
  buildPetalVeil(
    {
      index: 1,
      length: 1.20,
      width: 0.66,
      z: 0.105,
      angleOffset: 0,
    },
    7,
    900,
    items
  );

  // outer petals
  buildPetal(
    {
      index: 0,
      length: 1.70,
      width: 0.82,
      z: -0.035,
      angleOffset: Math.PI / 8,
    },
    8,
    2750,
    items
  );

  // inner petals
  buildPetal(
    {
      index: 1,
      length: 1.20,
      width: 0.66,
      z: 0.105,
      angleOffset: 0,
    },
    7,
    1850,
    items
  );

  buildCore(items);
  buildPollen(items);
  buildDust(items);
  buildBudShell(items);
  buildBudBody(items);
  buildBudOutline(items);
  buildBudSeams(items);
  buildBudFrontPetals(items);
  buildCalyx(items);
  buildStem(items);

  const count = items.length;
  const open = new Float32Array(count * 3);
  const closed = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  const delay = new Float32Array(count);
  const tint = new Float32Array(count);
  const alpha = new Float32Array(count);
  const glow = new Float32Array(count);
  const kind = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const it = items[i];
    open[i * 3] = it.open[0];
    open[i * 3 + 1] = it.open[1];
    open[i * 3 + 2] = it.open[2];
    closed[i * 3] = it.closed[0];
    closed[i * 3 + 1] = it.closed[1];
    closed[i * 3 + 2] = it.closed[2];
    size[i] = it.size;
    seed[i] = it.seed;
    delay[i] = it.delay;
    tint[i] = it.tint;
    alpha[i] = it.alpha;
    glow[i] = it.glow;
    kind[i] = it.kind;
  }

  return {
    count,
    open,
    closed,
    size,
    seed,
    delay,
    tint,
    alpha,
    glow,
    kind,
  };
}
