// ─────────────────────────────────────────────
// config.js
// 每月換新 sheet 時只需更新 sheets 區塊的
// spreadsheetId 和 gasWebhookUrl
// ─────────────────────────────────────────────

export const config = {
  // ── 本機路徑（設定於 .env）────────────────
  analysisLogPath: process.env.ANALYSIS_LOG_PATH,
  pipelineScript:  process.env.PIPELINE_SCRIPT,

  jsonPaths: {
    ssr: 'daily-analysis-result/astro/datadog-export/ssr',
    combined: 'daily-analysis-result/astro/datadog-export/combined',
  },

  // ── 特殊事件報告（搶購活動等臨時事件，人工放置於此資料夾）────
  specialEventsPath: 'special_events',

  // ── Google Drive 上傳目的地 ────────────────
  driveFolderIds: {
    ssr: '1tFUlJhjyEEWBtfbAGKZqOCLLCOO3xXE_',
    combined: '1rF66lEG52iOAUNgm__Dx7GMow6VYwkSY',
    weeklyReports: '1e29H-bKSd6gPaYsFkx1DB2zMZyU4vkC9',
    dailyReports: '1WOOPHMT3NjLZCS3AH4DpCuwyvNiB4EXa',
  },

  // ── seo-agent skill 用的固定資料夾（不隨月份換）────
  seoAgentFolderIds: {
    ssr: '1iXSr0Oc4lEJnSScPMSplI2z9bUNyGpVR',
    combined: '1w089WQQpTFmkRtLN6jwPE7nFpUzhL2Pi',
  },

  // ── GSC Tracking Sheet（固定，不隨月份換）────
  gscSheet: {
    spreadsheetId: '1XKaRKwchznWq3CKYLGo8TRPW4QZ3dEqBLEZSk1G_rRQ',
    sheetName: 'GSC Tracking',
  },

  // ── Google Sheets（每月手動更新這裡）────────
  sheets: {
    ssr: {
      spreadsheetId: '1fSoJGQk34cGHJYLJ_nUcqLFqjaV8IQ623NjpKAEXkjM', // 商品頁 SSR 數據統計
      sheetName: '每日資料',
      gasWebhookUrl:
        'https://script.google.com/a/macros/eslite.com/s/AKfycbyxDULab7gedlJEQmGoudtZDzki0GiW3UpeSmXTe_7C3t54KKYLSkhtes8Bf8tQG3l8/exec',
    },
    combined: {
      spreadsheetId: '1CbjrsroFnvpXwqBwZSxETOn87Oi156Dref6sBJEHOZA', // 全站流量總覽
      sheetName: '每日資料',
      gasWebhookUrl:
        'https://script.google.com/a/macros/eslite.com/s/AKfycbyngz_qh0vZfLRDRdXVQKPh1JCjJ5cmwshXlxoiByGiP-HLFzwI2DLBC9aC_XXjx-jp/exec',
    },
  },

  // ── Google Chat Webhook ───────────────────
  googleChatWebhookUrl: process.env.GOOGLE_CHAT_WEBHOOK_URL ?? '',

  // ── 數據判斷規則 ──────────────────────────
  rules: {
    ssr: {
      p95_warn_ms: 3000,          // render_time_stats.p95_ms
      p99_warn_ms: 5000,          // render_time_stats.p99_ms
      abnormal_render_rate: 1,    // 異常渲染率（%）count_above_5000ms / total_records
      slow_render_rate: 3,        // 慢渲染率（%）count_above_3000to5000ms / total_records
    },
    cache: {
      hit_rate_warn_pct: 5,       // cache hit rate 低於此值 → ⚠️ 警告
      hit_rate_abnormal_pct: 3,   // cache hit rate 低於此值 → 🚨 異常
    },
    error404: {
      baseline_pct: 8,            // 目前觀測基準（放量階段實測均值，供比對用）
      healthy_pct: 3,             // SEO 健康目標（每次回答須顯示現況 vs 此目標）
      warn_pct: 10,               // 404 率高於此值 → ⚠️ 警告
      abnormal_pct: 15,           // 404 率高於此值 → 🚨 異常
    },
    rollout: {
      current_stage: 'P3',
      guid_digits: '10–29',
      traffic_percent: 20,
      rollback_trigger: '5xx rate > 0.5% 或 SSR P95 > 前階段觀測值 × 1.2',
      start_date: '2026/06/30',
    },
    qualifying_day: {
      min_requests: 350000,  // 當日 Worker 請求數
      min_peak_rpm: 1300,    // 當日尖峰 RPM
    },
    knownChanges: [
      {
        date: '2026/06/16',
        description: '移除 SSR 中的 purchase_status API，改用 prices v2 API；預期此日後 render time（P95/P99）明顯改善',
      },
      {
        date: '2026/06/12',
        description:
          '因針對「找不到網頁 (404)」與「已檢索 - 目前尚未建立索引」兩項 Coverage 問題於 GSC 送出重新驗證（Validate Fix），驗證期間 GSC Tracking Sheet 以下欄位數據凍結不再更新：所有索引＋檢索、有效 (Coverage)（涵蓋範圍）、排除 (網頁-未建立索引)、檢索未索引 (排除 > 已檢索 - 目前尚未建立索引)、錯誤 (伺服器錯誤5XX)、已找到、重複頁面、已提交 - 已建立索引 (下拉式選單)、已提交 - 未建立索引 (下拉式選單)、外部連結（左側選單最下方的「連結」）、100 (連結)（連入連結）、200 (連結)（連入連結）、100 (網域)（連結網站數）、200 (網域)（連結網站數）、100 (目標網頁降序)（最常連結的網站）、200 (目標網頁)（最常連結的網站）、內部連結、500（熱門連結網頁）、1000（熱門連結網頁）、有效/所有、未索引/有效、Sitemap/有效。這些欄位數週內數值不變屬預期現象，不代表問題無變化、已改善或惡化，不可視為異常或改善訊號',
      },
    ],
  },
};
