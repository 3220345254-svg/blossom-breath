/* 花息 — interaction choreography. */

import { createFlowerGeometry } from './particles.js';
import { FlowerRenderer } from './renderer.js';
import { HandTracker } from './hand.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const params = new URLSearchParams(window.location.search);
const startCamera = !params.has('demo') && !params.has('nocam');
const initialOpen = clamp(parseFloat(params.get('open') || '0.18'), 0, 1);

const dom = {
  canvas: $('#gl'),
  loader: $('#loader'),
  loaderStatus: $('#loaderStatus'),
  loaderBar: $('#loaderBar'),
  video: $('#camera'),
  preview: $('#handCanvas'),
  cameraShell: $('#cameraShell'),
  cameraLabel: $('#camLabel'),
  cameraToggle: $('#camToggle'),
  cameraEmpty: $('#cameraEmpty'),
  cameraEmptyTitle: $('#cameraEmptyTitle'),
  cameraEmptyText: $('#cameraEmptyText'),
  cameraAction: $('#cameraAction'),
  fps: $('#fpsLabel'),
  stateWord: $('#stateWord'),
  stateEn: $('#stateEn'),
  stateBar: $('#stateBar'),
  openPct: $('#openPct'),
  hint: $('#hint'),
  hintText: $('#hintText'),
  toast: $('#toast'),
  particleCount: $('#particleCount'),
  signalText: $('#signalText'),
  handPulse: $('#handPulse'),
  cameraMeta: $('#cameraMeta'),
};

const ui = {
  state: 'loading',
  cameraMessage: '',
  fps: 0,
  lastWord: '',
  lastEn: '',
  lastPct: -1,
  lastSignal: '',
  hintHidden: false,
};

const state = {
  time: 0,
  open: initialOpen,
  openVelocity: 0,
  targetOpen: initialOpen,
  handPresent: false,
  handActive: 0,
  handOpen: 0,
  pointer: { x: 0.5, y: 0.5 },
  pointerSmoothed: { x: 0.5, y: 0.5 },
  pointerVelocity: { x: 0, y: 0 },
  offsetX: 0,
  offsetY: 0,
  offsetTargetX: 0,
  offsetTargetY: 0,
  handLocal: { x: 3, y: 0 },
  handLocalVelocity: { x: 0, y: 0 },
  handScale: 0.16,
  mouseActive: false,
  mouseDown: false,
  cameraRunning: false,
  cameraStarting: false,
  gesture: 'idle',
  holdOpen: null,
  debugHand: null,
  visibleHeight: 5.38,
  visibleWidth: 9.56,
  particleCount: 0,
};

let renderer;
let tracker;
let lastFrame = performance.now();
let lastUi = 0;
let hasRendered = false;

function showToast(message, duration = 2600) {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.classList.add('is-visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => dom.toast.classList.remove('is-visible'), duration);
}

function setCameraUI(nextState, message = '') {
  if (!dom.cameraShell) return;
  const changed = ui.state !== nextState || ui.cameraMessage !== message;
  ui.state = nextState;
  ui.cameraMessage = message;
  dom.cameraShell.dataset.state = nextState;

  const labels = {
    loading: '镜头连接中',
    ready: '等待手部',
    tracking: '手部已捕捉',
    off: '镜头已关闭',
    error: '镜头未连接',
  };
  dom.cameraLabel.textContent = labels[nextState] || '镜头';
  dom.cameraToggle.textContent = nextState === 'loading' ? '请稍候' : nextState === 'off' || nextState === 'error' ? '开启' : '关闭';
  dom.cameraToggle.disabled = nextState === 'loading';

  const isOff = nextState === 'off' || nextState === 'error';
  dom.cameraEmpty.classList.toggle('is-visible', isOff);
  if (isOff) {
    dom.cameraEmptyTitle.textContent = message || '摄像头未开启';
    dom.cameraEmptyText.textContent =
      nextState === 'error'
        ? '请允许浏览器使用摄像头，或直接用鼠标互动。'
        : '点击开启，让花息看见你的手。';
    dom.cameraAction.textContent = nextState === 'error' ? '再次尝试' : '开启镜头';
  }

  if (dom.cameraMeta) dom.cameraMeta.classList.toggle('is-live', nextState === 'tracking');
  if (changed && nextState === 'ready') dom.fps.textContent = 'STANDBY';
}

function mapCameraError(error) {
  const name = error && error.name ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return '摄像头权限被拒绝';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '未找到摄像头';
  if (name === 'NotReadableError' || name === 'TrackStartError') return '摄像头被占用';
  if (error && error.message === 'CAMERA_UNSUPPORTED') return '浏览器不支持摄像头';
  if (error && error.message === 'CAMERA_TIMEOUT') return '摄像头启动超时';
  if (error && /model/i.test(error.message || '')) return '识别模型加载失败';
  return '镜头启动失败';
}

async function startTracking() {
  if (state.cameraStarting) return;
  if (!tracker) {
    ensureTracker();
  }
  state.cameraStarting = true;
  setCameraUI('loading', '正在唤醒镜头');
  try {
    await tracker.start();
    state.cameraRunning = true;
    state.cameraStarting = false;
    setCameraUI('ready', '等待手部');
    dom.hint.classList.remove('is-hidden');
  } catch (error) {
    console.error('[花息] camera start failed', error);
    state.cameraStarting = false;
    state.cameraRunning = false;
    const message = mapCameraError(error);
    setCameraUI('error', message);
    showToast(message === '摄像头权限被拒绝' ? '没有镜头也能玩：按住画面模拟握拳' : `${message} · 可用鼠标体验`);
    dom.hintText.innerHTML = '摄像头未连接<br><em>按住画面 · 模拟握拳，松开则绽放</em>';
    dom.hint.classList.remove('is-hidden');
  }
}

function stopTracking(message = true) {
  if (!tracker) return;
  tracker.stopCamera();
  state.cameraRunning = false;
  state.cameraStarting = false;
  setCameraUI('off', '镜头已关闭');
  dom.fps.textContent = 'OFFLINE';
  if (message) showToast('镜头已关闭 · 可用鼠标互动');
  dom.hintText.innerHTML = '镜头已关闭<br><em>按住画面 · 模拟握拳，松开则绽放</em>';
  dom.hint.classList.remove('is-hidden');
}

function onHandFrame(frame) {
  if (!state.cameraRunning) return;
  if (frame.present) {
    state.handPresent = true;
    state.handOpen = frame.open;
    state.pointer.x = frame.pointer.x;
    state.pointer.y = frame.pointer.y;
    state.handScale = frame.handScale;
    dom.hint.classList.add('is-hidden');
    dom.handPulse.classList.add('is-visible');
  } else {
    state.handPresent = false;
    dom.handPulse.classList.remove('is-visible');
  }
}

function ensureTracker() {
  if (tracker) return tracker;
  tracker = new HandTracker(dom.video, dom.preview, {
    onFrame: onHandFrame,
    onStatus: (status) => {
      if (!status) return;
      if (status.state === 'loading') setCameraUI('loading', status.message);
      else if (status.state === 'ready') {
        if (state.cameraRunning) setCameraUI('ready', status.message);
      } else if (status.state === 'tracking') {
        setCameraUI('tracking', status.message);
      } else if (status.state === 'off') {
        setCameraUI('off', status.message);
      } else if (status.state === 'error') {
        setCameraUI('error', status.message);
      }
    },
    onFps: (fps) => {
      ui.fps = fps;
      if (state.cameraRunning) dom.fps.textContent = `${fps} FPS`;
    },
  });
  return tracker;
}

function updateTargets(dt, now) {
  // The debug interface is intentionally tiny; it only exists so the visual
  // can be inspected without a physical camera.
  if (state.debugHand) {
    state.handPresent = state.debugHand.active;
    state.pointer.x = state.debugHand.x;
    state.pointer.y = state.debugHand.y;
    state.handOpen = state.debugHand.open ?? state.handOpen;
  }

  const handAlive = state.handPresent &&
    (state.cameraRunning || state.debugHand || state.mouseActive || state.mouseDown);
  state.handActive += ((handAlive ? 1 : 0) - state.handActive) * (1 - Math.exp(-dt * 5.0));

  // With no hand in frame the flower waits as a bud. It should not drift open
  // on its own: opening is the hand's job.
  const idle = 0.10 + (0.5 + 0.5 * Math.sin(state.time * 0.26)) * 0.03;
  if (state.holdOpen !== null) {
    state.targetOpen = state.holdOpen;
  } else if (handAlive) {
    state.targetOpen = clamp(state.handOpen, 0.035, 0.985);
  } else {
    state.targetOpen = idle;
  }

  if (handAlive) {
    state.gesture = state.handOpen < 0.3 ? 'fist' : state.handOpen > 0.6 ? 'open' : 'half';
  } else {
    state.gesture = 'idle';
  }

  // Springy opening; a little overshoot makes it feel botanical rather than robotic.
  const stiffness = 27;
  const damping = 7.2;
  state.openVelocity += (state.targetOpen - state.open) * stiffness * dt;
  state.openVelocity *= Math.exp(-damping * dt);
  state.open += state.openVelocity * dt;
  if (state.open < 0) {
    state.open = 0;
    state.openVelocity *= 0.35;
  }
  if (state.open > 1.045) {
    state.open = 1.045;
    state.openVelocity *= 0.35;
  }

  const aspect = dom.canvas.clientWidth / Math.max(1, dom.canvas.clientHeight);
  const cameraZ = renderer ? renderer.camera.z : 8.8;
  state.visibleHeight = 2 * cameraZ * Math.tan((34 * Math.PI) / 360);
  state.visibleWidth = state.visibleHeight * aspect;

  let targetX = 0;
  let targetY = 0;
  if (handAlive) {
    targetX = clamp((state.pointer.x - 0.5) * 1.22, -0.56, 0.56);
    targetY = clamp((0.5 - state.pointer.y) * 0.94, -0.34, 0.34);
  } else {
    targetX = Math.sin(state.time * 0.17) * 0.025;
    targetY = Math.sin(state.time * 0.23 + 1.1) * 0.018;
  }

  const follow = 1 - Math.exp(-dt * 3.3);
  state.offsetX = lerp(state.offsetX, targetX, follow);
  state.offsetY = lerp(state.offsetY, targetY, follow);

  // The fingertip's position is compressed into flower-local space so that the
  // nearby particles can lean toward it. The flower itself moves less, keeping
  // the composition stable.
  const handLocalTargetX = handAlive
    ? clamp((state.pointer.x - 0.5) * 3.8 - state.offsetX, -2.6, 2.6)
    : 3.2;
  const handLocalTargetY = handAlive
    ? clamp((0.5 - state.pointer.y) * 2.7 - state.offsetY, -2.2, 2.2)
    : 0.3;
  const handFollow = 1 - Math.exp(-dt * 8.0);
  const prevHandX = state.handLocal.x;
  const prevHandY = state.handLocal.y;
  state.handLocal.x = lerp(state.handLocal.x, handLocalTargetX, handFollow);
  state.handLocal.y = lerp(state.handLocal.y, handLocalTargetY, handFollow);
  const invDt = 1 / Math.max(dt, 0.001);
  const vx = clamp((state.handLocal.x - prevHandX) * invDt, -1.6, 1.6);
  const vy = clamp((state.handLocal.y - prevHandY) * invDt, -1.6, 1.6);
  state.handLocalVelocity.x = lerp(state.handLocalVelocity.x, vx, 1 - Math.exp(-dt * 9));
  state.handLocalVelocity.y = lerp(state.handLocalVelocity.y, vy, 1 - Math.exp(-dt * 9));
}

function render(now) {
  const t = now * 0.001;
  const rotZ = Math.sin(t * 0.18) * 0.008 + state.offsetX * 0.025;
  const rotY = state.offsetX * 0.20;
  const rotX = -state.offsetY * 0.18 + Math.sin(t * 0.14) * 0.008;
  const scale = 0.985 + state.open * 0.025;

  renderer.render({
    open: state.open,
    time: t,
    offsetX: state.offsetX,
    offsetY: state.offsetY,
    rotX,
    rotY,
    rotZ,
    scale,
    hand: state.handLocal,
    handVelocity: state.handLocalVelocity,
    handActive: state.handActive,
  });
}

function wordForOpen() {
  if (!state.handPresent && state.gesture === 'idle') return ['吐息', 'BREATHING'];
  if (state.gesture === 'fist') return ['含苞', 'BUD'];
  if (state.open < 0.27) return ['含苞', 'CLOSED BUD'];
  if (state.open < 0.52) return ['半敛', 'FOLDING'];
  if (state.open < 0.76) return ['初绽', 'UNFURLING'];
  return ['盛放', 'IN BLOOM'];
}

function updateUI(now) {
  if (now - lastUi < 80) return;
  lastUi = now;
  const [word, en] = wordForOpen();
  if (word !== ui.lastWord) {
    dom.stateWord.textContent = word;
    ui.lastWord = word;
    dom.stateWord.classList.remove('is-changing');
    void dom.stateWord.offsetWidth;
    dom.stateWord.classList.add('is-changing');
  }
  if (en !== ui.lastEn) {
    dom.stateEn.textContent = en;
    ui.lastEn = en;
  }
  const pct = Math.round(clamp(state.open, 0, 1) * 100);
  if (pct !== ui.lastPct) {
    dom.openPct.textContent = `${String(pct).padStart(2, '0')}%`;
    dom.stateBar.style.transform = `scaleX(${clamp(state.open, 0, 1)})`;
    document.documentElement.style.setProperty('--bloom', String(clamp(state.open, 0, 1)));
    ui.lastPct = pct;
  }

  let signal = 'MOVE YOUR HAND SLOWLY';
  if (ui.state === 'error' || ui.state === 'off') {
    signal = 'MOUSE FALLBACK · HOLD TO CLOSE';
  } else if (ui.state === 'loading') {
    signal = 'CALIBRATING HAND LANDMARKER';
  }
  if (signal !== ui.lastSignal) {
    dom.signalText.textContent = signal;
    ui.lastSignal = signal;
  }
}

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  state.time += dt;

  updateTargets(dt, now);
  render(now);
  updateUI(now);
  ui.fps = ui.fps;

  if (!hasRendered) {
    hasRendered = true;
    window.__READY = true;
    dom.loaderBar.style.width = '100%';
    setTimeout(() => {
      dom.loader.classList.add('is-hidden');
      dom.loader.setAttribute('aria-hidden', 'true');
    }, 320);
  }
}

function setupPointerFallback() {
  window.addEventListener('pointermove', (event) => {
    if (state.cameraRunning) return;
    state.mouseActive = true;
    state.pointer.x = event.clientX / window.innerWidth;
    state.pointer.y = event.clientY / window.innerHeight;
    if (!state.cameraRunning && !state.debugHand) {
      // In mouse mode the pointer is an explicit interaction.
      state.handPresent = true;
      state.handOpen = state.mouseDown ? 0.05 : 0.88;
    }
  });

  const press = () => {
    if (state.cameraRunning) return;
    state.mouseDown = true;
    state.mouseActive = true;
    state.handPresent = true;
    state.handOpen = 0.04;
    state.gesture = 'fist';
    if (!state.cameraRunning) showToast('握拳 · 花苞收拢', 1600);
  };
  const release = () => {
    if (state.cameraRunning) return;
    if (!state.mouseDown) return;
    state.mouseDown = false;
    if (!state.cameraRunning) {
      state.handPresent = true;
      state.handOpen = 0.92;
      showToast('张掌 · 粒子绽放', 1600);
    }
  };

  window.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, a')) return;
    press();
  });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      state.mouseDown = true;
      state.mouseActive = true;
      if (!state.cameraRunning && !state.debugHand) {
        state.handPresent = true;
        state.handOpen = 0.04;
      }
    }
    if (event.key.toLowerCase() === 'c') {
      event.preventDefault();
      if (state.cameraRunning) stopTracking();
      else startTracking();
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      state.mouseDown = false;
      if (!state.cameraRunning && !state.debugHand) {
        state.handPresent = true;
        state.handOpen = 0.92;
      }
    }
  });
}

function setupCameraUI() {
  dom.cameraToggle.addEventListener('click', () => {
    if (state.cameraRunning) stopTracking();
    else startTracking();
  });
  dom.cameraAction.addEventListener('click', () => {
    startTracking();
  });
  dom.cameraShell.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    if (ui.state === 'off' || ui.state === 'error') startTracking();
  });
}

function setupDebug() {
  window.__flowerDebug = {
    setBloom(value, immediate = false) {
      state.holdOpen = clamp(Number(value), 0, 1);
      if (immediate) {
        state.open = state.holdOpen;
        state.openVelocity = 0;
      }
      return state.open;
    },
    releaseBloom() {
      state.holdOpen = null;
    },
    setHand(x, y, active = true, open = 0.9) {
      state.debugHand = { x: clamp(x, 0, 1), y: clamp(y, 0, 1), active, open };
      state.handPresent = active;
      state.pointer.x = clamp(x, 0, 1);
      state.pointer.y = clamp(y, 0, 1);
      state.handOpen = open;
    },
    clearHand() {
      state.debugHand = null;
      state.handPresent = false;
    },
    hideCamera(hidden = true) {
      dom.cameraShell.style.display = hidden ? 'none' : '';
      dom.cameraMeta.style.display = hidden ? 'none' : '';
    },
    snapshot() {
      return {
        open: state.open,
        targetOpen: state.targetOpen,
        handPresent: state.handPresent,
        gesture: state.gesture,
        offsetX: state.offsetX,
        offsetY: state.offsetY,
        particleCount: state.particleCount,
        cameraRunning: state.cameraRunning,
        cameraState: ui.state,
        handOpen: state.handOpen,
      };
    },
  };
}

async function boot() {
  try {
    dom.loaderStatus.textContent = '正在编织花瓣';
    const geometry = createFlowerGeometry();
    state.particleCount = geometry.count;
    dom.particleCount.textContent = geometry.count.toLocaleString('en-US');

    renderer = new FlowerRenderer(dom.canvas, geometry);
    resetSize();
    setupDebug();
    setupPointerFallback();
    setupCameraUI();
    setCameraUI('off', '镜头未开启');
    requestAnimationFrame(animate);

    if (startCamera) {
      setTimeout(() => startTracking(), 650);
    } else {
      dom.hintText.innerHTML = '演示模式<br><em>移动鼠标 · 按住画面模拟握拳</em>';
    }
  } catch (error) {
    console.error('[花息] boot failed', error);
    dom.loaderStatus.textContent = '当前浏览器无法启动 WebGL2';
    dom.loader.classList.add('is-error');
    window.__READY = true;
  }
}

function resetSize() {
  if (!renderer) return;
  renderer.resize();
}

window.addEventListener('resize', resetSize);
window.addEventListener('pagehide', () => {
  if (tracker) tracker.destroy();
});
window.addEventListener('visibilitychange', () => {
  lastFrame = performance.now();
});

boot();
