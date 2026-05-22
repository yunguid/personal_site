#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
out vec4 FragColor;

void main() {
    float L = texture(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).x;
    float T = texture(uVelocity, vUv + vec2(0.0, uTexelSize.y)).y;
    float B = texture(uVelocity, vUv - vec2(0.0, uTexelSize.y)).y;

    float div = 0.5 * (R - L + T - B);
    FragColor = vec4(div, 0.0, 0.0, 1.0);
}
