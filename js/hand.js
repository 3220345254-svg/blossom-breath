/* 花息 — webcam hand tracking with MediaPipe HandLandmarker.
 * The model and WASM are vendored locally so the piece works offline.
 */

import { FilesetResolver, HandLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function smoothstep(a, b, v) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function timeoutError(code) {
  const error = new Error(code);
  error.name = 'TimeoutError';
  return error;
}

function withTimeout(promise, ms, code) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(code)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function handOpenness(worldLandmarks, landmarks) {
  const points = worldLandmarks && worldLandmarks.length ? worldLandmarks : landmarks;
  if (!points || points.length < 21) return 0;
  const chains = [
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
  ];
  let ratio = 0;
  for (const [a, b, c, d] of chains) {
    const chain = distance(points[a], points[b]) + distance(points[b], points[c]) + distance(points[c], points[d]);
    const span = distance(points[a], points[d]);
    ratio += chain > 1e-5 ? span / chain : 0;
  }
  ratio /= chains.length;

  const palm = Math.max(distance(points[0], points[9]), 1e-5);
  const spread =
    (distance(points[4], points[8]) +
      distance(points[8], points[12]) +
      distance(points[12], points[16]) +
      distance(points[16], points[20])) /
    (4 * palm);

  // Finger straightness is scale-invariant and reliable. Tip spread adds a
  // little confidence when the palm is fully open.
  const straight = smoothstep(0.50, 0.83, ratio);
  const splay = smoothstep(0.38, 0.72, spread);
  return {
    value: clamp(straight * 0.86 + splay * 0.14, 0, 1),
    ratio,
    spread,
  };
}

export class HandTracker {
  constructor(video, previewCanvas, callbacks = {}) {
    this.video = video;
    this.canvas = previewCanvas;
    this.ctx = previewCanvas.getContext('2d');
    this.callbacks = callbacks;

    this.stream = null;
    this.landmarker = null;
    this.modelPromise = null;
    this.startSeq = 0;
    this.running = false;
    this.active = false;
    this.lastVideoTime = -1;
    this.lastDetectAt = 0;
    this.frameTimes = [];
    this.lastResult = null;
    this.lastHandAt = 0;
    this.missingSince = 0;

    this.openSmooth = 0;
    this.pointer = { x: 0.5, y: 0.5 };
    this.pointerSmooth = { x: 0.5, y: 0.5 };
    this.handScale = 0.16;

    this.raf = null;
    this.loop = this.loop.bind(this);
    this.onFrame = callbacks.onFrame || (() => {});
    this.onStatus = callbacks.onStatus || (() => {});
    this.onFps = callbacks.onFps || (() => {});
  }

  async loadModel() {
    if (this.landmarker) return this.landmarker;
    if (!this.modelPromise) {
      this.modelPromise = this.createLandmarker().catch((error) => {
        this.modelPromise = null;
        this.onStatus({ state: 'error', message: '手部模型加载失败' });
        throw error;
      });
    }
    // The model is allowed to keep loading after a timeout: the next retry can
    // reuse it. The timeout only releases the UI from a spinner that may never
    // finish on restricted in-app browsers.
    return withTimeout(this.modelPromise, 24000, 'MODEL_TIMEOUT');
  }

  async createLandmarker() {
    this.onStatus({ state: 'loading', message: '正在加载手部模型' });
    const assetBase = new URL('vendor/mediapipe/', document.baseURI);
    const fileset = await withTimeout(
      FilesetResolver.forVisionTasks(new URL('wasm', assetBase).href),
      10000,
      'MODEL_LOAD_TIMEOUT'
    );
    const options = {
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.38,
      minHandPresenceConfidence: 0.42,
      minTrackingConfidence: 0.38,
      baseOptions: {
        modelAssetPath: new URL('hand_landmarker.task', assetBase).href,
        delegate: 'GPU',
      },
    };
    try {
      this.landmarker = await withTimeout(
        HandLandmarker.createFromOptions(fileset, options),
        10000,
        'MODEL_LOAD_TIMEOUT'
      );
    } catch (error) {
      console.warn('[花息] GPU delegate unavailable, retrying with CPU.', error);
      options.baseOptions.delegate = 'CPU';
      this.landmarker = await withTimeout(
        HandLandmarker.createFromOptions(fileset, options),
        12000,
        'MODEL_LOAD_TIMEOUT'
      );
    }
    return this.landmarker;
  }

  releaseStream() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }

  async openCamera(seq) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('CAMERA_UNSUPPORTED');
    }
    this.onStatus({ state: 'loading', message: '正在请求摄像头权限' });

    let stream;
    try {
      stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: 960 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
        }),
        9000,
        'CAMERA_TIMEOUT'
      );
    } catch (error) {
      if (error && error.name === 'TimeoutError') {
        // The permission prompt can stay invisible inside in-app browsers.
        throw new Error('CAMERA_TIMEOUT');
      }
      throw error;
    }

    if (seq !== this.startSeq || !this.running) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error('START_CANCELLED');
    }

    this.stream = stream;
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('webkit-playsinline', '');

    try {
      await withTimeout(this.video.play(), 5000, 'CAMERA_TIMEOUT');
      if (this.video.readyState < 2) {
        await withTimeout(
          new Promise((resolve) => {
            if (this.video.readyState >= 2) {
              resolve();
              return;
            }
            this.video.addEventListener('loadeddata', resolve, { once: true });
          }),
          5000,
          'CAMERA_TIMEOUT'
        );
      }
    } catch (error) {
      this.releaseStream();
      throw error;
    }

    if (seq !== this.startSeq || !this.running) {
      this.releaseStream();
      throw new Error('START_CANCELLED');
    }
    this.active = true;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    const seq = ++this.startSeq;
    try {
      const [model] = await withTimeout(
        Promise.all([this.loadModel(), this.openCamera(seq)]),
        26000,
        'START_TIMEOUT'
      );
      if (!model) throw new Error('MODEL_UNAVAILABLE');
      if (seq !== this.startSeq || !this.running) {
        this.releaseStream();
        return;
      }
      this.onStatus({ state: 'ready', message: '等待手部入镜' });
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.loop);
    } catch (error) {
      if (seq !== this.startSeq) return;
      this.running = false;
      this.active = false;
      this.releaseStream();
      throw error;
    }
  }

  stopCamera() {
    this.startSeq += 1;
    this.active = false;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = null;
    this.releaseStream();
    this.lastResult = null;
    this.lastHandAt = 0;
    this.missingSince = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.onStatus({ state: 'off', message: '镜头已关闭' });
    this.onFrame({ present: false, open: 0, pointer: this.pointerSmooth, handScale: this.handScale, landmarks: null, fresh: false });
  }

  async restart() {
    this.stopCamera();
    this.running = false;
    await this.start();
  }

  loop(now) {
    if (!this.running) return;
    if (this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      if (now - this.lastDetectAt > 22) {
        this.lastDetectAt = now;
        try {
          this.detect(now);
        } catch (error) {
          console.warn('[花息] hand detection error', error);
        }
      }
    }

    this.drawPreview(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  detect(now) {
    const result = this.landmarker.detectForVideo(this.video, now);
    this.lastResult = result;
    const hasHand = result && result.landmarks && result.landmarks.length > 0;

    if (hasHand) {
      this.lastHandAt = now;
      const landmarks = result.landmarks[0];
      const world = result.worldLandmarks && result.worldLandmarks[0];
      const score = result.handednesses && result.handednesses[0] && result.handednesses[0][0]
        ? result.handednesses[0][0].score
        : 0;

      // Mirror the camera so moving right moves the flower right.
      const indexTip = landmarks[8];
      this.pointer.x = 1 - indexTip.x;
      this.pointer.y = indexTip.y;

      const palm = landmarks[9];
      const wrist = landmarks[0];
      this.handScale = Math.hypot(palm.x - wrist.x, palm.y - wrist.y) || 0.16;

      const open = handOpenness(world, landmarks);
      this.openSmooth += (open.value - this.openSmooth) * 0.28;

      const smoothing = 0.34;
      this.pointerSmooth.x += (this.pointer.x - this.pointerSmooth.x) * smoothing;
      this.pointerSmooth.y += (this.pointer.y - this.pointerSmooth.y) * smoothing;

      this.onStatus({
        state: 'tracking',
        message: '手部已捕捉',
        handedness: result.handednesses && result.handednesses[0] && result.handednesses[0][0]
          ? result.handednesses[0][0].categoryName
          : '',
        score,
      });

      this.onFrame({
        present: true,
        open: this.openSmooth,
        rawOpen: open.value,
        pointer: this.pointerSmooth,
        handScale: this.handScale,
        landmarks,
        worldLandmarks: world,
        fresh: true,
      });
    } else {
      if (!this.missingSince) this.missingSince = now;
      if (now - this.lastHandAt > 520) {
        this.openSmooth *= 0.94;
        this.onFrame({
          present: false,
          open: this.openSmooth,
          pointer: this.pointerSmooth,
          handScale: this.handScale,
          landmarks: null,
          fresh: false,
        });
        if (this.lastHandAt && now - this.lastHandAt > 700) {
          this.onStatus({ state: 'ready', message: '等待手部入镜' });
        }
      }
    }

    this.frameTimes.push(now);
    while (this.frameTimes.length > 1 && now - this.frameTimes[0] > 1000) this.frameTimes.shift();
    if (this.frameTimes.length > 2) this.onFps(this.frameTimes.length);
  }

  drawPreview(now) {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const result = this.lastResult;
    const hasHand = result && result.landmarks && result.landmarks.length > 0;
    if (!hasHand || !this.active) return;

    const videoW = this.video.videoWidth || 960;
    const videoH = this.video.videoHeight || 720;
    if (!videoW || !videoH) return;
    const scale = Math.max(rect.width / videoW, rect.height / videoH);
    const drawW = videoW * scale;
    const drawH = videoH * scale;
    const offsetX = (rect.width - drawW) / 2;
    const offsetY = (rect.height - drawH) / 2;

    const landmarkToPoint = (lm) => ({
      x: offsetX + (1 - lm.x) * drawW,
      y: offsetY + lm.y * drawH,
    });

    const points = result.landmarks[0].map(landmarkToPoint);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // soft golden skeleton
    ctx.shadowColor = 'rgba(255, 190, 120, 0.75)';
    ctx.shadowBlur = 7;
    ctx.strokeStyle = 'rgba(255, 226, 190, 0.62)';
    ctx.lineWidth = 1.05;
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(points[a].x, points[a].y);
      ctx.lineTo(points[b].x, points[b].y);
      ctx.stroke();
    }

    for (let i = 0; i < points.length; i++) {
      const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      ctx.beginPath();
      ctx.arc(points[i].x, points[i].y, tip ? 2.2 : 1.25, 0, Math.PI * 2);
      ctx.fillStyle = tip ? 'rgba(255, 247, 225, 0.98)' : 'rgba(255, 217, 174, 0.9)';
      ctx.fill();
    }

    // fingertip halo
    const tip = points[8];
    const pulse = 0.55 + 0.45 * Math.sin(now * 0.006);
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 7 + pulse * 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 151, 104, ${0.16 + pulse * 0.18})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  destroy() {
    this.stopCamera();
    if (this.landmarker && this.landmarker.close) this.landmarker.close();
    this.landmarker = null;
  }
}

export { handOpenness };
