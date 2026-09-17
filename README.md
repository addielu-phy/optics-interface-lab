# 光的界面實驗室

給高中物理課堂使用的互動式折射與全反射模擬。學生可以先操作單一界面，再以七層介質形成六個平行界面，逐層觀察反射、折射、臨界狀態與全反射。

**公開網頁：** https://addielu-phy.github.io/optics-interface-lab/

**筆電・平板左右並列版：** https://addielu-phy.github.io/optics-interface-lab/wide/

## 教學功能

- 入射角可在 `0°–89.5°` 之間連續調整，也可直接拖曳圖中的光源。
- 內建空氣、水、冰、壓克力、玻璃、光纖核心／包層與鑽石，亦可自訂 `1.000–3.000` 的折射率。
- 即時顯示折射角、臨界角、偏折方向及未偏振光的 Fresnel 反射／穿透比例。
- 提供「水中看天空、光纖轉彎、吸管錯位、鑽石閃耀」情境預設。
- 內建六界面／七介質互動光路：入射角可在 `0°–75°` 之間調整，七個折射率皆可自訂為 `1.000–3.000`。
- 逐界面列出入射角、折射角、現象及相對最初入射光的反射／向下穿透能量；全反射後的下方界面會明確標為「未抵達」。
- 使用跨層不變量 `K = n sin θ`，確保所有平行界面的角度互相一致，而非把每個界面視為彼此無關。
- 鍵盤、觸控與滑鼠皆可操作；支援行動裝置與 reduced-motion 偏好。
- 獨立的筆電／平板版固定保留控制台與光路圖左右並列，並可直接按住入射光線或光源拖曳角度；箭頭採固定尺寸，不會再隨線寬放大。

## 科學模型

使用斯涅耳定律：

```text
n₁ sin θ₁ = n₂ sin θ₂
```

當 `n₁ > n₂` 時，臨界角為：

```text
θc = sin⁻¹(n₂ / n₁)
```

只有 `n₁ > n₂` 且 `θ₁ > θc` 才會全反射；`θ₁ = θc` 時折射光沿界面前進。對多個互相平行的界面，`K = n sin θ` 在光真正穿越的各層保持不變，因此後續界面的可達入射角還會受先前最低折射率限制。能量比例使用無吸收介質、未偏振光的 Fresnel 方程。

模型假設平坦且互相平行的界面、均勻且各向同性的透明介質與單色窄光束，忽略吸收、散射、表面粗糙與色散。六界面圖沿向下主光線逐層追蹤；各界面的第一代反射支線角度與能量均按物理模型計算，但不再展開支線後續可能產生的無限多重反射。

## 本機執行

需要 Node.js 20 以上：

```bash
npm install
npm run serve
```

瀏覽 `http://127.0.0.1:4173`。

## 驗證

```bash
npm test
npm run qa
npm run qa:wide
npm run verify
```

瀏覽器 QA 會檢查五個精確視窗寬度、水平溢位、觸控目標、SVG 教學文字、WCAG A/AA、實際拖曳與控制流程、無效輸入保留最後有效狀態，以及瀏覽器錯誤。Windows 預設使用已安裝的 Microsoft Edge；其他平台可先執行：

```bash
npx playwright install chromium
```

或設定 `BROWSER_PATH` 指向 Chromium 類瀏覽器。公開網址驗證可使用：

```bash
BASE_URL=https://addielu-phy.github.io/optics-interface-lab \
EXPECTED_URL=https://addielu-phy.github.io/optics-interface-lab \
npm run qa
```

## 授權

MIT License
