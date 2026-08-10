/**
 * WebGL Shader Program wrapper
 */
const shaderCaches = new WeakMap();

// After a context restore every cached shader object is invalid.
export function clearShaderCache(gl) {
  shaderCaches.delete(gl);
}

export class Program {
  constructor(gl, vertexSource, fragmentSource) {
    this.gl = gl;
    this.program = this.createProgram(vertexSource.trim(), fragmentSource.trim());
    this.uniforms = this.getUniforms(this.program);
  }

  createProgram(vSource, fSource) {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, vSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fSource);
    if (!vs || !fs) throw new Error('Shader compilation failed');

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      console.error("Program Link Error:", log);
      throw new Error(`Program link failed: ${log}`);
    }
    return program;
  }

  compileShader(type, source) {
    const gl = this.gl;
    let cache = shaderCaches.get(gl);
    if (!cache) {
      cache = new Map();
      shaderCaches.set(gl, cache);
    }

    const cacheKey = `${type}:${source}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Shader Compile Error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    cache.set(cacheKey, shader);
    return shader;
  }

  getUniforms(program) {
    const gl = this.gl;
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(program, i).name;
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return uniforms;
  }

  bind() {
    this.gl.useProgram(this.program);
  }
}
