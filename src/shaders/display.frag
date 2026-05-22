#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uTexture;
out vec4 FragColor;

vec3 palette(float t) {
    // Deep space blue palette
    vec3 a = vec3(0.0, 0.0, 0.05);
    vec3 b = vec3(0.2, 0.5, 1.0);
    // Non-linear mapping for "glowing" effect
    return mix(a, b, smoothstep(0.0, 1.0, t * 1.5));
}

void main() {
    float density = texture(uTexture, vUv).x;
    vec3 color = palette(density);
    FragColor = vec4(color, 1.0);
}
