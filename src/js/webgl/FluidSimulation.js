import { Program } from './Program.js';
import { createFBO, createDoubleFBO } from './Framebuffer.js';
import { CONFIG } from './config.js';

// Import shaders as raw text
import vertexShader from '../../shaders/vertex.glsl?raw';
import advectionShader from '../../shaders/advection.frag?raw';
import divergenceShader from '../../shaders/divergence.frag?raw';
import jacobiShader from '../../shaders/jacobi.frag?raw';
import gradientSubtractShader from '../../shaders/gradient-subtract.frag?raw';
import splatShader from '../../shaders/splat.frag?raw';
import displayShader from '../../shaders/display.frag?raw';

let canvas, gl, extLinear;
let velocity, density, divergence, pressure;
let programs = {};
let simWidth, simHeight;
let lastTime = performance.now();
let animationFrame = 0;
let animationSyncFrame = 0;
let resizeFrame = 0;
let isAnimating = false;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const FRAME_INTERVAL_MS = 1000 / 30;
let lastRenderedAt = 0;

function createBlit(gl) {
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const elementBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

  return (destination) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination ? destination.fbo : null);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  };
}

let blit;

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  if (canvas.width === width && canvas.height === height) return;

  canvas.width = width;
  canvas.height = height;
  simWidth = Math.floor(canvas.width >> CONFIG.TEXTURE_DOWNSAMPLE);
  simHeight = Math.floor(canvas.height >> CONFIG.TEXTURE_DOWNSAMPLE);
  velocity = createDoubleFBO(gl, simWidth, simHeight, extLinear);
  density = createDoubleFBO(gl, simWidth, simHeight, extLinear);
  divergence = createFBO(gl, simWidth, simHeight, extLinear);
  pressure = createDoubleFBO(gl, simWidth, simHeight, extLinear);
}

function splat(x, y, dx, dy, color, dt) {
  programs.splat.bind();
  gl.uniform1i(programs.splat.uniforms.uTarget, 0);
  gl.uniform1f(programs.splat.uniforms.uAspectRatio, simWidth / simHeight);
  gl.uniform2f(programs.splat.uniforms.uPoint, x, y);
  gl.uniform3f(programs.splat.uniforms.uColor, dx * dt, dy * dt, 0.0);
  gl.uniform1f(programs.splat.uniforms.uRadius, CONFIG.SPLAT_RADIUS);
  velocity.read.attach(0);
  blit(velocity.write);
  velocity.swap();

  gl.uniform3f(programs.splat.uniforms.uColor, color[0], color[1], color[2]);
  gl.uniform1i(programs.splat.uniforms.uTarget, 0);
  density.read.attach(0);
  blit(density.write);
  density.swap();
}

function update(t) {
  animationFrame = 0;
  if (isAnimating && t - lastRenderedAt < FRAME_INTERVAL_MS) {
    animationFrame = requestAnimationFrame(update);
    return;
  }

  const dt = Math.min((t - lastTime) / 1000, 0.016);
  lastTime = t;
  lastRenderedAt = t;
  gl.viewport(0, 0, simWidth, simHeight);
  const time = t * 0.001;

  // Automatic splats for ambient animation
  splat(
    0.5 + Math.sin(time) * 0.2,
    0.5 + Math.cos(time * 0.8) * 0.2,
    Math.cos(time * 2.5) * CONFIG.SPLAT_FORCE,
    Math.sin(time * 2.5) * CONFIG.SPLAT_FORCE,
    [0.1, 0.2, 0.8],
    dt
  );
  splat(
    0.5 + Math.cos(time * 1.4) * 0.25,
    0.5 + Math.sin(time * 1.2) * 0.25,
    Math.sin(time * 3.0) * CONFIG.SPLAT_FORCE * 0.8,
    Math.cos(time * 3.0) * CONFIG.SPLAT_FORCE * 0.8,
    [0.05, 0.4, 0.9],
    dt
  );

  // Advection
  programs.advection.bind();
  gl.uniform1f(programs.advection.uniforms.dt, dt);
  gl.uniform2f(programs.advection.uniforms.uTexelSize, 1.0 / simWidth, 1.0 / simHeight);
  gl.uniform1f(programs.advection.uniforms.uDissipation, CONFIG.VELOCITY_DISSIPATION);
  gl.uniform1i(programs.advection.uniforms.uVelocity, 0);
  gl.uniform1i(programs.advection.uniforms.uSource, 0);
  velocity.read.attach(0);
  blit(velocity.write);
  velocity.swap();

  gl.uniform1f(programs.advection.uniforms.uDissipation, CONFIG.DENSITY_DISSIPATION);
  gl.uniform1i(programs.advection.uniforms.uVelocity, 0);
  gl.uniform1i(programs.advection.uniforms.uSource, 1);
  velocity.read.attach(0);
  density.read.attach(1);
  blit(density.write);
  density.swap();

  // Divergence
  programs.divergence.bind();
  gl.uniform2f(programs.divergence.uniforms.uTexelSize, 1.0 / simWidth, 1.0 / simHeight);
  gl.uniform1i(programs.divergence.uniforms.uVelocity, 0);
  velocity.read.attach(0);
  blit(divergence);

  // Pressure (Jacobi iterations)
  programs.jacobi.bind();
  gl.uniform2f(programs.jacobi.uniforms.uTexelSize, 1.0 / simWidth, 1.0 / simHeight);
  gl.uniform1i(programs.jacobi.uniforms.uDivergence, 0);
  gl.uniform1i(programs.jacobi.uniforms.uPressure, 1);
  divergence.attach(0);
  for (let i = 0; i < CONFIG.PRESSURE_ITERATIONS; i++) {
    pressure.read.attach(1);
    blit(pressure.write);
    pressure.swap();
  }

  // Gradient Subtract
  programs.gradientSubtract.bind();
  gl.uniform2f(programs.gradientSubtract.uniforms.uTexelSize, 1.0 / simWidth, 1.0 / simHeight);
  gl.uniform1i(programs.gradientSubtract.uniforms.uPressure, 0);
  gl.uniform1i(programs.gradientSubtract.uniforms.uVelocity, 1);
  pressure.read.attach(0);
  velocity.read.attach(1);
  blit(velocity.write);
  velocity.swap();

  // Display
  gl.viewport(0, 0, canvas.width, canvas.height);
  programs.display.bind();
  gl.uniform1i(programs.display.uniforms.uTexture, 0);
  density.read.attach(0);
  blit(null);

  if (isAnimating) animationFrame = requestAnimationFrame(update);
}

function shouldAnimate() {
  return (
    document.visibilityState !== 'hidden'
    && window.scrollY < window.innerHeight * 1.15
    && !reducedMotion.matches
  );
}

function syncAnimation() {
  const nextAnimating = shouldAnimate();
  if (nextAnimating === isAnimating) return;
  isAnimating = nextAnimating;

  if (!isAnimating) {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    return;
  }

  lastTime = performance.now();
  animationFrame = requestAnimationFrame(update);
}

function scheduleAnimationSync() {
  if (animationSyncFrame) return;
  animationSyncFrame = requestAnimationFrame(() => {
    animationSyncFrame = 0;
    syncAnimation();
  });
}

function scheduleResize() {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    resize();
  });
}

const programDefinitions = [
  ['advection', advectionShader],
  ['divergence', divergenceShader],
  ['jacobi', jacobiShader],
  ['gradientSubtract', gradientSubtractShader],
  ['splat', splatShader],
  ['display', displayShader],
];

function finishInitialization() {
  resize();
  window.addEventListener('resize', scheduleResize, { passive: true });
  window.addEventListener('scroll', scheduleAnimationSync, { passive: true });
  document.addEventListener('visibilitychange', syncAnimation);
  reducedMotion.addEventListener?.('change', syncAnimation);

  if (reducedMotion.matches) update(performance.now());
  else syncAnimation();
}

function initializeNextProgram(index = 0) {
  if (index >= programDefinitions.length) {
    finishInitialization();
    return;
  }

  try {
    const [name, fragmentShader] = programDefinitions[index];
    programs[name] = new Program(gl, vertexShader, fragmentShader);
    requestAnimationFrame(() => initializeNextProgram(index + 1));
  } catch (error) {
    console.error('Initialization failed:', error);
  }
}

export function initFluidSimulation() {
  canvas = document.getElementById('glcanvas');
  if (!canvas) {
    console.error('Canvas element not found');
    return;
  }

  gl = canvas.getContext('webgl2');
  if (!gl) {
    console.error('WebGL 2.0 not available');
    canvas.hidden = true;
    return;
  }

  gl.getExtension('EXT_color_buffer_float');
  extLinear = gl.getExtension('OES_texture_float_linear');

  blit = createBlit(gl);

  initializeNextProgram();
}
