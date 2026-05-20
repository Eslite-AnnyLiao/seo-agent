# SEO Agent

Eslite 誠品線上 Astro 商品頁 SEO 每日自動化維運工具。

## 功能

- 執行 daily pipeline 下載 SSR / Combined 數據
- 上傳 JSON 至 Google Drive
- 觸發 Google Sheets GAS 更新
- 產出每日分析報告（Markdown 檔案 + Google Chat 通知）
- 支援查詢模式：問問題取得數據分析

---

## 使用方式

```bash
# 每日更新（下載 → 上傳 → GAS → 分析報告）
pnpm run daily

# 查詢問題（需加引號）
pnpm run query "昨天 SSR P95 是多少？"
pnpm run query "比較 5/18 和 5/19 的慢渲染率"
```

---

## 檔案說明

| 檔案 | 說明 |
|------|------|
| `daily-update.js` | 每日固定流程 + AI 分析報告 |
| `seo-agent.js` | Query 模式（問問題） |
| `tools.js` | 工具定義與執行邏輯 |
| `config.js` | 設定（路徑、Sheet ID、Webhook URL、規則） |
| `prompts.js` | 所有 Claude prompt 組裝，背景知識與規則有變更時只需修改此檔 |
| `gas-webhook.gs` | 貼到 Google Apps Script 編輯器的腳本 |

---

## 初次設定

### 1. 安裝依賴

```bash
pnpm install
```

### 2. 建立 `.env`

```
ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Google 認證

```bash
gcloud auth login --enable-gdrive-access
```

### 4. 設定 `config.js`

填入以下資訊：

```js
// Google Drive 上傳目的地
driveFolderIds: {
  ssr:      'SSR 資料夾 ID',
  combined: 'Combined 資料夾 ID',
},

// Google Sheets
sheets: {
  ssr: {
    spreadsheetId: 'Sheet ID',
    gasWebhookUrl: 'GAS Webhook URL',
  },
  combined: {
    spreadsheetId: 'Sheet ID',
    gasWebhookUrl: 'GAS Webhook URL',
  },
},

// Google Chat（選填，留空不發送）
googleChatWebhookUrl: '',
```

### 5. 部署 GAS

1. 打開 Google Sheets → Apps Script
2. 貼上 `gas-webhook.gs` 內容（SSR 和 Combined 各自部署）
3. 部署為「網路應用程式」→ 複製 Webhook URL 填入 `config.js`

---

## 報告輸出

```
analysis-log/
└── reports/
    ├── daily/
    │   └── daily-YYYYMMDD.md     每日自動產出，不發 Google Chat
    └── weekly/
        └── weekly-YYYYMMDD.md    週五自動產出並發送至 Google Chat
```

### 週報說明

- **執行時機**：每週五 `pnpm run daily` 時自動觸發
- **涵蓋範圍**：上週五到本週四（7 天）
- **發送對象**：Google Chat（`config.js` → `googleChatWebhookUrl`）
- **對齊 PD 節奏**：PD 每週四更新 GSC 等 SEO 數據，週五週報可呈現最新完整狀態

---

## 每月更新 Sheet

每月建立新的 Google Sheet 時，只需更新 `config.js` 的 `sheets` 區塊：

```js
sheets: {
  ssr: {
    spreadsheetId: '新的 Sheet ID',   // 更新
    gasWebhookUrl: '新的 Webhook URL', // 更新
  },
  combined: {
    spreadsheetId: '新的 Sheet ID',   // 更新
    gasWebhookUrl: '新的 Webhook URL', // 更新
  },
},
```

同時需在新 Sheet 重新部署 GAS 腳本。

---

## 異常告警規則

| 指標 | 門檻 | 等級 |
|------|------|------|
| SSR P95 | > 3,000ms | ⚠️ 警告 |
| SSR P99 | > 5,000ms | ⚠️ 警告 |
| 異常渲染率（≥5秒） | > 1% | 🚨 異常 |
| 慢渲染率（3-5秒） | > 3% | ⚠️ 警告 |

---

## 放量觀察

觀測達標日門檻（同時滿足才計入）：
- 當日請求數 > 30,000
- 當日尖峰 RPM > 100

放量階段與 GUID 尾兩位範圍見 `config.js` → `rules.rollout`。

---

## 背景說明

- SSR 服務只有爬蟲（Googlebot）進入，不影響使用者體驗，但影響 SEO 品質
- 渲染架構使用 Cloudflare Worker，效能問題方向是優化 API 或 cache 策略
- P95/P99 數值只涵蓋 cache miss 的實際渲染請求
- 商品價格與庫存為 client-side 非同步載入，不在 SSR 範疇

---

## Prompt 維護

所有給 Claude 的背景說明、規則、格式指令集中在 `prompts.js`。

需要更新的時機：
- 放量階段升級（P0 → P1...）→ 更新 `config.js` 的 `rules.rollout`
- 異常閾值調整 → 更新 `config.js` 的 `rules.ssr`
- 背景知識有變更（架構調整、新的注意事項）→ 直接修改 `prompts.js`
