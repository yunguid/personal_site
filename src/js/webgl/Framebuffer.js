/**
 * WebGL Framebuffer utilities
 */

// Half-float render targets need one of these extensions in WebGL2. Linear
// filtering of 16F textures is core, so no filtering extension is required.
export function getRenderFormats(gl) {
  const renderable = gl.getExtension('EXT_color_buffer_float')
    || gl.getExtension('EXT_color_buffer_half_float');
  if (!renderable) return null;
  return {
    vector: { internalFormat: gl.RG16F, format: gl.RG },
    scalar: { internalFormat: gl.R16F, format: gl.RED },
  };
}

export function createTexture(gl, width, height, texFormat) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, texFormat.internalFormat, width, height, 0, texFormat.format, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export function createFBO(gl, width, height, texFormat) {
  const texture = createTexture(gl, width, height, texFormat);
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

export function createDoubleFBO(gl, width, height, texFormat) {
  let fbo1 = createFBO(gl, width, height, texFormat);
  let fbo2 = createFBO(gl, width, height, texFormat);
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

export function disposeFBO(gl, target) {
  gl.deleteFramebuffer(target.fbo);
  gl.deleteTexture(target.texture);
}

export function disposeDoubleFBO(gl, target) {
  disposeFBO(gl, target.read);
  disposeFBO(gl, target.write);
}
