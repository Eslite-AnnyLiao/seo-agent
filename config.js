// ─────────────────────────────────────────────
// config.js
// 每月換新 sheet 時只需更新每個頁面類型（pageKinds.*.sheet）與
// combined.sheet 底下的 spreadsheetId 和 gasWebhookUrl
//
// 頁面類型 registry：驅動 tools.js / daily-update.js 的邏輯本體。
// 要加新頁面類型（例如文章頁），照 pageKinds 這個形狀新增一筆設定即可，
// 不需要改 tools.js / daily-update.js 的邏輯本體（呼應 astro-log-pipeline
// 的 src/config/page-kinds.js 設計）。
// ─────────────────────────────────────────────

export const config = {
  // ── 本機路徑（設定於 .env）────────────────
  analysisLogPath: process.env.ANALYSIS_LOG_PATH,
  pipelineScript:  process.env.PIPELINE_SCRIPT,

  // ── 頁面類型 registry ──────────────────────
  // combinedRecordsKey / combinedCacheHitKey / combinedErrorsKey 對應的是
  // astro-log-pipeline 原始 combined json 裡實際存在的欄位名（該專案定義，
  // 不受這裡的 pageKinds 鍵名影響）。
  pageKinds: {
    product: {
      label: '商品頁',
      jsonPath: 'daily-analysis-result/datadog-export/product/ssr',
      driveFolderId: '1_YHgUBBfcXmmWKwEUybyE-RI5eUaqqEN',
      seoAgentFolderId: '1MmLWR2m0MtuQ4v13o82HBvcm0XT5cPuJ',
      sheet: {
        spreadsheetId: '1HHpLloIk2sNI53PdjJorN_kgao4AXKEevKnm8gjXygI', // 商品頁 SSR 數據統計
        sheetName: '每日資料',
        gasWebhookUrl:
          'https://script.google.com/a/macros/eslite.com/s/AKfycbxrB9jmkWzf37OsWVuwJpMT9nb_6Vanc4JcOgvxwgijIOvV8YCgBGn719qksbo9eFgS/exec',
      },
      combinedRecordsKey: 'ssr_records',
      combinedCacheHitKey: 'cloudflare_cache_hit',
      combinedErrorsKey: 'errors_404',
      combinedAffectedCountKey: 'affected_product_count',
    },

    category: {
      label: '分類頁',
      jsonPath: 'daily-analysis-result/datadog-export/category/ssr',
      driveFolderId: '1mvjXjpELu6QWaU37XC16k3_lX8-c101O',
      seoAgentFolderId: '145MJEd9TnIO22GAEnQtbfKGCRvRHwcmv',
      sheet: {
        spreadsheetId: '1PRKqYaeVHnu_Z7ZW_nprlfM4k98-eFL5ooG7oT7Kcso', // 分類頁 SSR 數據統計
        sheetName: '每日資料',
        gasWebhookUrl:
          'https://script.google.com/a/macros/eslite.com/s/AKfycbyO4kP4PmBnpSeFDLZrekz6q7-_EOmBkLRfymayfbGBjVInCSKFE3JFAhacgoG8C5fBNg/exec',
      },
      combinedRecordsKey: 'category_records',
      combinedCacheHitKey: 'cloudflare_cache_hit_category',
      combinedErrorsKey: 'errors_404_category',
      combinedAffectedCountKey: 'affected_category_count',
    },

    // 未來加文章頁：複製一筆改路徑/欄位名即可，不用碰 tools.js / daily-update.js
  },

  // combined 是跨頁面類型的彙總，不是某一種頁面，獨立於 pageKinds 之外
  combined: {
    jsonPath: 'daily-analysis-result/datadog-export/combined',
    driveFolderId: '1y0CMD0MhDrDtM-sUHFnKqS1Jni2wNFah',
    seoAgentFolderId: '1w089WQQpTFmkRtLN6jwPE7nFpUzhL2Pi',
    sheet: {
      spreadsheetId: '1kh0PzD3O-ZPWX2vZJZguc7IEMgH6Ptv897s6AkKWzOY', // 全站流量總覽
      sheetName: '每日資料',
      gasWebhookUrl:
        'https://script.google.com/a/macros/eslite.com/s/AKfycbwe2YKHTQp29_cFBvC2zjAZ1zzoFE2ohWRBGBsB5P8k_WJ0uqAP7C94NB0g2Iuec2TL/exec',
    },
  },

  // ── 特殊事件報告（搶購活動等臨時事件，人工放置於此資料夾）────
  specialEventsPath: 'special_events',

  // ── Google Drive 上傳目的地（跟頁面類型無關的固定資料夾）───
  driveFolderIds: {
    weeklyReports: '1e29H-bKSd6gPaYsFkx1DB2zMZyU4vkC9',
    dailyReports: '1WOOPHMT3NjLZCS3AH4DpCuwyvNiB4EXa',
  },

  // ── GSC Tracking Sheet（固定，不隨月份換）────
  gscSheet: {
    spreadsheetId: '1XKaRKwchznWq3CKYLGo8TRPW4QZ3dEqBLEZSk1G_rRQ',
    sheetName: 'GSC Tracking',
  },

  // ── Google Chat Webhook ───────────────────
  googleChatWebhookUrl: process.env.GOOGLE_CHAT_WEBHOOK_URL ?? '',

  // ── 數據判斷規則 ──────────────────────────
  rules: {
    renderTime: {
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
      current_stage: 'P5',
      guid_digits: '10–89',
      traffic_percent: 80,
      rollback_trigger: '5xx rate > 0.5% 或 SSR P95 > 前階段觀測值 × 1.2',
      start_date: '2026/08/04',
      observation_window_days: 20,  // 觀察期停損點：此天數內未累積滿 target_count 個達標日 → 需人工檢討（依歷史聯合達標率 ~41% 校準，20 天湊滿 10 個達標日機率 ~28%，非嚴格保證，只是比 10 天合理）
    },
    qualifying_day: {
      page_kind: 'product',  // 達標日依哪個頁面類型判斷（目前主要放量對象是商品頁，非 combined 加總）
      min_requests: 1130000, // 當日 Worker 請求數
      min_peak_rpm: 3800,    // 當日尖峰 RPM
      target_count: 10,       // 累積滿此數量的達標日即可考慮升階（放量決策仍由人工判斷）
    },
    knownChanges: [
      {
        date: '2026/06/16',
        description: '移除 SSR 中的 purchase_status API，改用 prices v2 API；預期此日後 render time（P95/P99）明顯改善',
      },
    ],
  },
};
