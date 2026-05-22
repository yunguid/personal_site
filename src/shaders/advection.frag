#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexelSize;
uniform float dt;
uniform float uDissipation;
out vec4 FragColor;

void main() {
    vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * uTexelSize;
    FragColor = texture(uSource, coord) * uDissipation;
}
