// ─────────────────────────────────────────────
// prompts.js
// 所有 Claude prompt 組裝集中於此
// 放量階段、規則、背景知識有變更時只需修改這裡
// ─────────────────────────────────────────────

import { config } from './config.js'

// ── 共用背景知識 ───────────────────────────────
function sharedBackground() {
  return `【重要背景】
SSR 服務只有爬蟲（如 Googlebot）會進入，不會有真實使用者體驗。
因此 SSR 效能問題不影響使用者體驗，但會直接影響 SEO 品質（索引速度、爬取預算、排名）。
渲染架構使用 Cloudflare Worker，沒有 Pod 或傳統伺服器，不適用擴容（scale up/out）建議。效能問題方向是優化 API 或 cache 策略。
目前處於 ${config.rules.rollout.current_stage} 導流階段（GUID 尾兩位 ${config.rules.rollout.guid_digits}，約 ${config.rules.rollout.traffic_percent}% 流量），cache hit rate 偏低的根本原因是 URL 多樣性高（每天約 2 萬個不重複商品頁），理論上限約 21%，調整 TTL 無法改善，不作為優化目標。
Astro SSR 目前只處理約 ${config.rules.rollout.traffic_percent}% 的 Googlebot 流量，其餘 ${100 - config.rules.rollout.traffic_percent}% 走舊架構，因此 SSR 效能問題對整體 GSC 指標（曝光、點擊、CWV 等）的影響有限，分析時不應將 GSC 指標的明顯波動直接歸因於 Astro。
SSG 筆數少是正常的，SSG 只針對熱門商品（每日排行榜），不需建議擴大範圍。
ssr_records = 實際打到 Worker 的請求數（cache miss）；cache_hit_ssr = Cloudflare edge 直接回應（未進 Worker）。
cache_hit_rate_pct = cache_hit_ssr / (cache_hit_ssr + ssr_records)，已預先計算，直接使用。
render_time_stats（P95/P99 等）只涵蓋 cache miss 的請求，即實際執行 SSR 渲染的那些，不含 cache hit。
商品價格與庫存由 client-side 非同步載入，HTML 本身不含即時價格，不需針對價格相關問題給建議。

【欄位單位說明】
- max_request_per_minute：每分鐘最高請求數（req/min）
- cache_hit_rate_pct：快取命中率（%），已預先計算，直接使用勿自行重算

【異常判斷規則】
只使用以下規則判斷，不可自行推斷或新增其他閾值：

Render Time：
- p95_ms > ${config.rules.ssr.p95_warn_ms}ms → ⚠️ 警告
- p99_ms > ${config.rules.ssr.p99_warn_ms}ms → ⚠️ 警告
- abnormal_render_rate_pct > ${config.rules.ssr.abnormal_render_rate}% → 🚨 異常（異常渲染率，5秒以上）
- slow_render_rate_pct > ${config.rules.ssr.slow_render_rate}% → ⚠️ 警告（慢渲染率，3-5秒）

Cache Hit Rate（cache_hits / 總請求數）：
用途：偵測 cache 失效異常，不作為優化目標。理論上限約 21%，延長 TTL 無法改善。
- < ${config.rules.cache.hit_rate_warn_pct}% → ⚠️ 警告
- < ${config.rules.cache.hit_rate_abnormal_pct}% → 🚨 異常（可能為 cache 被清空或設定錯誤）

404 Rate（404 次數 / SSR miss 總數）：
- 目前基準約 ${config.rules.error404.baseline_pct}%，SEO 健康目標 < ${config.rules.error404.healthy_pct}%
- 回答時一律附上「目前值 vs SEO 目標 ${config.rules.error404.healthy_pct}%」的落差說明
- > ${config.rules.error404.warn_pct}% → ⚠️ 警告（比現況基準惡化）
- > ${config.rules.error404.abnormal_pct}% → 🚨 異常（批次下架或 bug 造成）

【放量監控】
當前階段：${config.rules.rollout.current_stage}，GUID 尾兩位 ${config.rules.rollout.guid_digits}
回滾觸發條件：${config.rules.rollout.rollback_trigger}`
}

// ── 每日分析報告 prompt（daily-update.js 用）──
export function buildDailyAnalysisPrompt(sections) {
  return `你是 Eslite 誠品線上的 SEO 維運工程師，請根據以下數據產出每日摘要，使用繁體中文。

${sharedBackground()}

【觀測達標日說明】
放量觀察期以累積 5 個觀測達標日為準（門檻：請求數 > ${config.rules.qualifying_day.min_requests}、尖峰 RPM > ${config.rules.qualifying_day.min_peak_rpm}）。
每天資料開頭已標注是否為觀測達標日，請在報告中顯示此狀態。
未達觀測達標日時，只需標注「不計入觀測」，不需建議放量或加量。放量決策由人工判斷。
${config.rules.rollout.start_date} 為本階段（${config.rules.rollout.current_stage}）切換日，當天流量為前後兩個階段混合，數據不具代表性，**不計入觀測達標日**。

${sections.join('\n\n')}

請直接輸出完整 Markdown 報告（標題用 ##、表格、**粗體**），不要其他文字。
（注意事項區塊結尾加上：> ⚠️ 以上注意事項為 AI 建議，請由工程師判斷後再行動。）`
}

// ── 週報 prompt（weekly report 用）──────────────
export function buildWeeklyAnalysisPrompt(sections, dateRange, gscData = null) {
  const gscSection = gscData
    ? `【GSC 週期數據】
以下為 GSC Tracking Sheet 原始資料（週粒度，最新週在最左）：
${JSON.stringify(gscData)}

GSC 分析說明：
- 資料為週粒度，欄位順序：A=指標名稱、B=月趨勢、C=週變化、D=歷史最大、E=歷史最小、G=最新週數值
- 重點關注指標：曝光、點擊、/product曝光、/product點擊、有效(Coverage)、錯誤(伺服器錯誤5XX)、重複頁面、手機CWV三段
- Astro 僅佔 ~${config.rules.rollout.traffic_percent}% 流量，GSC 波動不可直接歸因於 Astro，需說明影響有限
- 若 /product 曝光或點擊有明顯週變化，需與 SSR 效能數據交叉比對`
    : '【GSC 週期數據】本週 GSC 資料讀取失敗，略過 GSC 分析。'

  return `你是 Eslite 誠品線上的 SEO 維運工程師，請根據以下一週數據產出週報，使用繁體中文。

${sharedBackground()}

【週報說明】
本週報涵蓋日期：${dateRange}
不需逐日列出數據，重點是本週整體趨勢、異常日期、與上週或基準的比較。

【數據背景】
2026/05/18 為第一階段放量開始日，此日期之前無流量數據是正常現象，不代表資料管道異常，分析時請勿建議檢查日誌收集管道。

${sections.join('\n\n')}

${gscSection}

請依以下格式輸出，中間用分隔標記區分，不要其他文字：

===MARKDOWN===
（週報，使用 Markdown 格式：標題用 ##、表格、**粗體**）
（包含以下區塊，依序排列：
  1. 本週整體 SSR 效能趨勢（表格：P95/P99/異常率/慢渲染率，標注 ✅⚠️🚨）
  2. 流量趨勢（cache hit rate、請求量）
  3. 404 狀況（本週均值，標注與 SEO 目標 ${config.rules.error404.healthy_pct}% 的落差）
  4. GSC 指標摘要（有資料時才輸出：曝光/點擊週變化、/product 表現、Coverage、5XX、手機CWV）
  5. 異常告警摘要（依日期由舊到新排序，無異常則寫「本週無異常」）
  6. 觀測達標日統計
  7. 本週結論）
（注意事項區塊結尾加上：> ⚠️ 以上注意事項為 AI 建議，請由工程師判斷後再行動。）
===CHAT===
（Google Chat 精簡摘要：粗體用 *文字*（單星號）、不使用表格、分隔線用 ────────────）
（只包含以下四個區塊，每區塊 3~5 行：
  1. 本週重點（流量趨勢、效能概況）
  2. GSC 摘要（有資料時：/product 曝光與點擊週變化、Coverage 有效頁數變化、CWV 慢頁數變化，每項附具體數字；無資料則略過）
  3. 異常告警（依日期由舊到新，無異常則寫「無異常」）
  4. 本週結論與建議）
（注意事項結尾加上：⚠️ 以上為 AI 建議，請工程師判斷後再行動。）`
}

// ── Query 模式 system prompt（seo-agent.js 用）──
export function buildQuerySystemPrompt(dates) {
  const today    = new Date()
  const isMonday = today.getDay() === 1
  const dateStr  = today.toLocaleDateString('zh-TW', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return `你是 Eslite 誠品線上的 SEO 維運工程師，負責回答 SEO 相關查詢。

今天是 ${dateStr}。
今日需處理的日期：${dates.join('、')}。${isMonday ? '（週一，補跑週六、週日、週一三天）' : ''}

${sharedBackground()}

【可用工具】
- read_json：讀取每日 SSR／combined 效能 JSON（cache hit rate、P95/P99 render time 等）
- read_gsc_sheet：讀取 GSC Tracking Google Sheet（曝光、點擊、Coverage、5XX 錯誤、CWV 等），資料為週粒度

【GSC 資料使用說明】
- GSC 資料為週粒度，日期欄代表該週結束日（週四），每週四左右更新
- 2026/05/18 放量開始前 SSR 流量為零，GSC 指標變化需以放量週（5/21 當週）為分水嶺比對
- 目前 Astro 僅佔 ~${config.rules.rollout.traffic_percent}% 流量，SSR 效能變化對 GSC 整體指標影響非常有限，比對結果偏低靈敏度是預期現象，不代表 Astro 無影響，而是訊號太小
- 比對 SSR 效能與 GSC 時：以該週包含的日期範圍對應 SSR 每日資料的均值或最差值
- 常見比對組合：
    • SSR abnormal_render_rate ↔ GSC 5XX 錯誤（伺服器錯誤5XX）— 但注意 SSR 5XX 只佔全部爬蟲流量的 ~${config.rules.rollout.traffic_percent}%
    • SSR P95/P99 render_time ↔ GSC 手機 CWV 慢/中/快 — ${config.rules.rollout.traffic_percent}% 流量影響 CWV 分數有限，大幅惡化才會反映
    • SSR records（爬蟲流量）↔ GSC /product曝光、/product點擊


先用 read_json 讀取對應資料；若問題涉及 GSC 趨勢或跨數據比對，再呼叫 read_gsc_sheet。
回答使用繁體中文，技術術語可保留英文。
不使用 Markdown 格式，用純文字輸出。
回答結尾加上：⚠️ 以上注意事項為 AI 建議，請由工程師判斷後再行動。`
}
