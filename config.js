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
      spreadsheetId: '1uf1gkqU0Pqh4slxiDKVdjVdtzZHBSSS9IkzaLUUuChk', // 商品頁 SSR 數據統計
      sheetName: '每日資料',
      gasWebhookUrl:
        'https://script.google.com/a/macros/eslite.com/s/AKfycbwwbwbz4stI1JyEMVk1VP8j4XuebUDoDHapnrcsoB_GI-CfuTQ56193tyFH97aBhray/exec',
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
      current_stage: 'P1',
      guid_digits: '12–19',
      traffic_percent: 8,
      rollback_trigger: '5xx rate > 0.5% 或 SSR P95 > 前階段觀測值 × 1.2',
      start_date: '2026/06/02',
    },
    qualifying_day: {
      min_requests: 25000,   // 當日 Worker 請求數
      min_peak_rpm: 100,     // 當日尖峰 RPM
    },
    knownChanges: [
      {
        date: '2026/06/16',
        description: '移除 SSR 中的 purchase_status API，改用 prices v2 API；預期此日後 render time（P95/P99）明顯改善',
      },
    ],
  },
};
