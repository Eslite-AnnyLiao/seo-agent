查詢 Eslite 誠品線上 Astro 商品頁 SEO 數據。

## 背景知識

SSR 服務只有爬蟲（Googlebot）進入，不影響使用者體驗，但直接影響 SEO 品質（索引速度、爬取預算、排名）。
渲染架構使用 Cloudflare Worker，效能問題方向是優化 API 或 cache 策略，不適用擴容建議。
目前處於放量階段，cache hit rate 偏低是預期行為。
ssr_records = 實際打到 Worker 的請求數（cache miss）；cache_hit_ssr = Cloudflare edge 直接回應（未進 Worker）。
render_time_stats 只涵蓋 cache miss 的請求。
商品價格與庫存由 client-side 非同步載入，不在 SSR 範疇。

## 異常判斷規則

- p95_ms > 3000ms → ⚠️ 警告
- p99_ms > 5000ms → ⚠️ 警告
- abnormal_render_rate_pct > 1% → 🚨 異常（5秒以上）
- slow_render_rate_pct > 3% → ⚠️ 警告（3–5秒）

## 資料路徑

資料存放於 Google Drive 固定資料夾（不隨月份變動）：
- SSR folder ID：`1iXSr0Oc4lEJnSScPMSplI2z9bUNyGpVR`
- Combined folder ID：`1w089WQQpTFmkRtLN6jwPE7nFpUzhL2Pi`

檔名格式：`ssr-product-log-YYYYMMDD_analysis.json` / `combined-YYYYMMDD_analysis.json`

## 執行方式

1. 依問題決定要查的日期（今天或昨天），格式為 `YYYYMMDD`
2. 用 Bash 取得 gcloud token 並搜尋對應檔案：
   ```bash
   TOKEN=$(gcloud auth print-access-token)
   curl -s "https://www.googleapis.com/drive/v3/files?q='FOLDER_ID'+in+parents+and+name+contains+'YYYYMMDD'&fields=files(id,name)" \
     -H "Authorization: Bearer $TOKEN"
   ```
3. 取得 file ID 後下載 JSON 內容：
   ```bash
   curl -s "https://www.googleapis.com/drive/v3/files/FILE_ID?alt=media" \
     -H "Authorization: Bearer $TOKEN"
   ```
4. 根據數據回答問題，使用繁體中文，技術術語可保留英文
5. 回答結尾加上：⚠️ 以上為 AI 建議，請工程師判斷後再行動。

## 前置需求

使用者需以公司 Google 帳號登入 gcloud：
```bash
gcloud auth login
```

## 使用者問題

$ARGUMENTS
