import { Program, clearShaderCache } from './Program.js';
import { createFBO, createDoubleFBO, disposeFBO, disposeDoubleFBO, getRenderFormats } from './Framebuffer.js';
import { CONFIG } from './config.js';

// Import shaders as raw text
import vertexShader from '../../shaders/vertex.glsl?raw';
import advectionShader from '../../shaders/advection.frag?raw';
import divergenceShader from '../../shaders/divergence.frag?raw';
import jacobiShader from '../../shaders/jacobi.frag?raw';
import gradientSubtractShader from '../../shaders/gradient-subtract.frag?raw';
import splatShader from '../../shaders/splat.frag?raw';
import displayShader from '../../shaders/display.frag?raw';

// Dissipation and injection constants are tuned for this rate; scaling by dt
// keeps the fluid's speed, brightness, and decay identical at any refresh rate.
const REFERENCE_RATE = 60;
// Velocity lives in texels/second; forces are tuned against this grid width so
// on-screen speed stays the same across window sizes and quality tiers.
const REFERENCE_SIM_WIDTH = 340;
const MAX_DT = 1 / 30;
const STALL_MS = 250;
const MIN_FRAME_MS = 1000 / 60 - 3;

// One-way ladder: stepped down under sustained overload, never back up.
const QUALITY_LADDER = [
  { pressureIterations: CONFIG.PRESSURE_ITERATIONS, downsample: CONFIG.TEXTURE_DOWNSAMPLE, minFrameMs: MIN_FRAME_MS },
  { pressureIterations: 12, downsample: CONFIG.TEXTURE_DOWNSAMPLE, minFrameMs: MIN_FRAME_MS },
  { pressureIterations: 10, downsample: CONFIG.TEXTURE_DOWNSAMPLE + 1, minFrameMs: MIN_FRAME_MS },
  { pressureIterations: 8, downsample: CONFIG.TEXTURE_DOWNSAMPLE + 1, minFrameMs: 1000 / 30 - 2 },
];
const SLOW_FRAME_HEADROOM_MS = 14;
const SLOW_FRAMES_TO_STEP_DOWN = 60;
const WARMUP_FRAMES = 90;

let canvas, gl, formats;
let velocity, density, divergence, pressure;
let programs = {};
let blit = null;
let simWidth = 0;
let simHeight = 0;
let running = false;
let ready = false;
let contextLost = false;
let listenersAttached = false;
let resizePending = false;
let rafId = 0;
let lastTime = 0;
let lastRenderedAt = 0;
let qualityLevel = 0;
let slowFrames = 0;
let warmupFrames = WARMUP_FRAMES;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function createBlit(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const elementBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  return (destination) => {
    if (destination) {
      gl.viewport(0, 0, destination.width, destination.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, destination.fbo);
    } else {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  };
}

// Bilinear re-projection of a field onto a new grid: the advection shader with
// dt = 0 samples the source at vUv, and uDissipation doubles as a gain to keep
// texel-space velocities equivalent across grid resolutions.
function copyField(src, dst, gain = 1) {
  const p = programs.advection;
  p.bind();
  gl.uniform1f(p.uniforms.dt, 0);
  gl.uniform1f(p.uniforms.uDissipation, gain);
  gl.uniform2f(p.uniforms.uTexelSize, 1 / src.width, 1 / src.height);
  gl.uniform1i(p.uniforms.uVelocity, 0);
  gl.uniform1i(p.uniforms.uSource, 0);
  src.attach(0);
  blit(dst);
}

function applySize() {
  const width = Math.max(1, Math.round(window.innerWidth));
  const height = Math.max(1, Math.round(window.innerHeight));
  const { downsample } = QUALITY_LADDER[qualityLevel];
  const sw = Math.max(2, width >> downsample);
  const sh = Math.max(2, height >> downsample);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  if (velocity && sw === simWidth && sh === simHeight) return;

  const old = velocity ? { velocity, density, pressure, divergence } : null;
  const velocityGain = old ? sw / simWidth : 1;
  simWidth = sw;
  simHeight = sh;
  velocity = createDoubleFBO(gl, sw, sh, formats.vector);
  density = createDoubleFBO(gl, sw, sh, formats.scalar);
  pressure = createDoubleFBO(gl, sw, sh, formats.scalar);
  divergence = createFBO(gl, sw, sh, formats.scalar);

  if (old) {
    copyField(old.velocity.read, velocity.write, velocityGain);
    velocity.swap();
    copyField(old.density.read, density.write);
    density.swap();
    copyField(old.pressure.read, pressure.write);
    pressure.swap();
    disposeDoubleFBO(gl, old.velocity);
    disposeDoubleFBO(gl, old.density);
    disposeDoubleFBO(gl, old.pressure);
    disposeFBO(gl, old.divergence);
  }
}

function splat(x, y, dx, dy, amount) {
  programs.splat.bind();
  gl.uniform1i(programs.splat.uniforms.uTarget, 0);
  gl.uniform1f(programs.splat.uniforms.uAspectRatio, simWidth / simHeight);
  gl.uniform2f(programs.splat.uniforms.uPoint, x, y);
  gl.uniform3f(programs.splat.uniforms.uColor, dx, dy, 0.0);
  gl.uniform1f(programs.splat.uniforms.uRadius, CONFIG.SPLAT_RADIUS);
  velocity.read.attach(0);
  blit(velocity.write);
  velocity.swap();

  gl.uniform3f(programs.splat.uniforms.uColor, amount, 0.0, 0.0);
  density.read.attach(0);
  blit(density.write);
  density.swap();
}

function step(dt, time) {
  const rateScale = dt * REFERENCE_RATE;
  const force = CONFIG.SPLAT_FORCE * (simWidth / REFERENCE_SIM_WIDTH);

  // Ambient splats keep the field alive without pointer input
  splat(
    0.5 + Math.sin(time) * 0.2,
    0.5 + Math.cos(time * 0.8) * 0.2,
    Math.cos(time * 2.5) * force * dt,
    Math.sin(time * 2.5) * force * dt,
    0.1 * rateScale
  );
  splat(
    0.5 + Math.cos(time * 1.4) * 0.25,
    0.5 + Math.sin(time * 1.2) * 0.25,
    Math.sin(time * 3.0) * force * 0.8 * dt,
    Math.cos(time * 3.0) * force * 0.8 * dt,
    0.05 * rateScale
  );

  // Advection
  programs.advection.bind();
  gl.uniform1f(programs.advection.uniforms.dt, dt);
  gl.uniform2f(programs.advection.uniforms.uTexelSize, 1 / simWidth, 1 / simHeight);
  gl.uniform1f(programs.advection.uniforms.uDissipation, Math.pow(CONFIG.VELOCITY_DISSIPATION, rateScale));
  gl.uniform1i(programs.advection.uniforms.uVelocity, 0);
  gl.uniform1i(programs.advection.uniforms.uSource, 0);
  velocity.read.attach(0);
  blit(velocity.write);
  velocity.swap();

  gl.uniform1f(programs.advection.uniforms.uDissipation, Math.pow(CONFIG.DENSITY_DISSIPATION, rateScale));
  gl.uniform1i(programs.advection.uniforms.uSource, 1);
  velocity.read.attach(0);
  density.read.attach(1);
  blit(density.write);
  density.swap();

  // Divergence
  programs.divergence.bind();
  gl.uniform2f(programs.divergence.uniforms.uTexelSize, 1 / simWidth, 1 / simHeight);
  gl.uniform1i(programs.divergence.uniforms.uVelocity, 0);
  velocity.read.attach(0);
  blit(divergence);

  // Pressure solve (Jacobi, warm-started from the previous frame)
  programs.jacobi.bind();
  gl.uniform2f(programs.jacobi.uniforms.uTexelSize, 1 / simWidth, 1 / simHeight);
  gl.uniform1i(programs.jacobi.uniforms.uDivergence, 0);
  gl.uniform1i(programs.jacobi.uniforms.uPressure, 1);
  divergence.attach(0);
  const iterations = QUALITY_LADDER[qualityLevel].pressureIterations;
  for (let i = 0; i < iterations; i++) {
    pressure.read.attach(1);
    blit(pressure.write);
    pressure.swap();
  }

  // Gradient subtract
  programs.gradientSubtract.bind();
  gl.uniform2f(programs.gradientSubtract.uniforms.uTexelSize, 1 / simWidth, 1 / simHeight);
  gl.uniform1i(programs.gradientSubtract.uniforms.uPressure, 0);
  gl.uniform1i(programs.gradientSubtract.uniforms.uVelocity, 1);
  pressure.read.attach(0);
  velocity.read.attach(1);
  blit(velocity.write);
  velocity.swap();
}

function render() {
  programs.display.bind();
  gl.uniform1i(programs.display.uniforms.uTexture, 0);
  density.read.attach(0);
  blit(null);
}

function seed(seconds) {
  if (!velocity) return;
  let time = performance.now() * 0.001;
  const steps = Math.round(seconds * REFERENCE_RATE);
  for (let i = 0; i < steps; i++) {
    time += 1 / REFERENCE_RATE;
    step(1 / REFERENCE_RATE, time);
  }
}

function stepDown() {
  if (qualityLevel >= QUALITY_LADDER.length - 1) return;
  qualityLevel++;
  slowFrames = 0;
  warmupFrames = WARMUP_FRAMES;
  applySize();
}

function update(t) {
  rafId = 0;
  if (!running) return;

  const quality = QUALITY_LADDER[qualityLevel];
  const sincePrev = t - lastRenderedAt;
  if (sincePrev < quality.minFrameMs) {
    rafId = requestAnimationFrame(update);
    return;
  }

  if (resizePending) {
    resizePending = false;
    applySize();
  }

  // Clamped, stall-aware timestep: background tabs and long tasks resume with
  // a normal step instead of a catch-up burst.
  let dt = (t - lastTime) / 1000;
  if (!(dt > 0) || dt * 1000 > STALL_MS) dt = 1 / REFERENCE_RATE;
  else if (dt > MAX_DT) dt = MAX_DT;
  lastTime = t;
  lastRenderedAt = t;

  step(dt, t * 0.001);
  render();

  if (warmupFrames > 0) {
    warmupFrames--;
  } else if (sincePrev > quality.minFrameMs + SLOW_FRAME_HEADROOM_MS) {
    if (++slowFrames >= SLOW_FRAMES_TO_STEP_DOWN) stepDown();
  } else if (slowFrames > 0) {
    slowFrames--;
  }

  rafId = requestAnimationFrame(update);
}

function shouldRun() {
  return ready && !contextLost && document.visibilityState !== 'hidden' && !reducedMotion.matches;
}

function syncRunning() {
  const next = shouldRun();
  if (next === running) return;
  running = next;

  if (!running) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    return;
  }

  lastTime = performance.now();
  lastRenderedAt = 0;
  slowFrames = 0;
  warmupFrames = WARMUP_FRAMES;
  // The viewport may have changed (or been zero) while suspended.
  resizePending = true;
  rafId = requestAnimationFrame(update);
}

function onReducedMotionChange() {
  syncRunning();
  if (!running && ready && reducedMotion.matches) render();
}

function onResize() {
  resizePending = true;
  if (!running && ready) {
    resizePending = false;
    applySize();
    render();
  }
}

function onContextLost(event) {
  event.preventDefault();
  contextLost = true;
  ready = false;
  syncRunning();
}

function onContextRestored() {
  clearShaderCache(gl);
  programs = {};
  blit = null;
  velocity = density = pressure = divergence = null;
  simWidth = 0;
  simHeight = 0;
  formats = getRenderFormats(gl);
  if (!formats) {
    fatalFallback('float render targets unavailable');
    return;
  }
  contextLost = false;
  blit = createBlit(gl);
  initializePrograms(true);
}

function fatalFallback(reason) {
  console.warn('Fluid background disabled:', reason);
  ready = false;
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (canvas) canvas.hidden = true;
  document.documentElement.classList.add('no-fluid');
}

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  window.addEventListener('resize', onResize, { passive: true });
  document.addEventListener('visibilitychange', syncRunning);
  reducedMotion.addEventListener?.('change', onReducedMotionChange);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
}

function finishInitialization() {
  applySize();
  gl.bindFramebuffer(gl.FRAMEBUFFER, velocity.read.fbo);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    fatalFallback('framebuffer incomplete');
    return;
  }
  ready = true;
  attachListeners();

  if (reducedMotion.matches) {
    // Reduced motion gets one calm, fully formed frame instead of animation.
    seed(2.5);
    render();
    return;
  }
  syncRunning();
}

const programDefinitions = [
  ['advection', advectionShader],
  ['divergence', divergenceShader],
  ['jacobi', jacobiShader],
  ['gradientSubtract', gradientSubtractShader],
  ['splat', splatShader],
  ['display', displayShader],
];

function initializePrograms(sync) {
  let index = 0;
  const buildNext = () => {
    if (index >= programDefinitions.length) {
      finishInitialization();
      return;
    }
    try {
      const [name, fragmentShader] = programDefinitions[index];
      programs[name] = new Program(gl, vertexShader, fragmentShader);
    } catch (error) {
      console.error('Fluid initialization failed:', error);
      fatalFallback('shader compilation failed');
      return;
    }
    index++;
    if (sync) buildNext();
    else requestAnimationFrame(buildNext);
  };
  buildNext();
}

export function initFluidSimulation(syncCompile = false) {
  if (gl) return;
  canvas = document.getElementById('glcanvas');
  if (!canvas) return;

  gl = canvas.getContext('webgl2', {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
    powerPreference: 'low-power',
  });
  if (!gl) {
    fatalFallback('WebGL2 unavailable');
    return;
  }

  formats = getRenderFormats(gl);
  if (!formats) {
    fatalFallback('float render targets unavailable');
    return;
  }

  blit = createBlit(gl);
  initializePrograms(syncCompile);
}

if (import.meta.env.DEV) {
  window.__fluid = {
    init: () => initFluidSimulation(true),
    stats: () => ({
      ready,
      running,
      contextLost,
      qualityLevel,
      simWidth,
      simHeight,
      canvasWidth: canvas?.width,
      canvasHeight: canvas?.height,
      slowFrames,
    }),
    seed,
    render,
    setQuality: (level) => {
      qualityLevel = Math.min(Math.max(level, 0), QUALITY_LADDER.length - 1);
      applySize();
    },
    timeSteps: (frames = 120) => {
      if (!ready) return null;
      const start = performance.now();
      let time = start * 0.001;
      for (let i = 0; i < frames; i++) {
        time += 1 / REFERENCE_RATE;
        step(1 / REFERENCE_RATE, time);
        render();
      }
      gl.finish();
      const totalMs = performance.now() - start;
      return { frames, totalMs: +totalMs.toFixed(2), perFrameMs: +(totalMs / frames).toFixed(3) };
    },
  };
}
