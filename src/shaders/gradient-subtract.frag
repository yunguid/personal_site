#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
out vec4 FragColor;

void main() {
    float L = texture(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
    float T = texture(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
    float B = texture(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
    vec2 velocity = texture(uVelocity, vUv).xy;
    velocity.xy -= vec2(R - L, T - B) * 0.5;
    FragColor = vec4(velocity, 0.0, 1.0);
}
