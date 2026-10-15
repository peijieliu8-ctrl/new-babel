// One transparent, dependency-free canvas follows the active slide.
(() => {
  const TAU = Math.PI * 2;
  const FRAME_INTERVAL = 1000 / 30;
  const COLORS = ['237,211,157', '154,226,201', '255,245,216'];
  const SCENES = new Set([
    'cover', 'story', 'loss', 'problem', 'reveal', 'flow',
    'knowledge', 'quest', 'demo', 'now', 'vision',
  ]);
  const fract = (value) => value - Math.floor(value);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const ease = (value) => value * value * (3 - 2 * value);

  function createSeeds(count) {
    let state = 137041;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    return Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
      x: random(), y: random(), phase: random() * TAU,
      speed: 0.35 + random() * 0.65,
      radius: 0.35 + random() * 0.65,
      size: 1.2 + random() * 2.4,
      color: index % 7 === 0 ? 1 : index % 5 === 0 ? 2 : 0,
      group: index % 3,
    })));
  }

  function createSprite(color) {
    const sprite = document.createElement('canvas');
    sprite.width = 64;
    sprite.height = 64;
    const context = sprite.getContext('2d');
    if (!context) return null;
    const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, 'rgba(255,255,245,1)');
    glow.addColorStop(0.12, `rgba(${color},.95)`);
    glow.addColorStop(0.22, `rgba(${color},.38)`);
    glow.addColorStop(0.58, `rgba(${color},.08)`);
    glow.addColorStop(1, `rgba(${color},0)`);
    context.fillStyle = glow;
    context.fillRect(0, 0, 64, 64);
    return sprite;
  }

  window.NewBabelParticles = class {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas.getContext('2d', { alpha: true });
      this.sprites = COLORS.map(createSprite);
      this.scene = 'cover';
      this.beat = 0;
      this.time = 0;
      this.sceneStart = 0;
      this.lastFrame = 0;
      this.frame = null;
      this.active = false;
      this.burstState = null;
      this.width = 0;
      this.height = 0;
      this.seeds = createSeeds(112);
      this.drawFrame = this.drawFrame.bind(this);
      this.handleResize = () => this.resize();
      this.handleVisibility = () => this.syncLoop();
      window.addEventListener('resize', this.handleResize, { passive: true });
      document.addEventListener('visibilitychange', this.handleVisibility);
      this.resize();
    }

    resize() {
      this.width = Math.max(1, this.canvas.clientWidth);
      this.height = Math.max(1, this.canvas.clientHeight);
      this.mobile = this.width <= 768;
      const ratio = clamp(window.devicePixelRatio || 1, 1, 1.6);
      this.canvas.width = Math.round(this.width * ratio);
      this.canvas.height = Math.round(this.height * ratio);
      this.context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      // Including a burst: 112 + 36 desktop, 46 + 22 small screens.
      this.count = this.mobile ? 46 : 112;
      this.burstCount = this.mobile ? 22 : 36;
    }

    setScene(scene, beat = 0) {
      const nextScene = SCENES.has(scene) ? scene : 'now';
      const nextBeat = Number.isFinite(beat) ? Math.max(0, beat) : 0;
      if (this.scene !== nextScene || this.beat !== nextBeat) {
        this.scene = nextScene;
        this.beat = nextBeat;
        this.sceneStart = this.time;
        this.burstState = null;
      }
      this.resize();
    }

    burst(kind = 'slide') {
      // Repeated navigation replaces the previous burst instead of stacking it.
      if (!this.active || document.hidden || !this.context) return;
      this.burstState = Object.freeze({
        start: this.time,
        strong: kind !== 'slide',
        seeds: createSeeds(this.burstCount),
      });
      this.syncLoop();
    }

    setActive(active) {
      // The canvas may have been display:none while motion was disabled.
      if (active && !this.active) this.resize();
      this.active = Boolean(active);
      this.syncLoop();
    }

    syncLoop() {
      const shouldRun = this.active && !document.hidden && this.context;
      if (!shouldRun) {
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
        this.lastFrame = 0;
        this.burstState = null;
        this.context?.clearRect(0, 0, this.width, this.height);
        return;
      }
      if (this.frame === null) {
        this.lastFrame = 0;
        this.frame = requestAnimationFrame(this.drawFrame);
      }
    }

    drawFrame(timestamp) {
      this.frame = null;
      if (!this.active || document.hidden || !this.context) return;
      if (!this.lastFrame) this.lastFrame = timestamp;
      const delta = timestamp - this.lastFrame;
      if (delta >= FRAME_INTERVAL) {
        this.time += Math.min(delta / 1000, 0.08);
        this.lastFrame = timestamp;
        this.render();
      }
      this.frame = requestAnimationFrame(this.drawFrame);
    }

    render() {
      const context = this.context;
      context.clearRect(0, 0, this.width, this.height);
      context.globalCompositeOperation = 'lighter';
      if (this.scene === 'cover' || this.scene === 'vision') this.drawTower();
      else if (this.scene === 'story') this.drawDissolve();
      else if (this.scene === 'reveal') this.drawConvergence();
      else if (this.scene === 'flow') this.drawFlow();
      else if (this.scene === 'knowledge') this.drawBranches();
      else if (this.scene === 'quest') this.drawQuest();
      else this.drawStars();
      this.drawBurst();
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
    }

    dot(x, y, size, alpha, color = 0) {
      const sprite = this.sprites[color];
      if (!sprite || alpha <= 0) return;
      const diameter = size * 7;
      this.context.globalAlpha = clamp(alpha, 0, 1);
      this.context.drawImage(sprite, x - diameter / 2, y - diameter / 2, diameter, diameter);
    }

    line(x1, y1, x2, y2, alpha, color = 0, width = 0.7) {
      this.context.globalAlpha = clamp(alpha, 0, 1);
      this.context.strokeStyle = `rgb(${COLORS[color]})`;
      this.context.lineWidth = width;
      this.context.beginPath();
      this.context.moveTo(x1, y1);
      this.context.lineTo(x2, y2);
      this.context.stroke();
    }

    ring(x, y, radius, alpha, color = 0) {
      this.context.globalAlpha = clamp(alpha, 0, 1);
      this.context.strokeStyle = `rgb(${COLORS[color]})`;
      this.context.lineWidth = 0.8;
      this.context.beginPath();
      this.context.ellipse(x, y, radius, radius * 0.6, 0, 0, TAU);
      this.context.stroke();
    }

    drawTower() {
      const vision = this.scene === 'vision';
      const energy = vision ? (this.beat > 0 ? 1.35 : 0.4) : 1.1;
      const center = this.width * (this.mobile ? 0.76 : 0.77);
      this.drawTowerRibbon(center, vision);
      for (let index = 0; index < this.count; index += 1) {
        const seed = this.seeds[index];
        const progress = fract(seed.y + this.time * 0.035 * seed.speed);
        const angle = seed.phase + progress * (vision ? 20 : 12) - this.time * 0.32;
        const radius = this.width * (0.025 + (1 - progress) * 0.12) * seed.radius;
        const x = center + Math.cos(angle) * radius;
        const y = this.height * (0.91 - progress * 0.8) + Math.sin(angle) * radius * 0.15;
        const depth = 0.5 + Math.sin(angle) * 0.25;
        const alpha = Math.sin(progress * Math.PI) * energy * depth;
        this.dot(x, y, seed.size * (vision ? 1.35 : 1.1), alpha, seed.color);
        if (index % 6 === 0) this.line(x, y, x - 3, y + 15 * seed.speed, alpha * 0.35, seed.color);
      }
      if (vision && this.beat > 0) {
        const progress = fract(this.time * 0.17);
        this.ring(center, this.height * 0.82, this.width * (0.06 + progress * 0.15), (1 - progress) * 0.2);
      }
    }

    drawTowerRibbon(center, vision) {
      const context = this.context;
      context.lineWidth = this.mobile ? 0.7 : 1.1;
      for (let strand = 0; strand < 2; strand += 1) {
        context.globalAlpha = vision ? (this.beat > 0 ? 0.24 : 0.06) : 0.12;
        context.strokeStyle = `rgb(${COLORS[strand]})`;
        context.beginPath();
        for (let step = 0; step <= 64; step += 1) {
          const progress = step / 64;
          const angle = progress * (vision ? 20 : 12) - this.time * 0.32 + strand * Math.PI;
          const radius = this.width * (0.02 + (1 - progress) * 0.09);
          const x = center + Math.cos(angle) * radius;
          const y = this.height * (0.91 - progress * 0.8) + Math.sin(angle) * radius * 0.15;
          if (step === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }
    }

    drawDissolve() {
      const age = this.time - this.sceneStart;
      const dissolve = this.beat > 0 ? Math.min(age / 3, 1) : 0;
      for (let index = 0; index < this.count; index += 1) {
        const seed = this.seeds[index];
        const drift = Math.sin(this.time * 0.18 + seed.phase);
        const x = this.width * (0.56 + seed.x * 0.4 + drift * 0.013 + dissolve * Math.cos(seed.phase) * 0.11);
        const y = this.height * (0.1 + seed.y * 0.76 + dissolve * Math.sin(seed.phase) * 0.12);
        this.dot(x, y, seed.size, (0.45 - dissolve * 0.34) * seed.radius, seed.color);
      }
    }

    drawConvergence() {
      const centerX = this.width * 0.5;
      const centerY = this.height * (this.mobile ? 0.65 : 0.69);
      for (let index = 0; index < this.count; index += 1) {
        const seed = this.seeds[index];
        const progress = fract(seed.x + this.time * (this.beat > 0 ? 0.12 : 0.035) * seed.speed);
        const inward = ease(progress);
        const radius = this.width * (this.mobile ? 0.48 : 0.37) * (1 - inward);
        const angle = seed.phase + this.time * 0.1 + inward * 1.2;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius * 0.42;
        this.dot(x, y, seed.size, Math.sin(progress * Math.PI) * 0.72, seed.color);
        if (index % 7 === 0) {
          this.line(x, y, x + (centerX - x) * 0.06, y + (centerY - y) * 0.06, 0.16, seed.color);
        }
      }
      if (this.beat > 0) this.ring(centerX, centerY, 18 + Math.sin(this.time) * 3, 0.25, 1);
    }

    drawFlow() {
      const speed = this.beat > 0 ? 0.12 : 0.045;
      const yBase = this.height * 0.55;
      for (let index = 0; index < this.count; index += 1) {
        const seed = this.seeds[index];
        const progress = fract(seed.x + this.time * speed * seed.speed);
        const x = this.width * (0.08 + progress * 0.84);
        const y = yBase + (seed.group - 1) * this.height * 0.07 + Math.sin(seed.phase + progress * TAU) * 7;
        const alpha = Math.sin(progress * Math.PI) * (this.beat > 0 ? 0.7 : 0.32);
        this.dot(x, y, seed.size * 0.85, alpha, seed.color);
        if (index % 4 === 0) this.line(x - 20 * seed.speed, y, x, y, alpha * 0.45, seed.color);
      }
    }

    drawBranches() {
      const trunkX = this.width * 0.5;
      const trunkY = this.height * 0.76;
      for (let index = 0; index < this.count; index += 1) {
        const seed = this.seeds[index];
        const startX = this.width * (0.2 + seed.group * 0.3);
        const startY = this.height * 0.51;
        const progress = fract(seed.y + this.time * 0.085 * seed.speed);
        const bend = ease(progress);
        const x = startX + (trunkX - startX) * bend + Math.sin(seed.phase) * 7;
        const y = startY + (trunkY - startY) * progress;
        this.dot(x, y, seed.size * 0.9, Math.sin(progress * Math.PI) * 0.65, seed.color);
      }
      this.ring(trunkX, trunkY, 26 + Math.sin(this.time * 1.2) * 5, 0.16, 1);
    }

    drawQuest() {
      this.drawStars(0.32);
      const x = this.width * 0.39;
      const y = this.height * (this.mobile ? 0.57 : 0.58);
      const pulse = fract(this.time * (this.beat > 0 ? 0.55 : 0.25));
      this.ring(x, y, 16 + pulse * 70, (1 - pulse) * (this.beat > 0 ? 0.7 : 0.23));
      if (this.beat > 0) {
        this.ring(x, y, 14 + fract(pulse + 0.5) * 70, (1 - fract(pulse + 0.5)) * 0.28);
        this.dot(x, y, 3.8, 0.65, 0);
      }
    }

    drawStars(intensity = 1) {
      for (let index = 0; index < this.count; index += 1) {
        const seed = this.seeds[index];
        const x = this.width * seed.x + Math.sin(this.time * 0.09 + seed.phase) * 12;
        const y = this.height * (0.12 + seed.y * 0.76) + Math.cos(this.time * 0.07 + seed.phase) * 10;
        const alpha = (0.18 + (Math.sin(this.time * seed.speed + seed.phase) + 1) * 0.12) * intensity;
        this.dot(x, y, seed.size * 0.75, alpha, seed.color);
        // A bounded set of fixed pairs, never an all-particle neighbour search.
        if (index < 14) {
          const next = this.seeds[index + 1];
          const nextX = this.width * next.x;
          const nextY = this.height * (0.12 + next.y * 0.76);
          if (Math.abs(x - nextX) + Math.abs(y - nextY) < this.width * 0.22) {
            this.line(x, y, nextX, nextY, 0.055 * intensity, 1);
          }
        }
      }
    }

    burstOrigin() {
      if (this.scene === 'cover' || this.scene === 'vision') return [0.77, 0.45];
      if (this.scene === 'reveal') return [0.5, 0.69];
      if (this.scene === 'quest') return [0.39, 0.58];
      if (this.scene === 'flow') return [0.64, 0.55];
      return [0.72, 0.62];
    }

    drawBurst() {
      const burst = this.burstState;
      if (!burst) return;
      const age = this.time - burst.start;
      if (age > 1.6) {
        this.burstState = null;
        return;
      }
      const [originX, originY] = this.burstOrigin();
      const x = this.width * originX;
      const y = this.height * originY;
      const progress = age / 1.6;
      const reach = Math.min(this.width, this.height) * (burst.strong ? 0.3 : 0.18);
      const fade = (1 - progress) ** 2;
      this.ring(x, y, 8 + progress * reach * 0.8, fade * 0.5, 1);
      for (const seed of burst.seeds) {
        const distance = (1 - (1 - progress) ** 2) * reach * seed.radius;
        const dotX = x + Math.cos(seed.phase) * distance;
        const dotY = y + Math.sin(seed.phase) * distance * 0.65;
        this.dot(dotX, dotY, seed.size * 1.25, fade * 0.85, seed.color);
      }
    }

    destroy() {
      this.setActive(false);
      window.removeEventListener('resize', this.handleResize);
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
  };
})();
