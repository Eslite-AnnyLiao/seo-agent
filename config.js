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
  },

  // ── Google Sheets（每月手動更新這裡）────────
  sheets: {
    ssr: {
      spreadsheetId: '1uf1gkqU0Pqh4slxiDKVdjVdtzZHBSSS9IkzaLUUuChk', // 商品頁 SSR 數據統計
      sheetName: '每日資料',
      gasWebhookUrl:
        'https://script.google.com/a/macros/eslite.com/s/AKfycbx2GbsjrugbCZsRpiUXDXySehVL30lsx0jfq5T20l5Nvg8-K5U5v_9TvCecNLJY5cTt/exec',
    },
    combined: {
      spreadsheetId: '1y-XIf94_CmevHN28vrRI2zHAyAnjBDIJAS0VLJHahOU', // 全站流量總覽
      sheetName: '每日資料',
      gasWebhookUrl:
        'https://script.google.com/a/macros/eslite.com/s/AKfycbx3zOE5XWn1HFzMzfKUrui6T3V945aXHKQAiNzVAFAQWY_iEKAfnhvzzFxy6wIiyIzh/exec',
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
    rollout: {
      current_stage: 'P0',
      guid_digits: '15–19',
      rollback_trigger: '5xx rate > 0.5% 或 SSR P95 > 前階段觀測值 × 1.2',
    },
    qualifying_day: {
      min_requests: 30000,   // 當日 Worker 請求數
      min_peak_rpm: 100,     // 當日尖峰 RPM
    },
  },
};
