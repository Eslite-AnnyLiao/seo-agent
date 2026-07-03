# SEO Agent

Eslite 誠品線上 Astro 商品頁／分類頁 SEO 每日自動化維運工具。下載與分析程式由獨立專案
`astro-log-pipeline` 負責（`.env` 的 `ANALYSIS_LOG_PATH`/`PIPELINE_SCRIPT` 指向該專案），
seo-agent 透過 `config.js` 的 `pageKinds` registry 讀取其產出的 JSON。

目前登記的頁面類型：**商品頁（`product`）**、**分類頁（`category`）**。要加新頁面類型（例如文章頁）
只需要在 `config.js` 的 `pageKinds` 新增一筆設定，`tools.js`/`daily-update.js` 的邏輯本體不用改
（詳見「頁面類型 registry」章節）。

## 功能

- 執行 daily pipeline 下載各頁面類型（商品頁／分類頁）與 Combined 數據
- 上傳 JSON 至 Google Drive
- 觸發 Google Sheets GAS 更新
- 產出每日分析報告（Markdown 檔案）
- 產出週報（Markdown 上傳 Drive + Google Chat 精簡摘要 + 詳細報告連結）
- 支援查詢模式：問問題取得數據分析
- 認證失敗時自動觸發 `gcloud auth login` 重新驗證

---

> **遠端使用請先連 VPN**
> 公司 LiteLLM proxy（`litellm.in.eslite.com`）為內網位址，非公司網路環境下須開啟 VPN 才能正常執行。

---

## 使用方式

```bash
# 每日更新（下載 → 上傳 → GAS → 分析報告）
pnpm daily

# 從上傳 Drive 開始（跳過下載，資料已存在時使用）
pnpm upload

# 只跑每日分析（Step 4，讀本機 JSON）
pnpm analysis

# 手動產出週報（上傳 Drive + 發送 Google Chat）
pnpm weekly

# 查詢問題（需加引號）
pnpm query "昨天 SSR P95 是多少？"
pnpm query "比較 5/18 和 5/19 的慢渲染率"
```

### 指定日期

加上 `--date YYYYMMDD` 可指定要處理的日期，不帶則維持預設邏輯（昨天；週一則補回週五～週日）。

```bash
# 指定日期完整流程（下載 → 上傳 → 分析）
pnpm daily -- --date 20260520

# 指定日期上傳
pnpm upload -- --date 20260520

# 指定日期分析
pnpm analysis -- --date 20260520

# 指定日期查詢
pnpm query -- --date 20260520 "SSR P95 是多少？"

# 一次指定多天
pnpm daily -- --date 20260520 --date 20260521
```

### 假日補跑

遇假日無法執行時，下個工作日補跑步驟如下：

```bash
# 1. 補跑假日前最後一個工作日的資料（例如週四）
pnpm daily -- --date 20260619

# 2. 補產週報，以週五日期為錨點（往前推 7 天）
pnpm weekly -- --date 20260620
```

`pnpm weekly -- --date YYYYMMDD` 會以指定日期為錨點往前推 7 天計算週報涵蓋範圍，不帶 `--date` 則以執行當下為準。

### Claude Code Skill（需安裝 Claude Code）

在 Claude Code 中可直接使用 `/seo-query` 指令查詢，不另外消耗 API 額度：

```
/seo-query 昨天 SSR P95 是多少？
/seo-query 比較 5/18 和 5/19 的慢渲染率
```

> 需在本專案目錄下開啟 Claude Code，且本機已有對應日期的 JSON 檔。

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
ANTHROPIC_AUTH_TOKEN=sk-...
ANTHROPIC_BASE_URL=https://litellm.in.eslite.com
GOOGLE_CHAT_WEBHOOK_URL=https://chat.googleapis.com/...
ANALYSIS_LOG_PATH=/your/path/to/astro-log-pipeline
PIPELINE_SCRIPT=/your/path/to/astro-log-pipeline/bin/daily-pipeline.js
```

> `ANTHROPIC_AUTH_TOKEN`：使用公司 LiteLLM proxy 的個人 API key，請向專案負責人取得。
> `ANTHROPIC_BASE_URL`：公司 LiteLLM proxy 位址，固定為 `https://litellm.in.eslite.com`。
> `GOOGLE_CHAT_WEBHOOK_URL`：請向專案負責人取得。
> `ANALYSIS_LOG_PATH` / `PIPELINE_SCRIPT`：指向 `astro-log-pipeline` 專案的目錄與 `bin/daily-pipeline.js`。

### 3. Google 認證

```bash
gcloud auth login --enable-gdrive-access
```

### 4. 設定 `config.js`

每個頁面類型（`pageKinds.product`、`pageKinds.category`...）與 `combined` 各自的 Drive 資料夾／Sheet 都填在對應區塊：

```js
pageKinds: {
  product: {
    driveFolderId:    '商品頁 Drive 資料夾 ID',
    seoAgentFolderId: '商品頁 seo-agent 固定資料夾 ID',
    sheet: { spreadsheetId: 'Sheet ID', gasWebhookUrl: 'GAS Webhook URL' },
    // ...
  },
  category: {
    driveFolderId:    '分類頁 Drive 資料夾 ID',
    seoAgentFolderId: '分類頁 seo-agent 固定資料夾 ID',
    sheet: { spreadsheetId: 'Sheet ID', gasWebhookUrl: 'GAS Webhook URL' },
    // ...
  },
},

combined: {
  driveFolderId:    'Combined Drive 資料夾 ID',
  seoAgentFolderId: 'Combined seo-agent 固定資料夾 ID',
  sheet: { spreadsheetId: 'Sheet ID', gasWebhookUrl: 'GAS Webhook URL' },
},

driveFolderIds: {
  weeklyReports: '週報資料夾 ID',
  dailyReports:  '日報資料夾 ID',
},

// Google Chat Webhook URL 設定於 .env → GOOGLE_CHAT_WEBHOOK_URL
```

> `category` 的 Drive 資料夾、Sheet 與 GAS webhook 已建立並填入 `config.js`。若之後又新增頁面類型，
> 補齊前 `daily-update.js` 對該 kind 的 Drive 上傳/GAS 觸發步驟會印出警告後略過，不影響其他 kind 正常運作。

### 5. 部署 GAS

1. 打開 Google Sheets → Apps Script
2. 貼上 `gas-webhook.gs` 內容（每個頁面類型／Combined 各自的 Sheet 都要各自部署一份）
3. 部署為「網路應用程式」→ 複製 Webhook URL 填入 `config.js`

---

## 報告輸出

```
analysis-log/
└── reports/
    ├── daily/
    │   └── daily-YYYYMMDD.md     每日自動產出，儲存本機
    └── weekly/
        └── weekly-YYYYMMDD.md    週五自動產出，同步上傳 Google Drive
```

### 週報說明

- **執行時機**：每週五 `pnpm daily` 時自動觸發，或手動執行 `pnpm weekly`
- **涵蓋範圍**：以執行當下（或 `--date` 指定日期）為錨點，往前推 7 天
- **補跑方式**：遇假日可下個工作日執行 `pnpm weekly -- --date <原定週五日期>` 補產
- **發送對象**：Google Chat 發精簡摘要 + 詳細週報 Drive 連結
- **Drive 存放**：`config.js` → `driveFolderIds.weeklyReports`，自動設為 eslite.com 網域內可檢視
- **對齊 PD 節奏**：PD 每週四更新 GSC 等 SEO 數據，週五週報可呈現最新完整狀態

---

## 每月更新 Sheet

每月建立新的 Google Sheet 時，只需更新 `config.js` 每個頁面類型／`combined` 底下的 `sheet` 區塊：

```js
pageKinds: {
  product:  { sheet: { spreadsheetId: '新的 Sheet ID', gasWebhookUrl: '新的 Webhook URL' } },
  category: { sheet: { spreadsheetId: '新的 Sheet ID', gasWebhookUrl: '新的 Webhook URL' } },
},
combined: { sheet: { spreadsheetId: '新的 Sheet ID', gasWebhookUrl: '新的 Webhook URL' } },
```

同時需在新 Sheet 重新部署 GAS 腳本。

---

## 異常告警規則

適用於所有登記頁面類型（商品頁、分類頁）的 SSR 資料，目前共用同一套門檻：

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
- 商品頁價格與庫存為 client-side 非同步載入，不在 SSR 範疇；分類頁沒有 SSG，只有 SSR

---

## 頁面類型 registry

`config.js` 的 `pageKinds`（目前為 `product`、`category`）驅動 `tools.js`/`daily-update.js` 的邏輯本體：
每個 kind 定義 JSON 路徑、Drive 資料夾、Sheet/GAS 設定，以及對應 combined json 的欄位名
（`combinedRecordsKey`/`combinedCacheHitKey`/`combinedErrorsKey`/`combinedAffectedCountKey`）。
`combined` 是跨頁面類型的彙總，獨立於 `pageKinds` 之外。

要加新頁面類型（例如文章頁）：在 `pageKinds` 複製一筆改路徑/欄位名即可，`tools.js` 的 `read_json`、
`upload_to_drive`、`trigger_gas` 與 `daily-update.js` 的迴圈都會自動涵蓋新 kind，不需要改邏輯本體。
`prompts.js` 裡頁面特有的業務知識敘述、`.claude/commands/seo-query.md` 的操作步驟仍需手動補一小段。

## Prompt 維護

所有給 Claude 的背景說明、規則、格式指令集中在 `prompts.js`。

需要更新的時機：
- 放量階段升級（P0 → P1...）→ 更新 `config.js` 的 `rules.rollout`
- 異常閾值調整 → 更新 `config.js` 的 `rules.renderTime`
- 背景知識有變更（架構調整、新的注意事項）→ 直接修改 `prompts.js`
