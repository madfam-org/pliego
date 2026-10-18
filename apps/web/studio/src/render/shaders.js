// @ts-check
// GLSL ES 3.00 sources for the studio renderer. Shader strings are compiled by WebGL — not eval'd —
// so they are fine under `script-src 'self'`.

/**
 * Sheets with their own colours, grain and printed layers. Three uniform arrays of this length sit
 * in the paper shader (48 × 3 = 144 of the 224 fragment uniform vectors WebGL2 guarantees), and two
 * art layers per sheet stay under the 256 array layers it guarantees. Sheets past it are drawn with
 * the last sheet's colours, and the renderer warns.
 */
export const MAX_SHEETS = 48;

export const PAPER_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in float aSheet;
uniform mat4 uViewProj;
uniform mat4 uLightViewProj;
out vec3 vPos;
out vec3 vNormal;
out vec2 vUv;
out vec4 vLightPos;
flat out int vSheet;
void main() {
  vPos = aPos;
  vNormal = aNormal;
  vUv = aUv;
  vSheet = int(aSheet + 0.5);
  vLightPos = uLightViewProj * vec4(aPos, 1.0);
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const SHADOW_FN = `
uniform highp sampler2DShadow uShadow;
uniform float uShadowTexel;
float shadowAt(vec4 lp, float bias) {
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  float s = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      s += texture(uShadow, vec3(p.xy + vec2(float(x), float(y)) * uShadowTexel, p.z - bias));
    }
  }
  return s / 9.0;
}`;

export const PAPER_FS = `#version 300 es
precision highp float;
precision mediump sampler2DArray;
in vec3 vPos;
in vec3 vNormal;
in vec2 vUv;
in vec4 vLightPos;
flat in int vSheet;
uniform vec3 uFront[${MAX_SHEETS}];
uniform vec3 uBack[${MAX_SHEETS}];
uniform vec4 uSheetInfo[${MAX_SHEETS}];   // xy: sheet size (mm), z: grain (rad), w: printed-layer flags (1 front, 2 back)
uniform sampler2DArray uArt;               // layer 2s: front, 2s+1: back (back view, sampled at 1 − u); premultiplied sRGB
uniform vec3 uLightDir;                    // unit, toward the light
uniform vec3 uEye;
uniform vec3 uSky;
uniform vec3 uGround;
${SHADOW_FN}
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Procedural paper grain: fibres elongated along the machine direction, plus fine felt.
float grain(vec2 mm, float ang) {
  float c = cos(ang), s = sin(ang);
  vec2 g = vec2(c * mm.x + s * mm.y, -s * mm.x + c * mm.y);
  float fib = noise(vec2(g.x * 0.35, g.y * 3.2)) * 0.6 + noise(vec2(g.x * 0.9, g.y * 7.0)) * 0.4;
  float felt = noise(mm * 2.3);
  return mix(fib, felt, 0.45);
}

void main() {
  int s = clamp(vSheet, 0, ${MAX_SHEETS - 1});
  vec4 info = uSheetInfo[s];
  bool front = gl_FrontFacing;
  vec3 n = normalize(vNormal);
  if (!front) n = -n;
  vec3 base = front ? uFront[s] : uBack[s];
  int flags = int(info.w + 0.5);
  if ((front && (flags & 1) != 0) || (!front && (flags & 2) != 0)) {
    vec2 uv = front ? vUv : vec2(1.0 - vUv.x, vUv.y);
    vec4 art = texture(uArt, vec3(uv.x, 1.0 - uv.y, float(s * 2 + (front ? 0 : 1))));
    if (art.a > 0.0) base = mix(base, pow(min(art.rgb / art.a, vec3(1.0)), vec3(2.2)), art.a);   // un-premultiply, to linear
  }
  float g = grain(vUv * info.xy, info.z);
  base *= 0.965 + 0.07 * g;
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(uEye - vPos);
  float ndl = dot(n, L);
  float sh = shadowAt(vLightPos, 0.0015 + 0.002 * (1.0 - abs(ndl)));
  float diffuse = max(ndl, 0.0) * sh;
  float transmit = max(-ndl, 0.0) * 0.22 * sh;      // paper is translucent: light through the sheet
  vec3 hemi = mix(uGround, uSky, n.y * 0.5 + 0.5);
  float sheen = pow(max(dot(n, normalize(L + V)), 0.0), 28.0) * 0.035 * sh;
  vec3 col = base * (hemi * 0.62 + vec3(1.0, 0.97, 0.92) * (diffuse * 0.7 + transmit)) + sheen;
  outColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

export const GROUND_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uLightViewProj;
out vec3 vPos;
out vec4 vLightPos;
void main() {
  vPos = aPos;
  vLightPos = uLightViewProj * vec4(aPos, 1.0);
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

// The table: a soft shadow whose penumbra widens with the paper's height above the table (a small
// blocker search in the shadow map, then a filter as wide as the light's size makes it; the same
// idea as PCSS, 12 + 12 taps), and a little ambient occlusion where paper lies close to the table.
// Only the table pays for it; paper keeps the cheaper 3 × 3 filter. Everything is in mm: the light
// is orthographic, so shadow-map depth is linear.
export const GROUND_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec4 vLightPos;
uniform vec3 uTable;
uniform vec3 uClear;
uniform vec3 uCenter;
uniform float uRadius;
uniform highp sampler2DShadow uShadow;
uniform highp sampler2D uShadowDepth;      // the same depth texture, read without comparison
uniform float uShadowTexel;                // 1 / shadow-map size
uniform float uDepthMm;                    // light depth range in mm (depth 0…1)
uniform float uTexelMm;                    // mm per shadow-map texel
out vec4 outColor;
const vec2 DISK[8] = vec2[](   // Poisson disk; rotated per pixel below
  vec2(-0.613, 0.617), vec2(0.170, -0.040), vec2(-0.299, -0.792), vec2(0.645, 0.493),
  vec2(-0.651, -0.236), vec2(0.421, -0.784), vec2(0.024, 0.968), vec2(0.928, -0.208));
const float LIGHT_SLOPE = 0.05;            // penumbra width per mm of height (a light about 3° wide)
void main() {
  vec3 p = vLightPos.xyz / vLightPos.w * 0.5 + 0.5;
  float sh = 1.0, occl = 0.0;
  if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0 && p.z < 1.0) {
    float bias = 0.002;
    // a per-pixel rotation of the disk (interleaved gradient noise) turns banding into fine grain
    float a = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
    float search = clamp(8.0 / uTexelMm, 2.0, 48.0) * uShadowTexel;   // look 8 mm around
    float zb = 0.0, nb = 0.0;
    for (int i = 0; i < 8; i++) {
      float d = texture(uShadowDepth, p.xy + rot * DISK[i] * search).r;
      if (d < p.z - bias) { zb += d; nb += 1.0; }
    }
    if (nb > 0.0) {
      float height = (p.z - zb / nb) * uDepthMm;                    // mm between paper and table
      float pen = clamp(height * LIGHT_SLOPE / uTexelMm, 1.0, 32.0) * uShadowTexel;
      float s = 0.0;
      for (int i = 0; i < 8; i++) s += texture(uShadow, vec3(p.xy + rot * DISK[i] * pen, p.z - bias));
      sh = s / 8.0;
      occl = (nb / 8.0) * exp(-height / 12.0);                      // paper lying close above
    }
  }
  vec3 col = uTable * (0.62 * (1.0 - 0.45 * occl) + 0.38 * sh);
  float d = length(vPos.xz - uCenter.xz) / uRadius;
  col = mix(col, uClear, smoothstep(0.55, 1.0, d));
  outColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

export const DEPTH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uLightViewProj;
void main() { gl_Position = uLightViewProj * vec4(aPos, 1.0); }`;

export const DEPTH_FS = `#version 300 es
precision mediump float;
void main() {}`;

export const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
uniform mat4 uViewProj;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
  gl_Position.z -= 0.0008 * gl_Position.w;   // lift crease lines off the paper
}`;

// uShade < 0: the line's own colour (the crease overlay). uShade ≥ 0: a darkening factor drawn with
// multiplicative blending (paper edges and pressed creases take the paper's own colour, darker).
export const LINE_FS = `#version 300 es
precision mediump float;
in vec3 vColor;
uniform float uShade;
out vec4 outColor;
void main() { outColor = uShade < 0.0 ? vec4(vColor, 1.0) : vec4(vec3(uShade), 1.0); }`;
