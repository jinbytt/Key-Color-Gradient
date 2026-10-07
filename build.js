// Figma 플러그인 빌드: color-logic.js를 ui.html 안에 넣어요.
// (Figma 플러그인 UI는 파일 하나여야 해서, 공용 로직을 복사해 넣는 방식이에요)
// 사용법: node build.js
const fs = require("fs");
const path = require("path");

const logic = fs.readFileSync(path.join(__dirname, "color-logic.js"), "utf8");
const tplPath = path.join(__dirname, "figma-plugin", "ui.template.html");
const outPath = path.join(__dirname, "figma-plugin", "ui.html");
const tpl = fs.readFileSync(tplPath, "utf8");

if (!tpl.includes("/*__COLOR_LOGIC__*/")) throw new Error("ui.template.html에 /*__COLOR_LOGIC__*/ 자리가 없어요");
fs.writeFileSync(outPath, tpl.replace("/*__COLOR_LOGIC__*/", () => logic));
console.log("✓ figma-plugin/ui.html 생성 완료");
