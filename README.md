```
          /\_/\
         ( •ㅅ• )   pick a color ~
         /  つ▓▒░

     ╭──────────────────╮
     │                  │
     │                  │
     │░░░░░░░░░░░░░░░░░░│
     │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
     │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
     │██████████████████│
     ╰──────────────────╯
       key color gradient
```

<!--
사용 안내는 아래에 숨겨져 있어요. (GitHub 화면에는 안 보이고, 이 파일을 열면 보여요)

# Key Color Gradient

상품 이미지에서 카드 색과 글자색을 자동으로 뽑는 로직이에요.
**Figma 플러그인(시안)** 과 **개발 서버(실제 서비스)** 가 같은 코드와 같은 설정값을 써서, 시안 색과 서비스 색이 똑같이 나와요.

```
color-config.json      ← 색 규칙 숫자 (여기만 고치면 플러그인·서비스에 같이 반영)
color-logic.js         ← 색 추출·보정 계산 코드 (플러그인·서버 공용)
build.js               ← color-logic.js를 플러그인 ui.html에 넣는 빌드 스크립트
figma-plugin/          ← Figma 플러그인 (manifest.json으로 불러오기)
server-example/        ← 서버(Node.js)에서 쓰는 예시
```

---

## 버전 규칙

버전은 두 가지예요. 플러그인 왼쪽 위에 `로직 v1.0.0 · 설정 2026-10-07.1 · 최신`처럼 표시돼요.

| 무엇을 바꿨나 | 고칠 파일 | 버전 | 플러그인 다시 배포? |
|---|---|---|---|
| 숫자만 (채도, 대비 기준 등) | `color-config.json` | `version`을 올려요 (예: `2026-10-07.1` → `2026-10-07.2`) | 아니요. 다음 실행 때 자동 반영 |
| 계산 방식 (코드) | `color-logic.js` | 파일 안 `VERSION`과 `color-config.json`의 `logicVersion`을 **같이** 올려요 | 네. `node build.js` 후 플러그인 다시 게시 |

플러그인 로직 버전이 레포의 `logicVersion`과 다르면 플러그인에 빨간 글씨로 **"플러그인 업데이트 필요"** 가 떠요.

서버 결과에도 `logicVersion`, `configVersion`이 같이 나와요. 상품 데이터에 같이 저장해 두면 규칙이 바뀌었을 때 어떤 상품을 다시 계산해야 하는지 알 수 있어요.

> GitHub가 파일을 잠깐 캐시해서, 커밋 후 반영까지 최대 5분쯤 걸릴 수 있어요.

---

## color-config.json 항목

| 키 | 기본값 | 뜻 |
|---|---|---|
| `version` | | 설정 버전. 숫자를 바꿀 때마다 올려요 |
| `logicVersion` | `1.0.0` | 이 설정이 맞춰진 로직 버전 |
| `bgMode` | `true` | 배경색이 명확한 이미지는 배경색을 따라가요 |
| `bgThreshold` | `0.7` | 가장자리 픽셀의 이 비율 이상이 한 색이면 배경색으로 봐요 |
| `tint` | `0.02` | 배경색 모드에서 올리는 채도. 흰 배경이면 그림의 대표 색 쪽으로 물들여요 |
| `minL` / `maxL` | `0.4` / `0.88` | 대표색 모드에서 카드 밝기 범위 (OKLCH L) |
| `maxC` | `0.2` | 카드 색 채도 상한 (OKLCH C) |
| `vivid` | `0.5` | 대표색 고를 때 "면적"보다 "선명함"을 얼마나 중요하게 볼지 (0~1) |
| `textLight` | `#ffffff` | 밝은 글자색 |
| `whiteMin` | `4` | 밝은 글자로 대비가 이 값 이상이면 밝은 글자를 써요 |
| `textDark` | `#000000` | 어두운 글자색 |
| `solidBlackL` | `0.9` | 카드 밝기가 이 값 이상(흰색 계열)이면 어두운 글자 100% |
| `darkTarget` | `4.5` | 중간 톤에서 어두운 글자가 맞출 목표 대비 |
| `darkMinAlpha` | `0.7` | 어두운 글자의 최소 불투명도 |
| `start` / `end` | `0.45` / `0.75` | 그라데이션 시작·끝 위치 (카드 위 0 → 아래 1) |

### 글자색 규칙
1. 밝은 글자로 대비가 `whiteMin` 이상 → 밝은 글자
2. 카드가 흰색 계열(밝기 ≥ `solidBlackL`) → 어두운 글자 100%
3. 그 외 중간 톤 → 어두운 글자 + 투명도. `darkTarget` 대비를 맞추는 가장 낮은 불투명도 (최소 `darkMinAlpha`)

### 카드 색 규칙
1. 이미지 가장자리가 거의 한 색이면 → 그 배경색을 따르고 채도만 살짝 올려요
2. 아니면 → 이미지를 k-means로 묶어서 `면적 × 선명도` 점수가 가장 높은 대표색을 골라요. 밝기·채도를 범위 안으로 보정해요

---

## Figma 플러그인

1. Figma 데스크톱 앱 → 메뉴 → Plugins → Development → **Import plugin from manifest…** → `figma-plugin/manifest.json`
2. 카드 프레임들을 선택하고 실행 → **적용**
3. 카드 안 레이어 이름
   - `image`: 상품 이미지 (없으면 가장 큰 이미지)
   - `gradient-area`: 그라데이션을 칠할 레이어. 이미 있으면 방향·위치·투명도는 그대로 두고 색만 바꿔요
4. "세부 조정"에서 바꾼 값은 시안 확인용이에요. 플러그인을 닫으면 사라지고, 다음 실행 때 다시 GitHub 값을 읽어요.

### 로직 코드를 고쳤을 때
```bash
node build.js        # color-logic.js → figma-plugin/ui.html 에 반영
```
`figma-plugin/ui.html`은 빌드 결과물이라 직접 고치지 말고 `ui.template.html`을 고쳐요.

---

## 개발 서버에서 쓰기

관리자에서 이미지를 등록할 때 **한 번만** 계산해서 상품 데이터에 저장하고, 앱·웹은 저장된 색으로 그리기만 하는 걸 추천해요.

```bash
cd server-example
npm install
node extract-color.js ./sample.jpg
```

```js
{
  cardColor: "#fff4f2",   // 그라데이션·카드 색
  textColor: "#000000",
  textOpacity: 1,
  keyColor: "#ffffff",
  mode: "bg",
  gradient: { start: 0.45, end: 0.75 },
  logicVersion: "1.0.0",
  configVersion: "2026-10-07.1"
}
```

화면에서는 이렇게 그려요.

```css
.card-gradient {
  background: linear-gradient(to bottom,
    rgba(card, 0) calc(var(--start) * 100%),
    rgba(card, 1) calc(var(--end) * 100%));
}
.card-text { color: var(--text-color); opacity: var(--text-opacity); }
```

다른 언어(Java, Kotlin, Python 등) 서버라면 `color-logic.js`를 그대로 옮겨 쓰면 돼요. 계산이 전부 순수 수학이라 옮기기 쉬워요. 이미지를 96px 이하로 줄인 RGBA 픽셀만 넣어 주면 같은 결과가 나와요.
-->
