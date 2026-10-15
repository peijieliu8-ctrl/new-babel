import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/particles.js', import.meta.url), 'utf8');
const noop = () => {};

function createHarness({ width = 1280, height = 720, dpr = 1, hasContext = true } = {}) {
  const frames = new Map();
  const listeners = new Map();
  const stats = { clears: 0, layoutReads: 0, draws: 0 };
  let nextFrame = 0;
  const context = {
    setTransform: noop, fillRect: noop, beginPath: noop,
    moveTo: noop, lineTo: noop, stroke: noop, ellipse: noop,
    clearRect() { stats.clears += 1; },
    drawImage() { stats.draws += 1; },
    createRadialGradient() { return { addColorStop: noop }; },
  };
  const getContext = () => hasContext ? context : null;
  const canvas = {
    get clientWidth() { stats.layoutReads += 1; return width; },
    get clientHeight() { stats.layoutReads += 1; return height; },
    getContext,
  };
  const events = {
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); },
  };
  const document = { ...events, hidden: false, createElement: () => ({ getContext }) };
  const window = { ...events, devicePixelRatio: dpr };
  vm.runInNewContext(source, {
    document, window,
    requestAnimationFrame(handler) { const id = ++nextFrame; frames.set(id, handler); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  const particles = new window.NewBabelParticles(canvas);
  const step = (timestamp) => {
    const [id, handler] = frames.entries().next().value;
    frames.delete(id);
    handler(timestamp);
  };
  const setHidden = (hidden) => { document.hidden = hidden; listeners.get('visibilitychange')(); };
  const setSize = (nextWidth, nextHeight) => { width = nextWidth; height = nextHeight; };
  return { particles, canvas, frames, stats, listeners, step, setHidden, setSize };
}

test('repeated activation keeps one RAF and rendering avoids layout reads', () => {
  const harness = createHarness();
  const { particles, frames, stats, step } = harness;
  assert.equal(frames.size, 0);
  particles.setActive(true);
  particles.setActive(true);
  assert.equal(frames.size, 1);
  const layoutReads = stats.layoutReads;
  for (const timestamp of [100, 116, 150, 184, 218]) {
    step(timestamp);
    assert.equal(frames.size, 1);
  }
  assert.equal(stats.layoutReads, layoutReads);
  assert.ok(stats.draws > 0);
  particles.destroy();
});

test('hidden and inactive states cancel RAF and clear the canvas', () => {
  const { particles, frames, stats, setHidden } = createHarness();
  particles.setActive(true);
  const firstClears = stats.clears;
  setHidden(true);
  assert.equal(frames.size, 0);
  assert.ok(stats.clears > firstClears);
  setHidden(false);
  assert.equal(frames.size, 1);
  const nextClears = stats.clears;
  particles.setActive(false);
  assert.equal(frames.size, 0);
  assert.ok(stats.clears > nextClears);
  particles.destroy();
});

test('enabling after display:none remeasures the visible canvas', () => {
  const { particles, canvas, setSize } = createHarness({ width: 0, height: 0 });
  assert.equal(canvas.width, 1);
  setSize(1280, 720);
  particles.setActive(true);
  assert.equal(canvas.width, 1280);
  assert.equal(canvas.height, 720);
  assert.equal(particles.mobile, false);
  particles.destroy();
});

test('resuming after a long hidden interval does not jump animation time', () => {
  const { particles, step, setHidden } = createHarness();
  particles.setActive(true);
  step(100);
  step(150);
  const beforePause = particles.time;
  setHidden(true);
  setHidden(false);
  step(100000);
  assert.equal(particles.time, beforePause);
  step(100040);
  assert.ok(particles.time - beforePause <= 0.08);
  particles.destroy();
});

for (const [width, height, limit] of [[1280, 720, 160], [375, 667, 70]]) {
  test(`${width}px viewport caps DPR and replaces bursts within particle budget`, () => {
    const { particles, canvas } = createHarness({ width, height, dpr: 3 });
    assert.equal(canvas.width, Math.round(width * 1.6));
    assert.equal(canvas.height, Math.round(height * 1.6));
    particles.setActive(true);
    particles.burst('fragment');
    const oldBurst = particles.burstState;
    particles.burst('fragment');
    assert.notEqual(particles.burstState, oldBurst);
    assert.ok(particles.count + particles.burstState.seeds.length + 1 <= limit);
    particles.destroy();
  });
}

test('missing Canvas 2D stays inactive without throwing; destroy removes listeners', () => {
  const { particles, frames, listeners } = createHarness({ hasContext: false });
  assert.doesNotThrow(() => {
    particles.setScene('vision', 1);
    particles.setActive(true);
    particles.burst('fragment');
    particles.setActive(false);
    particles.destroy();
  });
  assert.equal(frames.size, 0);
  assert.equal(listeners.size, 0);
});
