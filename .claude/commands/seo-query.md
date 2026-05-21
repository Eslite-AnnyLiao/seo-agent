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

JSON 資料位於 `/Users/liaoliting/Webserver/analysis-log` 下：
- SSR：`daily-analysis-result/astro/datadog-export/ssr/`
- Combined：`daily-analysis-result/astro/datadog-export/combined/`

檔名格式：`ssr-product-log-YYYYMMDD_analysis.json` / `combined-YYYYMMDD_analysis.json`

## 執行方式

1. 用 Bash 找出今天或昨天對應的 JSON 檔（依問題決定日期）
2. 用 Read 讀取 JSON 內容
3. 根據數據回答問題，使用繁體中文，技術術語可保留英文
4. 回答結尾加上：⚠️ 以上為 AI 建議，請工程師判斷後再行動。

## 使用者問題

$ARGUMENTS
