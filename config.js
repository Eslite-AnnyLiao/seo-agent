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
      driveFolderId: '1n2WMWg-fPS4aiFoGAEjoE3UebGN0oY50',
      seoAgentFolderId: '1MmLWR2m0MtuQ4v13o82HBvcm0XT5cPuJ',
      sheet: {
        spreadsheetId: '1fSoJGQk34cGHJYLJ_nUcqLFqjaV8IQ623NjpKAEXkjM', // 商品頁 SSR 數據統計
        sheetName: '每日資料',
        gasWebhookUrl:
          'https://script.google.com/a/macros/eslite.com/s/AKfycbxBdD5q2BSQ1BUg9jJlNydcWTNf-aMQpYg6pslkOv2euhYksWmtuSKzZkWASznEX38E/exec',
      },
      combinedRecordsKey: 'ssr_records',
      combinedCacheHitKey: 'cloudflare_cache_hit',
      combinedErrorsKey: 'errors_404',
      combinedAffectedCountKey: 'affected_product_count',
    },

    category: {
      label: '分類頁',
      jsonPath: 'daily-analysis-result/datadog-export/category/ssr',
      driveFolderId: '1sGmnES8iDttMIvo8onPSl2dLnr1RznBf',
      seoAgentFolderId: '145MJEd9TnIO22GAEnQtbfKGCRvRHwcmv',
      sheet: {
        spreadsheetId: '13onChUJX9e-M6rtlWDghstMk_sQtgkrpUsgUaya4VLU', // 分類頁 SSR 數據統計
        sheetName: '每日資料',
        gasWebhookUrl:
          'https://script.google.com/a/macros/eslite.com/s/AKfycbxYhqlyifTBAe6ctxJevIYZlxn07Qw2KT9QCRG67hMcCrKvIVN9UT0sA8FtCHmiJUb2/exec',
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
    driveFolderId: '1rF66lEG52iOAUNgm__Dx7GMow6VYwkSY',
    seoAgentFolderId: '1w089WQQpTFmkRtLN6jwPE7nFpUzhL2Pi',
    sheet: {
      spreadsheetId: '1CbjrsroFnvpXwqBwZSxETOn87Oi156Dref6sBJEHOZA', // 全站流量總覽
      sheetName: '每日資料',
      gasWebhookUrl:
        'https://script.google.com/a/macros/eslite.com/s/AKfycbycxFdWQeqmyOvVBn1HmmxLJ4txq21txeV9C__NGco4SkkoO9SIZU0nD49qC-qdi1_5/exec',
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
