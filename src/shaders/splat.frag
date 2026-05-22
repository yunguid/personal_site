#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uTarget;
uniform float uAspectRatio;
uniform vec2 uPoint;
uniform vec3 uColor;
uniform float uRadius;
out vec4 FragColor;

void main() {
    vec2 p = vUv - uPoint.xy;
    p.x *= uAspectRatio;
    vec3 splat = exp(-dot(p, p) / uRadius) * uColor;
    vec3 base = texture(uTarget, vUv).xyz;
    FragColor = vec4(base + splat, 1.0);
}
