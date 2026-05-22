#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexelSize;
out vec4 FragColor;

void main() {
    float L = texture(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
    float T = texture(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
    float B = texture(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
    float C = texture(uDivergence, vUv).x;

    float p = (L + R + T + B - C) * 0.25;
    FragColor = vec4(p, 0.0, 0.0, 1.0);
}
