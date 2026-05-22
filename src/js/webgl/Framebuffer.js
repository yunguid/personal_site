/**
 * WebGL Framebuffer utilities
 */

export function createTexture(gl, width, height, extLinear) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  const filter = extLinear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export function createFBO(gl, width, height, extLinear) {
  const texture = createTexture(gl, width, height, extLinear);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return {
    fbo,
    texture,
    width,
    height,
    attach: (id) => {
      gl.activeTexture(gl.TEXTURE0 + id);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }
  };
}

export function createDoubleFBO(gl, width, height, extLinear) {
  let fbo1 = createFBO(gl, width, height, extLinear);
  let fbo2 = createFBO(gl, width, height, extLinear);
  return {
    width,
    height,
    read: fbo1,
    write: fbo2,
    swap() {
      const temp = this.read;
      this.read = this.write;
      this.write = temp;
    }
  };
}
