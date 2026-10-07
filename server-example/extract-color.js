// 서버(Node.js)에서 상품 이미지 → 카드 색 계산 예시
// 관리자에서 이미지를 등록할 때 한 번 실행해서, 결과를 상품 데이터에 저장하는 용도예요.
//
//   npm install
//   node extract-color.js ./sample.jpg
//
// 결과 예: { cardColor: "#fff4f2", textColor: "#000000", textOpacity: 1, mode: "bg", gradient: { start: 0.45, end: 0.75 } }

const sharp = require("sharp");
const ColorLogic = require("../color-logic.js");

// Figma 플러그인과 같은 설정 파일을 써요.
// 실제 서비스에서는 이 파일을 배포에 포함하거나, 아래 주소에서 받아와 캐시해 두세요.
const CONFIG_URL = "https://raw.githubusercontent.com/jinbytt/Key-Color-Gradient/main/color-config.json";

async function loadConfig() {
  try {
    const res = await fetch(CONFIG_URL);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (e) {
    return require("../color-config.json"); // 네트워크가 안 되면 로컬 파일 사용
  }
}

async function extractCardColor(input, config) {
  const size = ColorLogic.ANALYZE_SIZE;
  const { data, info } = await sharp(input)
    .resize(size, size, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const r = ColorLogic.analyzeRGBA(data, info.width, info.height, config);
  return {
    cardColor: r.cardColor,     // 카드/그라데이션 색
    textColor: r.textColor,     // 글자색
    textOpacity: r.textOpacity, // 글자 불투명도 (검정 글자일 때 0.7~1)
    keyColor: r.keyColor,       // 이미지에서 뽑은 원래 색 (참고용)
    mode: r.mode,               // "bg" = 배경색 기준, "key" = 대표색 기준
    gradient: r.gradient,       // 그라데이션 시작/끝 위치 (0~1)
    logicVersion: r.logicVersion,   // 어떤 로직으로 계산했는지 (같이 저장해 두면 나중에 재계산 대상 찾기 쉬워요)
    configVersion: r.configVersion, // 어떤 설정값으로 계산했는지
  };
}

module.exports = { extractCardColor, loadConfig };

if (require.main === module) {
  (async () => {
    const file = process.argv[2];
    if (!file) return console.log("사용법: node extract-color.js <이미지 파일>");
    console.log(await extractCardColor(file, await loadConfig()));
  })();
}
