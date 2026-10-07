// Key Color Gradient — Figma plugin main thread
// 선택한 카드들의 이미지에서 key color를 뽑고(UI iframe에서 계산), 보정한 색을 그라데이션 레이어에 칠한다.

figma.showUI(__html__, { width: 780, height: 600, themeColors: false });

const PREVIEW_LIMIT = 12;
let namesForPreview = { imageName: "image", gradientName: "gradient-area" };
const STORAGE_KEY = "settings-v4";
// 이 컴퓨터에 저장하는 값은 레이어 이름·체크박스뿐이에요.
// 색 규칙 숫자는 저장하지 않고 매번 GitHub의 color-config.json에서 읽어 와요.
const LOCAL_KEYS = ["imageName", "gradientName", "createIfMissing", "paintBg", "paintText"];
const pick = (o, keys) => keys.reduce((a, k) => { if (o[k] !== undefined) a[k] = o[k]; return a; }, {});
let previewToken = 0;

const DEFAULTS = {
  imageName: "image",
  gradientName: "gradient-area",
  minL: 0.4,
  maxL: 0.88,
  maxC: 0.2,
  vivid: 0.5,
  bgMode: true,
  bgThreshold: 0.7,
  tint: 0.02,
  start: 0.45,
  end: 0.75,
  createIfMissing: true,
  paintBg: false,
  paintText: false,
  textDark: "#000000",
  whiteMin: 4,
  darkTarget: 4.5,
  darkMinAlpha: 0.7,
  solidBlackL: 0.9,
  textLight: "#ffffff",
};

const pending = {};

// ---------- helpers ----------
function hasImageFill(n) {
  return (
    "fills" in n &&
    Array.isArray(n.fills) &&
    n.fills.some((f) => f.type === "IMAGE" && f.visible !== false && f.imageHash)
  );
}

function imageHashOf(n) {
  const f = n.fills.find((f) => f.type === "IMAGE" && f.visible !== false && f.imageHash);
  return f ? f.imageHash : null;
}

function getCards() {
  const seen = {};
  const out = [];
  for (const n of figma.currentPage.selection) {
    let card = n;
    // 이미지 레이어 자체를 선택했다면 부모를 카드로 본다
    if (!("children" in n) && n.parent && n.parent.type !== "PAGE" && n.parent.type !== "SECTION") {
      card = n.parent;
    }
    if (!seen[card.id]) {
      seen[card.id] = true;
      out.push(card);
    }
  }
  return out;
}

function findImageNode(card, name) {
  if (!("findAll" in card)) return hasImageFill(card) ? card : null;
  const byName = card.findOne((n) => n.name === name && hasImageFill(n));
  if (byName) return byName;
  const all = card.findAll(hasImageFill);
  if (hasImageFill(card)) all.push(card);
  if (!all.length) return null;
  all.sort((a, b) => b.width * b.height - a.width * a.height); // 가장 큰 이미지
  return all[0];
}

function findGradientNode(card, name) {
  if (!("findOne" in card)) return null;
  return card.findOne((n) => n.name === name && "fills" in n);
}

function linearGradient(rgb, start, end) {
  return {
    type: "GRADIENT_LINEAR",
    // 위 → 아래 방향
    gradientTransform: [
      [0, 1, 0],
      [-1, 0, 1],
    ],
    gradientStops: [
      { position: 0, color: { r: rgb.r, g: rgb.g, b: rgb.b, a: 0 } },
      { position: start, color: { r: rgb.r, g: rgb.g, b: rgb.b, a: 0 } },
      { position: end, color: { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 } },
      { position: 1, color: { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 } },
    ],
  };
}

function recolorFills(fills, rgb, s) {
  const hasGradient = fills.some((f) => f.type.indexOf("GRADIENT") === 0);
  if (!hasGradient) return [linearGradient(rgb, s.start, s.end)];
  // 디자이너가 만든 그라데이션의 방향·위치·투명도는 유지하고 색만 바꾼다
  return fills.map((f) => {
    if (f.type.indexOf("GRADIENT") !== 0) return f;
    const copy = JSON.parse(JSON.stringify(f));
    copy.gradientStops = copy.gradientStops.map((st) => ({
      position: st.position,
      color: { r: rgb.r, g: rgb.g, b: rgb.b, a: st.color.a },
    }));
    return copy;
  });
}

async function paintTexts(card, rgb, alpha) {
  if (!("findAll" in card)) return;
  const texts = card.findAll((n) => n.type === "TEXT");
  for (const t of texts) {
    if (t.hasMissingFont) continue;
    const fonts = t.characters.length ? t.getRangeAllFontNames(0, t.characters.length) : [];
    await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
    // 흰 글자면 100%, 검정이면 규칙에서 정한 투명도로 칠한다
    t.fills = [{ type: "SOLID", color: rgb, opacity: alpha == null ? 1 : alpha }];
  }
}

function analyzeInUI(id, hash, bytes, settings) {
  return new Promise((resolve) => {
    pending[id] = resolve;
    figma.ui.postMessage({ type: "analyze", id, hash, bytes, settings });
  });
}

// ---------- apply one card ----------
async function processCard(card, s) {
  const imgNode = findImageNode(card, s.imageName);
  if (!imgNode) return { id: card.id, name: card.name, error: "이미지 레이어를 못 찾았어요" };

  const hash = imageHashOf(imgNode);
  const bytes = await figma.getImageByHash(hash).getBytesAsync();
  const res = await analyzeInUI(card.id, hash, bytes, s);
  if (res.error) return { id: card.id, name: card.name, error: res.error };

  const color = res.corrected;
  let grad = findGradientNode(card, s.gradientName);

  if (!grad) {
    if (!s.createIfMissing) {
      return { id: card.id, name: card.name, error: `'${s.gradientName}' 레이어가 없어요` };
    }
    const parent = imgNode === card ? card.parent : imgNode.parent;
    if (!parent || parent.type === "INSTANCE" || !("insertChild" in parent) || isInsideInstance(parent)) {
      return { id: card.id, name: card.name, error: "인스턴스 안에는 레이어를 새로 만들 수 없어요. 컴포넌트에 gradient 레이어를 추가해 주세요" };
    }
    grad = figma.createRectangle();
    grad.name = s.gradientName;
    const idx = parent.children.indexOf(imgNode);
    parent.insertChild(idx >= 0 ? idx + 1 : parent.children.length, grad);
    const frameLike = parent.type === "FRAME" || parent.type === "COMPONENT";
    if (frameLike && parent === card) {
      grad.x = 0;
      grad.y = 0;
      grad.resize(card.width, card.height);
    } else {
      grad.x = imgNode.x;
      grad.y = imgNode.y;
      grad.resize(imgNode.width, imgNode.height);
    }
    if (frameLike) grad.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
    grad.fills = [linearGradient(color, s.start, s.end)];
  } else {
    grad.fills = recolorFills(grad.fills, color, s);
  }

  if (s.paintBg && card !== imgNode && "fills" in card) {
    card.fills = [{ type: "SOLID", color }];
  }
  if (s.paintText) await paintTexts(card, res.text, res.textAlpha);

  card.setPluginData("keyColor", JSON.stringify(res));
  return { id: card.id, name: card.name, key: res.key, corrected: color, text: res.text, mode: res.mode };
}

function isInsideInstance(node) {
  let p = node;
  while (p) {
    if (p.type === "INSTANCE") return true;
    p = p.parent;
  }
  return false;
}

// ---------- messaging ----------
function sendSelection() {
  figma.ui.postMessage({ type: "selection", count: getCards().length });
  sendPreview();
}

// 선택한 카드들을 UI로 보내서 실시간 미리보기를 그리게 한다
async function sendPreview(keepStatus) {
  const token = ++previewToken;
  const all = getCards();
  const cards = [];
  for (const card of all.slice(0, PREVIEW_LIMIT)) {
    let item;
    try {
      item = await buildPreview(card);
    } catch (e) {
      item = { id: card.id, name: card.name, error: String(e && e.message ? e.message : e) };
    }
    if (token !== previewToken) return; // 그 사이 선택이 바뀌었으면 버린다
    cards.push(item);
  }
  figma.ui.postMessage({ type: "preview", cards, total: all.length, keepStatus: !!keepStatus });
}

// 카드를 "그라데이션 아래 레이어들 / 그라데이션 영역 / 그라데이션 위 레이어들(텍스트 등)"로 나눠서 내보낸다
async function buildPreview(card) {
  const item = { id: card.id, name: card.name, w: card.width, h: card.height };
  const imgNode = findImageNode(card, namesForPreview.imageName);
  if (!imgNode) return Object.assign(item, { error: "이미지 레이어를 못 찾았어요" });
  item.hash = imageHashOf(imgNode);
  item.bytes = await figma.getImageByHash(item.hash).getBytesAsync();

  const box = card.absoluteBoundingBox;
  if (!box || !("children" in card)) return item; // 레이어 구조가 없으면 원본 이미지만 보여준다

  const grad = findGradientNode(card, namesForPreview.gradientName);
  const pivot = grad || imgNode; // 그라데이션 레이어가 없으면 이미지 바로 위에 생긴다
  const below = [], above = [];
  let passed = false;
  (function walk(node) {
    for (const child of node.children) {
      if (child === pivot) {
        if (pivot !== grad) below.push(child);
        passed = true;
      } else if ("findOne" in child && child.findOne((n) => n === pivot)) {
        walk(child); // pivot을 품고 있는 그룹은 한 겹 더 들어간다
      } else {
        (passed ? above : below).push(child);
      }
    }
  })(card);

  const scale = Math.min(2, 360 / Math.max(card.width, card.height, 1));
  const rel = (b) => ({ x: (b.x - box.x) / box.width, y: (b.y - box.y) / box.height, w: b.width / box.width, h: b.height / box.height });
  async function exportAll(nodes) {
    const out = [];
    for (const n of nodes) {
      if (!n.visible) continue;
      const rb = n.absoluteRenderBounds;
      if (!rb || !rb.width || !rb.height) continue;
      try {
        const png = await n.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } });
        out.push(Object.assign({ png, isText: n.type === "TEXT" }, rel(rb)));
      } catch (e) { /* 내보내기 실패한 레이어는 미리보기에서만 생략 */ }
    }
    return out;
  }
  item.below = await exportAll(below);
  item.above = await exportAll(above);
  item.imageIsCard = imgNode === card;

  if (card !== imgNode && "fills" in card && Array.isArray(card.fills)) {
    const solid = card.fills.find((f) => f.type === "SOLID" && f.visible !== false);
    if (solid) item.bgColor = solid.color;
  }

  // 그라데이션 영역 (없으면 새로 만들 때 생길 위치)
  if (grad && grad.absoluteBoundingBox) {
    item.area = rel(grad.absoluteBoundingBox);
    const gf = Array.isArray(grad.fills) && grad.fills.find((f) => f.type.indexOf("GRADIENT") === 0 && f.visible !== false);
    if (gf) {
      item.area.stops = gf.gradientStops.map((st) => ({ position: st.position, a: st.color.a * (gf.opacity == null ? 1 : gf.opacity) }));
      item.area.angle = gf.type === "GRADIENT_LINEAR" ? cssAngle(gf.gradientTransform, grad.width, grad.height) : 180;
    }
    item.areaExists = true;
  } else {
    const parent = imgNode.parent;
    const frameLike = parent && (parent.type === "FRAME" || parent.type === "COMPONENT");
    item.area = frameLike && parent === card ? { x: 0, y: 0, w: 1, h: 1 } : rel(imgNode.absoluteBoundingBox || box);
    item.areaExists = false;
  }
  return item;
}

// Figma gradientTransform → CSS linear-gradient 각도
function cssAngle(t, w, h) {
  const a = t[0][0], b = t[0][1], c = t[0][2], d = t[1][0], e = t[1][1], f = t[1][2];
  const det = a * e - b * d;
  if (!det) return 180;
  const P = (gx, gy) => ({ x: (e * (gx - c) - b * (gy - f)) / det, y: (a * (gy - f) - d * (gx - c)) / det });
  const s0 = P(0, 0.5), s1 = P(1, 0.5);
  return (Math.atan2((s1.x - s0.x) * w, -(s1.y - s0.y) * h) * 180) / Math.PI;
}

figma.on("selectionchange", sendSelection);

figma.ui.onmessage = async (msg) => {
  if (msg.type === "ready") {
    const saved = (await figma.clientStorage.getAsync(STORAGE_KEY)) || {};
    figma.ui.postMessage({ type: "settings", settings: Object.assign(pick(DEFAULTS, LOCAL_KEYS), pick(saved, LOCAL_KEYS)) });
    namesForPreview = {
      imageName: saved.imageName || DEFAULTS.imageName,
      gradientName: saved.gradientName || DEFAULTS.gradientName,
    };
    sendSelection();
  }

  if (msg.type === "reset") {
    await figma.clientStorage.setAsync(STORAGE_KEY, {});
    figma.ui.postMessage({ type: "settings", settings: Object.assign({}, DEFAULTS) });
    namesForPreview = { imageName: DEFAULTS.imageName, gradientName: DEFAULTS.gradientName };
    sendPreview();
  }

  if (msg.type === "names") {
    namesForPreview = {
      imageName: msg.imageName || DEFAULTS.imageName,
      gradientName: msg.gradientName || DEFAULTS.gradientName,
    };
    sendPreview();
  }

  if (msg.type === "analyzed") {
    const r = pending[msg.id];
    if (r) {
      delete pending[msg.id];
      r(msg.result);
    }
  }

  if (msg.type === "apply") {
    const s = Object.assign({}, DEFAULTS, msg.settings);
    await figma.clientStorage.setAsync(STORAGE_KEY, pick(s, LOCAL_KEYS));
    const cards = getCards();
    if (!cards.length) {
      figma.notify("카드(프레임)를 먼저 선택해 주세요");
      return;
    }
    const results = [];
    for (let i = 0; i < cards.length; i++) {
      figma.ui.postMessage({ type: "progress", done: i, total: cards.length });
      try {
        results.push(await processCard(cards[i], s));
      } catch (e) {
        results.push({ id: cards[i].id, name: cards[i].name, error: String(e && e.message ? e.message : e) });
      }
    }
    figma.commitUndo();
    const ok = results.filter((r) => !r.error).length;
    figma.notify(`${ok}/${cards.length}개 카드에 색을 적용했어요`);
    figma.ui.postMessage({ type: "results", results });
    namesForPreview = { imageName: s.imageName, gradientName: s.gradientName };
    sendPreview(true); // 텍스트/배경 색이 바뀌었을 수 있어서 미리보기를 새로 그린다
  }

  if (msg.type === "focus") {
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node) figma.viewport.scrollAndZoomIntoView([node]); // 선택은 그대로 두고 화면만 이동
  }
};
