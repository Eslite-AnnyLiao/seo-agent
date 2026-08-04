// ─────────────────────────────────────────────
// tools.js
// 工具定義 + 執行邏輯
// ─────────────────────────────────────────────

import { execSync } from 'child_process';
import { readdirSync, readFileSync, createReadStream } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { config } from './config.js';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

// ── 頁面類型 registry 查表 ─────────────────────
// PAGE_KIND_KEYS = ['product', 'category', ...]（跟著 config.pageKinds 走，
// 新增頁面類型不用改這裡）。TYPE_ENUM 是所有工具 `type` 參數的合法值。
const PAGE_KIND_KEYS = Object.keys(config.pageKinds);
const TYPE_ENUM = [...PAGE_KIND_KEYS, 'combined'];

function resolveType(type) {
  return type === 'combined' ? config.combined : config.pageKinds[type];
}

const pageKindLabels = PAGE_KIND_KEYS.map((k) => config.pageKinds[k].label).join('/');

// 任一頁面類型（product、category...）的 SSR 效能 json 欄位形狀相同，共用同一套解析邏輯
function buildRenderStatsResult(raw, target) {
  const total  = raw.data_source_stats?.valid_duration_records ?? raw.data_source_stats?.total_records ?? 0;
  const slow   = raw.render_time_stats?.count_above_3000to5000ms ?? 0;
  const abnorm = raw.render_time_stats?.count_above_5000ms       ?? 0;
  return {
    date:                     target.match(/\d{8}/)?.[0],
    total_records:            total,
    average_ms:               raw.render_time_stats?.average_ms    ?? null,
    median_p50_ms:            raw.render_time_stats?.median_p50_ms ?? null,
    p95_ms:                   raw.render_time_stats?.p95_ms        ?? null,
    p99_ms:                   raw.render_time_stats?.p99_ms        ?? null,
    max_ms:                   raw.render_time_stats?.max_ms        ?? null,
    slow_render_rate_pct:     total > 0 ? parseFloat((slow   / total * 100).toFixed(2)) : null,
    abnormal_render_rate_pct: total > 0 ? parseFloat((abnorm / total * 100).toFixed(2)) : null,
    max_request_per_minute:   raw.per_minute_stats?.max_value      ?? null,
  };
}

// ── 工具定義（傳給 Claude API）─────────────────
export const toolDefinitions = [
  {
    name: 'run_fetch',
    description: [
      '執行 daily-pipeline.js，每個日期各跑一次。',
      '指令格式：node daily-pipeline.js --date YYYYMMDD',
      `每次執行會同時產生 ${pageKindLabels} 與 combined 共 ${TYPE_ENUM.length} 組 json。`,
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        dates: {
          type: 'array',
          items: { type: 'string', description: 'YYYYMMDD 格式' },
          description: '要抓的日期清單，空陣列代表昨天',
        },
      },
      required: [],
    },
  },
  {
    name: 'upload_to_drive',
    description: `把指定頁面類型（${TYPE_ENUM.join('/')}）目錄下指定日期的 json 上傳到對應的 Google Drive 資料夾`,
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: TYPE_ENUM,
          description: '要上傳哪組資料',
        },
        dates: {
          type: 'array',
          items: { type: 'string' },
          description: '要上傳的日期清單（YYYYMMDD），只上傳這些日期對應的檔案',
        },
      },
      required: ['type', 'dates'],
    },
  },
  {
    name: 'trigger_gas',
    description: '呼叫指定 Google Sheet 的 GAS webhook，執行資料計算統整',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: TYPE_ENUM,
          description: '要觸發哪個 sheet 的 GAS',
        },
        dates: {
          type: 'array',
          items: { type: 'string' },
          description: '要處理的日期清單（YYYYMMDD）',
        },
      },
      required: ['type', 'dates'],
    },
  },
  {
    name: 'read_json',
    description: `讀取指定頁面類型（${pageKindLabels}）SSR 效能或 combined 的 json 資料，用來回答 SEO 查詢問題`,
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: TYPE_ENUM,
          description: '要讀哪組資料',
        },
        date: {
          type: 'string',
          description: '指定日期 YYYYMMDD，不填則讀目錄中最新一筆',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'read_gsc_sheet',
    description: [
      '讀取 GSC Tracking Google Sheet 的週期數據，包含全部 GSC 指標（曝光、點擊、Coverage、5XX 錯誤、CWV 等）。',
      '資料粒度為週（每週約週四更新），可與 SSR 每日數據進行跨週比對。',
      '回傳格式：{ dates: ["5/21","5/14",...], metrics: { "曝光": [val,...], ... } }，日期由新到舊排列。',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        weeks: {
          type: 'number',
          description: '要回傳最近幾週的資料（預設 8 週）',
        },
      },
      required: [],
    },
  },
  {
    name: 'read_special_events',
    description: [
      '讀取 special_events/ 資料夾中人工記錄的特殊事件報告（如搶購活動、促銷導致的爬蟲錯誤暴增、系統異動等臨時事件）。',
      '檔名包含日期（YYYY-MM-DD）。當某天數據出現異常波動時，應先呼叫此工具確認當天是否有已知特殊事件，再判斷是否為真實異常。',
      '不指定 date 則回傳全部已記錄的事件。',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: '指定日期 YYYYMMDD，不填則回傳全部已記錄的特殊事件',
        },
      },
      required: [],
    },
  },
];

// ── 特殊事件報告 ───────────────────────────────
export function loadSpecialEvents(date) {
  const dir = resolve(REPO_ROOT, config.specialEventsPath);
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }

  const target = date ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : null;
  const matched = target ? files.filter((f) => f.includes(target)) : files;

  return matched.map((f) => ({ file: f, content: readFileSync(resolve(dir, f), 'utf-8') }));
}

// ── 認證工具 ───────────────────────────────────
export function isAuthError(err) {
  const msg = (err.message ?? JSON.stringify(err)).toLowerCase();
  return (
    msg.includes('invalid_rapt') ||
    msg.includes('invalid_grant') ||
    msg.includes('reauth') ||
    msg.includes('insufficient permission')
  );
}

function reAuthenticate() {
  console.log('🔐 認證已過期，重新驗證中...');
  execSync('gcloud auth login --enable-gdrive-access', { stdio: 'inherit' });
  console.log('✅ 重新驗證完成，繼續執行');
}

// ── 工具執行 ───────────────────────────────────
export async function executeTool(name, input) {
  try {
    return await runTool(name, input);
  } catch (err) {
    if (isAuthError(err)) {
      reAuthenticate();
      return await runTool(name, input);
    }
    throw err;
  }
}

async function runTool(name, input) {
  switch (name) {
    case 'run_fetch': {
      const dates = input.dates?.length ? input.dates : [getYesterday()];
      const generated = {};

      for (const date of dates) {
        const cmd = `node ${config.pipelineScript} --date ${date}`;
        console.log(`▶ ${cmd}`);
        execSync(cmd, { stdio: 'inherit' });
      }

      // 確認每個頁面類型 + combined 目錄的產出
      for (const type of TYPE_ENUM) {
        const dir = resolve(config.analysisLogPath, resolveType(type).jsonPath);
        generated[type] = readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => resolve(dir, f));
      }

      return JSON.stringify({ success: true, dates, files: generated });
    }

    case 'upload_to_drive': {
      const { type, dates } = input;
      const { jsonPath, driveFolderId, seoAgentFolderId } = resolveType(type);
      const accessToken = execSync('gcloud auth print-access-token').toString().trim();
      const authClient = new google.auth.OAuth2();
      authClient.setCredentials({ access_token: accessToken });
      const drive = google.drive({ version: 'v3', auth: authClient });

      const dir = resolve(config.analysisLogPath, jsonPath);
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.json') && dates.some((d) => f.includes(d)));

      const uploaded = [];
      for (const fileName of files) {
        const filePath = resolve(dir, fileName);
        const res = await drive.files.create({
          requestBody: {
            name: fileName,
            parents: [driveFolderId],
          },
          media: {
            mimeType: 'application/json',
            body: createReadStream(filePath),
          },
        });
        uploaded.push(res.data.id);
        console.log(`  ↑ [${type}] ${fileName} → Drive`);

        await drive.files.create({
          requestBody: {
            name: fileName,
            parents: [seoAgentFolderId],
          },
          media: {
            mimeType: 'application/json',
            body: createReadStream(filePath),
          },
        });
        console.log(`  ↑ [${type}] ${fileName} → Drive (seo-agent)`);
      }

      return JSON.stringify({ success: true, type, count: uploaded.length });
    }

    case 'trigger_gas': {
      const { type, dates } = input;
      const { gasWebhookUrl, sheetName, spreadsheetId } = resolveType(type).sheet;

      const accessToken = execSync('gcloud auth print-access-token').toString().trim();

      const res = await fetch(gasWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ dates, sheetName, spreadsheetId }),
      });
      const text = await res.text();
      console.log(`  ⚙ GAS [${type}] → ${res.status}`);

      return JSON.stringify({ success: res.ok, type, sheetName, response: text });
    }

    case 'read_json': {
      const { type, date } = input;
      const dir = resolve(config.analysisLogPath, resolveType(type).jsonPath);
      const allFiles = readdirSync(dir).filter((f) => f.endsWith('.json'));
      const target = date
        ? allFiles.find((f) => f.includes(date))
        : allFiles.sort().at(-1);

      if (!target) return JSON.stringify({ error: `找不到 json 檔（${type}${date ? ` ${date}` : ''}）` });

      const raw = JSON.parse(readFileSync(resolve(dir, target), 'utf-8'));

      if (PAGE_KIND_KEYS.includes(type)) {
        return JSON.stringify(buildRenderStatsResult(raw, target));
      }

      if (type === 'combined') {
        const totalRecords = raw.data_source_stats?.total_records ?? null;
        const result = {
          date:                    target.match(/\d{8}/)?.[0],
          total_records:           totalRecords,
          ssg_records:             raw.data_source_stats?.ssg_records ?? null,
          max_request_per_minute:  raw.per_minute_stats?.max_value    ?? null,
        };

        // 對每個登記的頁面類型動態算出 cache hit / 404 相關欄位，
        // 新增頁面類型時這裡自動多輸出一組欄位，不用改程式碼。
        for (const [kind, k] of Object.entries(config.pageKinds)) {
          const records   = raw.data_source_stats?.[k.combinedRecordsKey] ?? 0;
          const cacheHit  = raw[k.combinedCacheHitKey]?.total_ssr_hits    ?? 0;
          const totalMiss = records + cacheHit;
          const total404  = raw[k.combinedErrorsKey]?.total_404_count    ?? null;

          result[`${kind}_records`]            = records;
          result[`cache_hit_${kind}`]           = cacheHit;
          result[`cache_hit_rate_${kind}_pct`]  = totalMiss > 0 ? parseFloat((cacheHit / totalMiss * 100).toFixed(2)) : null;
          result[`total_404_count_${kind}`]     = total404;
          result[`affected_${kind}_count`]      = raw[k.combinedErrorsKey]?.[k.combinedAffectedCountKey] ?? null;
          result[`error_404_rate_${kind}_pct`]  = (totalRecords > 0 && total404 !== null) ? parseFloat((total404 / totalRecords * 100).toFixed(2)) : null;
        }

        return JSON.stringify(result);
      }

      return JSON.stringify({ error: `未知 type: ${type}` });
    }

    case 'read_gsc_sheet': {
      const weeks = input.weeks ?? 8;
      const { spreadsheetId, sheetName } = config.gscSheet;

      const accessToken = execSync('gcloud auth print-access-token').toString().trim();
      const authClient = new google.auth.OAuth2();
      authClient.setCredentials({ access_token: accessToken });
      const sheets = google.sheets({ version: 'v4', auth: authClient });

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A1:AZ200`,
      });

      const rows = res.data.values ?? [];
      if (rows.length === 0) return JSON.stringify({ error: 'Sheet 無資料' });

      // Row 0 = header: [label, 月趨勢, 週變化, 最大, 最小, Sparkline, date1, date2, ...]
      const headerRow = rows[0];
      const dateStartCol = 6; // column G onwards
      const allDates = headerRow.slice(dateStartCol);
      const slicedDates = allDates.slice(0, weeks);

      const metrics = {};
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const label = row[0];
        if (!label) continue;
        const values = row.slice(dateStartCol, dateStartCol + weeks).map((v) => {
          if (v === undefined || v === '') return null;
          // 移除千分位逗號後轉數字
          const n = Number(v.replace(/,/g, ''));
          return isNaN(n) ? v : n;
        });
        metrics[label] = values;
      }

      return JSON.stringify({ dates: slicedDates, metrics });
    }

    case 'read_special_events': {
      return JSON.stringify({ events: loadSpecialEvents(input.date) });
    }

    default:
      return JSON.stringify({ error: `未知工具: ${name}` });
  }
}

// ── Bot 名稱解析 ────────────────────────────────
export function extractBotName(ua) {
  const m = ua.match(/compatible;\s*([\w\-]+(?:\/[\d.]+)?)/i)
    ?? ua.match(/\(([\w\-]*[Bb]ot\/[\d.]+)/i)
    ?? ua.match(/^(meta-[\w]+)/i)
    ?? ua.match(/^([\w\-]+\/[\d.]+)/i)
  return m ? m[1] : ua.slice(0, 40)
}

// ── 日期工具 ───────────────────────────────────
function formatDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
}

// startDateStr/endDateStr 為 'YYYYMMDD'，回傳 startDate 隔天到 endDate（含）之間所有日期
// （UTC 計算，避免本機時區造成的日期偏移）
export function dateRangeExclusiveStart(startDateStr, endDateStr) {
  const parse = (s) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
  const cur = parse(startDateStr);
  cur.setUTCDate(cur.getUTCDate() + 1);
  const end = parse(endDateStr);
  const dates = [];
  while (cur <= end) {
    dates.push(formatDate(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// ── 觀測達標日 / 觀察期停損 ─────────────────────
export function isQualifyingDay(qdSource, qd) {
  return (qdSource?.total_records ?? 0) > qd.min_requests
      && (qdSource?.max_request_per_minute ?? 0) > qd.min_peak_rpm;
}

// qualifyingFlags：依日期順序排列的布林陣列（該日是否為觀測達標日）
export function evaluateObservationWindow(qualifyingFlags, windowDays, targetCount) {
  const daysElapsed = qualifyingFlags.length;
  const cumulativeQualifyingDays = qualifyingFlags.filter(Boolean).length;
  const targetReached = cumulativeQualifyingDays >= targetCount;
  const stopLossHit = daysElapsed >= windowDays && !targetReached;
  return { daysElapsed, cumulativeQualifyingDays, targetReached, stopLossHit };
}

// 解析週報 API 回應，切出 Drive 用完整 markdown 與 Chat 用精簡摘要
// 找不到 ===CHAT=== 分隔標記時（截斷或格式漂移），不可外洩原始回應到 chat，改用固定備援訊息
const CHAT_FALLBACK_MESSAGE = '⚠️ 本週報告內容較長，Chat 摘要產生異常，請見下方 Drive 完整版。'
export function parseWeeklyReportResponse(data) {
  const rawText   = data.content?.find(b => b.type === 'text')?.text ?? '';
  const truncated = data.stop_reason === 'max_tokens';
  const mdMatch    = rawText.split('===MARKDOWN===')[1]?.split('===CHAT===')[0]?.trim();
  const chatMatch  = rawText.split('===CHAT===')[1]?.trim();
  const markdown   = mdMatch ?? rawText;
  const chat       = chatMatch ?? CHAT_FALLBACK_MESSAGE;
  return { markdown, chat, truncated, chatParsed: Boolean(chatMatch) };
}

export function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDate(d);
}

export async function uploadReportToDrive(filePath, fileName, folderId) {
  try {
    return await _driveUpload(filePath, fileName, folderId);
  } catch (err) {
    if (isAuthError(err)) {
      reAuthenticate();
      return await _driveUpload(filePath, fileName, folderId);
    }
    throw err;
  }
}

async function _driveUpload(filePath, fileName, folderId) {
  const accessToken = execSync('gcloud auth print-access-token').toString().trim();
  const authClient = new google.auth.OAuth2();
  authClient.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: 'v3', auth: authClient });

  const { data: { id: fileId } } = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType: 'text/plain', body: createReadStream(filePath) },
    fields: 'id',
  });

  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'domain', domain: 'eslite.com' },
  });

  return `https://drive.google.com/file/d/${fileId}/view`;
}

export function getDatesToProcess() {
  const dateArgs = []
  const args = process.argv
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) dateArgs.push(args[i + 1])
  }
  if (dateArgs.length > 0) return dateArgs

  const today = new Date();
  const isMonday = today.getDay() === 1;
  const daysBack = isMonday ? [3, 2, 1] : [1];
  return daysBack.map((n) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return formatDate(d);
  });
}
