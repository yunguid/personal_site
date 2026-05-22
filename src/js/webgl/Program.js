/**
 * WebGL Shader Program wrapper
 */
export class Program {
  constructor(gl, vertexSource, fragmentSource) {
    this.gl = gl;
    this.program = this.createProgram(vertexSource.trim(), fragmentSource.trim());
    if (this.program) {
      this.uniforms = this.getUniforms(this.program);
    }
  }

  createProgram(vSource, fSource) {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, vSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fSource);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program Link Error:", gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Shader Compile Error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
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
    if (this.program) {
      this.gl.useProgram(this.program);
    }
  }
}
