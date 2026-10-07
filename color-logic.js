/*!
 * color-logic.js — 이미지에서 카드 색과 글자색을 뽑는 공용 로직
 * Figma 플러그인과 개발 서버가 이 파일 하나를 같이 써요. (환경 의존 코드 없음)
 *
 * 사용법
 *   const pixels = ColorLogic.pixelsFromRGBA(rgbaArray, width, height); // 96px 이하로 줄인 RGBA
 *   const pre    = ColorLogic.precompute(pixels);                       // 무거운 계산 (한 번만)
 *   const result = ColorLogic.compute(pre, config);                     // 가벼운 계산 (설정 바뀔 때마다)
 *   // 또는 한 번에: ColorLogic.analyzeRGBA(rgbaArray, width, height, config)
 *
 * result = { cardColor: "#fff4f2", textColor: "#000000", textOpacity: 1, keyColor: "#ffffff",
 *            mode: "bg" | "key", gradient: { start: 0.45, end: 0.75 }, ...rgb 값 }
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ColorLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

// 로직(계산 방식) 버전. color-logic.js 코드를 고칠 때마다 올려요.
// color-config.json의 logicVersion과 같아야 해요.
const VERSION = "1.0.0";

// 설정 기본값. 실제 값은 color-config.json에서 읽어 와서 덮어써요.
const DEFAULT_CONFIG = {
  bgMode: true, bgThreshold: 0.7, tint: 0.02,
  minL: 0.4, maxL: 0.88, maxC: 0.2, vivid: 0.5,
  textLight: "#ffffff", whiteMin: 4,
  textDark: "#000000", darkTarget: 4.5, solidBlackL: 0.9, darkMinAlpha: 0.7,
  start: 0.45, end: 0.75,
};
const ANALYZE_SIZE = 96; // 분석 전에 이미지를 이 크기 이하로 줄여요

// ================= Color math (sRGB ↔ OKLab/OKLCH) =================
const toLin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toGam = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

function rgbToOklab(r, g, b) {
  r = toLin(r); g = toLin(g); b = toLin(b);
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [
    0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
    1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
    0.0259040371*l + 0.7827717662*m - 0.8086757660*s,
  ];
}
function oklabToLinear(L, a, b) {
  const l = Math.pow(L + 0.3963377774*a + 0.2158037573*b, 3);
  const m = Math.pow(L - 0.1055613458*a - 0.0638541728*b, 3);
  const s = Math.pow(L - 0.0894841775*a - 1.2914855480*b, 3);
  return [
    4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
   -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
   -0.0041960863*l - 0.7034186147*m + 1.7076147010*s,
  ];
}
const inGamut = lin => lin.every(v => v >= -1e-4 && v <= 1 + 1e-4);

// OKLCH → sRGB, 범위를 벗어나면 채도를 줄여서 맞춘다
function lchToRgb(L, C, h) {
  let c = C;
  for (let i = 0; i < 40; i++) {
    const lin = oklabToLinear(L, c * Math.cos(h), c * Math.sin(h));
    if (inGamut(lin) || c < 1e-4) {
      const [r, g, b] = lin.map(v => toGam(Math.min(1, Math.max(0, v))));
      return { r, g, b };
    }
    c *= 0.92;
  }
  return { r: L, g: L, b: L };
}

const luminance = ({ r, g, b }) => 0.2126*toLin(r) + 0.7152*toLin(g) + 0.0722*toLin(b);
const contrast = (c1, c2) => {
  const a = luminance(c1), b = luminance(c2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const hexToRgb = h => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 };
};
const textColors = s => ({
  dark: hexToRgb(s.textDark) || { r: 0.098, g: 0.122, b: 0.157 },
  light: hexToRgb(s.textLight) || { r: 1, g: 1, b: 1 },
});


// ================= 1) RGBA 픽셀 → OKLab 점들 =================
function pixelsFromRGBA(data, w, h) {
  const pts = [], edge = [];
  const band = 2; // 가장자리 2px을 배경 후보로 본다
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // 투명 픽셀 제외
    const p = rgbToOklab(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    pts.push(p);
    const x = (i / 4) % w, y = Math.floor(i / 4 / w);
    if (x < band || y < band || x >= w - band || y >= h - band) edge.push(p);
  }
  if (pts.length < 10) throw new Error("이미지 픽셀이 너무 적어요");
  return { pts, edge };
}

// ================= 2) 색 묶기 (설정과 무관해서 미리 계산해 둔다) =================
function precompute({ pts, edge }) {
  const clusters = kmeans(pts, Math.min(6, pts.length), 12);
  let bg = null;
  if (edge.length >= 20) {
    const ec = kmeans(edge, Math.min(3, edge.length), 8).sort((x, y) => y.count - x.count);
    const c = ec[0].center;
    const tol = 0.04; // OKLab 거리. 이 안이면 같은 배경색으로 친다
    const near = edge.filter(p => Math.hypot(p[0]-c[0], p[1]-c[1], p[2]-c[2]) < tol).length;
    bg = { center: c, share: near / edge.length };
  }
  return { clusters, total: pts.length, bg };
}

// 시드 고정 k-means++ (같은 이미지 → 항상 같은 결과)
function kmeans(pts, k, iters) {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const d2 = (p, q) => { const x = p[0]-q[0], y = p[1]-q[1], z = p[2]-q[2]; return x*x + y*y + z*z; };

  const centers = [pts[Math.floor(rand() * pts.length)].slice()];
  while (centers.length < k) {
    const dist = pts.map(p => Math.min(...centers.map(c => d2(p, c))));
    const sum = dist.reduce((a, b) => a + b, 0);
    let r = rand() * sum, i = 0;
    while (i < pts.length - 1 && (r -= dist[i]) > 0) i++;
    centers.push(pts[i].slice());
  }

  let counts = [];
  for (let it = 0; it < iters; it++) {
    const acc = centers.map(() => [0, 0, 0]);
    counts = centers.map(() => 0);
    for (const p of pts) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < centers.length; j++) { const d = d2(p, centers[j]); if (d < bd) { bd = d; bi = j; } }
      acc[bi][0] += p[0]; acc[bi][1] += p[1]; acc[bi][2] += p[2]; counts[bi]++;
    }
    centers.forEach((c, j) => { if (counts[j]) for (let x = 0; x < 3; x++) c[x] = acc[j][x] / counts[j]; });
  }
  return centers.map((c, j) => ({ center: c, count: counts[j] }));
}

// ================= 3) 설정 적용 (가벼워서 슬라이더 움직일 때마다 실행) =================
function pickKey(pre, s) {
  let best = null;
  for (const cl of pre.clusters) {
    if (!cl.count) continue;
    const [L, a, b] = cl.center;
    const C = Math.hypot(a, b);
    let score = (cl.count / pre.total) * ((1 - s.vivid) + s.vivid * Math.min(C / 0.12, 1));
    if (L > 0.96 || L < 0.12) score *= 0.15; // 순백/순흑 배경은 거의 무시
    if (!best || score > best.score) best = { score, center: cl.center };
  }
  return best.center;
}

// A) 일반 이미지: key color를 밝기·채도 범위 안으로 보정
function correct([L0, a, b], s) {
  const h = Math.atan2(b, a);
  let C = Math.min(Math.hypot(a, b) * 0.9, s.maxC);  // 채도 살짝 낮추고 상한
  if (C < 0.012) C = 0;                              // 거의 무채색이면 깔끔하게 무채색
  const L = Math.min(s.maxL, Math.max(s.minL, L0));  // 밝기 범위 고정
  return fitText(L, C, h, s);
}

// B) 배경색이 명확한 이미지: 배경색을 따르되 채도를 살짝 올린다 (밝기 범위 고정은 안 함)
//    흰색·회색처럼 색이 없는 배경이면 그림의 key color 색상(hue)을 빌려 온다
function correctBackground(bg, key, s) {
  const bgC = Math.hypot(bg[1], bg[2]);
  const h = bgC >= 0.015 ? Math.atan2(bg[2], bg[1]) : Math.atan2(key[2], key[1]);
  const C = Math.min(bgC + s.tint, s.maxC);
  const L = Math.min(bg[0], 0.975); // 순백에서는 채도가 안 올라가서 아주 살짝만 낮춘다
  return fitText(L, C, h, s);
}

// 텍스트(검정 or 흰색) 중 더 잘 읽히는 쪽을 고르고, 4.5:1이 안 되면 밝기를 민다
// 글자색 규칙
//  1) 밝은 글자(흰색)로 대비가 기준(기본 4:1) 이상이면 → 흰색
//  2) 흰색에 가까운 밝은 카드(밝기 L ≥ 기준) → 검정 100%
//  3) 그 외 중간 톤 → 검정 + 투명도. 목표 대비를 맞추는 가장 낮은 불투명도를 쓴다 (밝은 카드일수록 더 투명하게)
//  4) 검정 100%로도 목표 대비가 안 나오면 카드 밝기를 올려서 맞춘다
const blend = (bg, fg, a) => ({ r: bg.r*(1-a) + fg.r*a, g: bg.g*(1-a) + fg.g*a, b: bg.b*(1-a) + fg.b*a });

function fitText(L, C, h, s) {
  const { dark: DARK, light: WHITE } = textColors(s);
  let rgb = lchToRgb(L, C, h);
  if (contrast(rgb, WHITE) >= s.whiteMin) return { corrected: rgb, text: WHITE, textAlpha: 1, L, C };
  if (L >= s.solidBlackL) return { corrected: rgb, text: DARK, textAlpha: 1, L, C };

  for (let i = 0; i < 60; i++) {
    for (let a = s.darkMinAlpha; a <= 1.0001; a += 0.01) {
      if (contrast(rgb, blend(rgb, DARK, a)) >= s.darkTarget) {
        return { corrected: rgb, text: DARK, textAlpha: Math.round(a * 100) / 100, L, C };
      }
    }
    if (L >= 0.98) break;
    L += 0.01;
    rgb = lchToRgb(L, C, h);
  }
  return { corrected: rgb, text: DARK, textAlpha: 1, L, C };
}

function compute(pre, s) {
  const key = pickKey(pre, s);
  const useBg = s.bgMode && pre.bg && pre.bg.share >= s.bgThreshold;
  const src = useBg ? pre.bg.center : key;
  const keyRgb = lchToRgb(src[0], Math.hypot(src[1], src[2]), Math.atan2(src[2], src[1]));
  const c = useBg ? correctBackground(src, key, s) : correct(src, s);
  return { key: keyRgb, corrected: c.corrected, text: c.text, textAlpha: c.textAlpha, L: c.L, C: c.C, mode: useBg ? "bg" : "key" };
}

const hex = ({ r, g, b }) => "#" + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

// 결과를 서비스에서 쓰기 좋은 형태로 정리
function format(r, cfg) {
  return Object.assign({}, r, {
    cardColor: hex(r.corrected),
    textColor: hex(r.text),
    textOpacity: r.textAlpha,
    keyColor: hex(r.key),
    gradient: { start: cfg.start, end: cfg.end },
    logicVersion: VERSION,
    configVersion: cfg.version || null,
  });
}

function withDefaults(cfg) { return Object.assign({}, DEFAULT_CONFIG, cfg || {}); }

function analyzeRGBA(data, w, h, cfg) {
  const c = withDefaults(cfg);
  return format(compute(precompute(pixelsFromRGBA(data, w, h)), c), c);
}

return {
  VERSION, DEFAULT_CONFIG, ANALYZE_SIZE, withDefaults,
  pixelsFromRGBA, precompute,
  compute: (pre, cfg) => { const c = withDefaults(cfg); return format(compute(pre, c), c); },
  analyzeRGBA,
  // 미리보기 등에서 쓰는 보조 함수
  hex, hexToRgb, contrast, rgbToOklab, lchToRgb,
};
});
