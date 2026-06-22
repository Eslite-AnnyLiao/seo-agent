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
      current_stage: 'P2',
      guid_digits: '10–21',
      traffic_percent: 12,
      rollback_trigger: '5xx rate > 0.5% 或 SSR P95 > 前階段觀測值 × 1.2',
      start_date: '2026/06/22',
    },
    qualifying_day: {
      min_requests: 50000,   // 當日 Worker 請求數
      min_peak_rpm: 180,     // 當日尖峰 RPM
    },
    knownChanges: [
      {
        date: '2026/06/16',
        description: '移除 SSR 中的 purchase_status API，改用 prices v2 API；預期此日後 render time（P95/P99）明顯改善',
      },
    ],
  },
};
