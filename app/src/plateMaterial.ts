import * as THREE from "three";

// One plate = one layer of the video's style stack.
// Packed video = 3 x 2 grid: [source | character | text] / [broll region | motion | edges]
export const KIND = { set: 0, character: 1, broll: 2, motion: 3, format: 4, text: 5, plain: 6, rgba: 7, grade: 8 } as const;

const vert = /* glsl */ `
varying vec2 vUv;
varying float vPeel;
uniform float uPeelOn;   // 1: the rows above the scan line move out to the layer's place (hook)
uniform vec3 uPeel;      // that move, in the plate's own space
uniform float uScanY;    // the scan line, plate uv y (1 = top)
void main() {
  vUv = uv;
  float w = uPeelOn > 0.5 ? smoothstep(uScanY, uScanY + 0.22, uv.y) : 1.0;
  vPeel = w;
  vec3 pos = position + uPeel * (uPeelOn > 0.5 ? w : 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const frag = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vPeel;
uniform float uPeelOp0;     // opacity of the rows that are not separated yet
uniform float uCtxLift;     // 0 = the usual dark context around a layer's pixels, 1 = the full frame (hook reads)
uniform float uEdgeAmt;     // format: how strong the edge lines are
uniform float uSeamCut;     // hook: drop this band around the seam (the subtitle) from the set / character / b-roll / motion plates
uniform float uGap;         // format (hook): the two halves pulled apart by this much (plate uv)
uniform sampler2D uTex;      // packed video, or a plain video / canvas
uniform int uKind;
uniform vec4 uRegion;        // plate area that holds content (x0,y0,x1,y1), uv with y up
uniform vec4 uWin;           // source window (x0,y0,x1,y1) in the source frame
uniform float uOpacity;
uniform float uFill;         // glass fill strength
uniform float uBorder;       // border strength
uniform vec3 uAccent;
uniform float uLayout;       // 0 a_full, 1 split, 2 b_full
uniform float uGrade;        // 0..1: the reference's night-neon grade
uniform float uTime;
uniform float uFlash;        // highlight pulse
uniform float uRemove;       // set: how far the person is taken out
uniform float uHole;
uniform float uOutline;      // set: the lit outline where the person was
uniform float uGhost;        // b-roll / text / motion: a faint copy of the whole frame, so the layer's place reads
uniform vec4 uBox;           // text: the caption box (x0,y0,x1,y1, uv y up)
uniform float uBoxOn;
uniform float uCut;          // motion: a flash on each cut
uniform vec3 uPal[6];        // grade: the measured palette
uniform float uPalMix;       // grade: 1 = only palette colours
uniform float uRegionTint;   // format (site v2): fill each layout region with its colour

vec2 cell(vec2 uv, float c) {
  float col = mod(c, 3.0);
  float row = floor(c / 3.0);
  return vec2((col + uv.x) / 3.0, (1.0 - row) * 0.5 + uv.y * 0.5);
}
vec3 heat(float m) {
  vec3 a = vec3(0.10, 0.02, 0.20);
  vec3 b = vec3(0.75, 0.10, 0.55);
  vec3 c = vec3(1.00, 0.55, 0.18);
  vec3 d = vec3(1.00, 0.95, 0.80);
  if (m < 0.33) return mix(a, b, m / 0.33);
  if (m < 0.66) return mix(b, c, (m - 0.33) / 0.33);
  return mix(c, d, (m - 0.66) / 0.34);
}
vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 g = c;
  g = mix(g, g * vec3(1.08, 0.86, 1.16), 0.85);           // push toward magenta-violet
  g += vec3(0.035, 0.0, 0.06) * (1.0 - smoothstep(0.0, 0.35, l)); // violet shadows
  g = mix(vec3(l), g, 1.12);
  g = pow(g, vec3(1.06));
  return g;
}
float box(vec2 p, vec4 r, float w) {
  float dx = min(abs(p.x - r.x), abs(p.x - r.z));
  float dy = min(abs(p.y - r.y), abs(p.y - r.w));
  bool inX = p.x >= r.x - w && p.x <= r.z + w;
  bool inY = p.y >= r.y - w && p.y <= r.w + w;
  float e = 0.0;
  if (inY && dx < w) e = 1.0;
  if (inX && dy < w * 0.5625) e = 1.0;
  return e;
}

void main() {
  vec2 p = vUv;
  vec2 p0 = vUv;
  float g2 = uGap * 0.5;
  bool gapZone = false;
  if (uGap > 0.0) {
    if (p.y > 0.5 + g2) p.y -= g2; else if (p.y < 0.5 - g2) p.y += g2; else gapZone = true;
  }
  vec4 outc = vec4(0.0);
  bool seamOut = uSeamCut > 0.0 && uKind <= 4 && p.y > 0.5 - uSeamCut && p.y < 0.5 + uSeamCut * 0.6;
  bool inside = !gapZone && !seamOut && p.x >= uRegion.x && p.x <= uRegion.z && p.y >= uRegion.y && p.y <= uRegion.w;
  vec2 q = (p - uRegion.xy) / (uRegion.zw - uRegion.xy);
  vec2 s = uWin.xy + q * (uWin.zw - uWin.xy);
  if (inside) {
    if (uKind == 6) {
      vec3 c = texture2D(uTex, s).rgb;
      outc = vec4(mix(c, grade(c), uGrade), 1.0);
    } else if (uKind == 7) {
      outc = texture2D(uTex, s);
    } else if (uKind == 8) {   // color grade: the true picture + its palette in a band at the bottom
      vec3 c = texture2D(uTex, cell(s, 0.0)).rgb;
      outc = vec4(c, 1.0);
      if (p.y < 0.075) {
        float k = floor(clamp(p.x, 0.0, 0.999) * 6.0);
        vec3 sw = uPal[0];
        for (int i = 1; i < 6; i++) { if (float(i) == k) sw = uPal[i]; }
        float gap = step(0.012, fract(p.x * 6.0)) * step(0.008, p.y) * step(p.y, 0.067);
        outc = vec4(mix(vec3(0.03), sw, gap), 1.0);
      }
    } else {
      vec3 src = texture2D(uTex, cell(s, 0.0)).rgb;
      src = mix(src, grade(src), uGrade);
      float ch = texture2D(uTex, cell(s, 1.0)).r;
      float br = texture2D(uTex, cell(s, 3.0)).r;
      if (uKind == 0) {          // set = the A-roll area minus the person
        // the person is pulled out: a dim silhouette stays (uHole = 1 would cut a real hole)
        float m = clamp((1.0 - br) * mix(1.0, 1.0 - ch, uRemove * uHole * vPeel), 0.0, 1.0);
        float l0 = dot(src, vec3(0.299, 0.587, 0.114));
        vec3 col = mix(src, vec3(l0) * 0.16, ch * uRemove * vPeel);
        outc = vec4(col, m);
        if (uOutline > 0.0) {
          vec2 px = vec2(1.0 / 540.0, 1.0 / 960.0) * 2.5;
          float gx = texture2D(uTex, cell(s + vec2(px.x, 0.0), 1.0)).r - texture2D(uTex, cell(s - vec2(px.x, 0.0), 1.0)).r;
          float gy = texture2D(uTex, cell(s + vec2(0.0, px.y), 1.0)).r - texture2D(uTex, cell(s - vec2(0.0, px.y), 1.0)).r;
          float edge = smoothstep(0.25, 0.6, length(vec2(gx, gy))) * (1.0 - br);
          outc = mix(outc, vec4(uAccent, 1.0), edge * uOutline);
        }
      } else if (uKind == 1) {   // character
        float c1 = smoothstep(0.08, 0.6, ch);
        outc = vec4(mix(src * mix(0.2, 1.0, uCtxLift), src, c1), max(c1, uGhost));
      } else if (uKind == 2) {   // b-roll
        float b = smoothstep(0.2, 0.8, br);
        outc = vec4(mix(src * mix(0.22, 1.0, uCtxLift), src, b), max(b, uGhost));
      } else if (uKind == 3) {   // motion: the hot spots on a grey copy of the frame
        float m = texture2D(uTex, cell(s, 4.0)).r;
        m = clamp(m * 1.6, 0.0, 0.78);
        float a = smoothstep(0.03, 0.35, m) * 0.9;
        float l = dot(src, vec3(0.299, 0.587, 0.114));
        vec3 base = vec3(l) * mix(0.75, 0.45, smoothstep(0.4, 0.9, l));
        outc = vec4(mix(base, heat(m), a), max(a, uGhost));
        outc.rgb += vec3(1.0, 0.92, 0.85) * uCut * 0.35;
      } else if (uKind == 4 && uRegionTint > 0.0) {   // format: the true picture, a soft glow of the region color inside each region's edge
        bool split = uLayout > 0.5 && uLayout < 1.5;
        bool top = p.y > 0.5;
        vec3 tint = split ? (top ? vec3(0.24, 0.86, 0.59) : vec3(1.0, 0.6, 0.3)) : (uLayout < 0.5 ? vec3(1.0, 0.6, 0.3) : vec3(0.69, 0.55, 1.0));
        vec4 r = split ? (top ? vec4(0.0, 0.5, 1.0, 1.0) : vec4(0.0, 0.0, 1.0, 0.5)) : vec4(0.0, 0.0, 1.0, 1.0);
        float d = min(min(p.x - r.x, r.z - p.x) * 0.5625, min(p.y - r.y, r.w - p.y));
        float glow = 1.0 - smoothstep(0.0, 0.06, d);
        outc = vec4(mix(src, tint, 0.05 + glow * glow * 0.45), 1.0);
      } else if (uKind == 4) {   // format: edges + layout boxes
        float e = texture2D(uTex, cell(s, 5.0)).r;
        outc = vec4(mix(src * mix(0.22, 1.0, uCtxLift), vec3(0.95, 0.93, 0.9), e * uEdgeAmt), max(e * 0.38, uGhost));
      } else if (uKind == 5) {   // text glyphs
        float t = smoothstep(0.25, 0.7, texture2D(uTex, cell(s, 2.0)).r);
        outc = vec4(mix(src * mix(0.25, 1.0, uCtxLift), src * 1.15 + 0.05, t), max(t, uGhost));
      }
    }
  }
  if (uKind == 4) {
    float w = 0.006;
    float b = box(p0, vec4(0.0, 0.0, 1.0, 1.0), w);
    if (uGap > 0.0) {
      b = max(b, box(p0, vec4(0.03, 0.5 + g2 + 0.012, 0.97, 0.985), w * 0.9));
      b = max(b, box(p0, vec4(0.03, 0.015, 0.97, 0.5 - g2 - 0.012), w * 0.9));
      float seam = 1.0 - smoothstep(0.0, 0.003, abs(p0.y - 0.5));
      float dash = step(0.5, fract(p0.x * 14.0 - uTime * 0.8));
      b = max(b, seam * dash);
    } else if (uLayout > 0.5 && uLayout < 1.5) {
      b = max(b, box(p, vec4(0.03, 0.515, 0.97, 0.985), w * 0.7));
      b = max(b, box(p, vec4(0.03, 0.015, 0.97, 0.485), w * 0.7));
      float seam = 1.0 - smoothstep(0.0, 0.004, abs(p.y - 0.5));
      float dash = step(0.5, fract(p.x * 18.0 - uTime * 0.6));
      b = max(b, seam * dash);
    } else {
      b = max(b, box(p, vec4(0.03, 0.015, 0.97, 0.985), w * 0.7));
    }
    outc = mix(outc, vec4(uAccent, 1.0), b * (uRegionTint > 0.0 ? 0.5 : 0.95));
  }
  if (uBoxOn > 0.0) {
    float bb = box(p, uBox, 0.004);
    outc = mix(outc, vec4(uAccent, 1.0), bb * uBoxOn);
  }
  // glass sheet + border
  float bw = 0.0045;
  float edge = (p.x < bw || p.x > 1.0 - bw || p.y < bw * 0.5625 || p.y > 1.0 - bw * 0.5625) ? 1.0 : 0.0;
  vec4 glass = vec4(mix(vec3(0.06, 0.055, 0.06), uAccent, 0.15), uFill);
  vec4 c = vec4(mix(glass.rgb, outc.rgb, outc.a), max(glass.a, outc.a));
  c = mix(c, vec4(uAccent, 1.0), edge * uBorder);
  c.rgb += uAccent * uFlash * 0.25 * c.a;
  gl_FragColor = vec4(c.rgb, c.a * uOpacity * mix(uPeelOp0, 1.0, vPeel));
}
`;

export function makePlateMaterial(tex: THREE.Texture, kind: number) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTex: { value: tex },
      uKind: { value: kind },
      uRegion: { value: new THREE.Vector4(0, 0, 1, 1) },
      uWin: { value: new THREE.Vector4(0, 0, 1, 1) },
      uOpacity: { value: 1 },
      uFill: { value: 0 },
      uBorder: { value: 0 },
      uAccent: { value: new THREE.Color("#ff9a4d") },
      uLayout: { value: 1 },
      uGrade: { value: 0 },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uRemove: { value: 1 },
      uHole: { value: 0 },
      uOutline: { value: 0 },
      uGhost: { value: 0 },
      uBox: { value: new THREE.Vector4(0, 0, 0, 0) },
      uBoxOn: { value: 0 },
      uCut: { value: 0 },
      uPeelOn: { value: 0 },
      uPeel: { value: new THREE.Vector3() },
      uScanY: { value: -1 },
      uPeelOp0: { value: 1 },
      uCtxLift: { value: 0 },
      uEdgeAmt: { value: 1 },
      uGap: { value: 0 },
      uSeamCut: { value: 0 },
      uPal: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Color("#000")) },
      uPalMix: { value: 0.85 },
      uRegionTint: { value: 0 },
    },
  });
}
