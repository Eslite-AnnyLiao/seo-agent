// ─────────────────────────────────────────────
// tools.js
// 工具定義 + 執行邏輯
// ─────────────────────────────────────────────

import { execSync } from 'child_process';
import { readdirSync, readFileSync, createReadStream } from 'fs';
import { resolve } from 'path';
import { google } from 'googleapis';
import { config } from './config.js';

// ── 工具定義（傳給 Claude API）─────────────────
export const toolDefinitions = [
  {
    name: 'run_fetch',
    description: [
      '執行 daily-pipeline.js，每個日期各跑一次。',
      '指令格式：node daily-pipeline.js --date YYYYMMDD',
      '每次執行會同時產生 ssr 和 combined 兩組 json。',
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
    description: '把 ssr 或 combined 目錄下指定日期的 json 上傳到對應的 Google Drive 資料夾',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['ssr', 'combined'],
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
          enum: ['ssr', 'combined'],
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
    description: '讀取 ssr 或 combined 的 json 資料，用來回答 SEO 查詢問題',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['ssr', 'combined'],
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
];

// ── 認證工具 ───────────────────────────────────
function isAuthError(err) {
  const msg = (err.message ?? JSON.stringify(err)).toLowerCase();
  return msg.includes('invalid_rapt') || msg.includes('invalid_grant') || msg.includes('reauth');
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
      const generated = { ssr: [], combined: [] };

      for (const date of dates) {
        const cmd = `node ${config.pipelineScript} --date ${date}`;
        console.log(`▶ ${cmd}`);
        execSync(cmd, { stdio: 'inherit' });
      }

      // 確認兩個目錄的產出
      for (const type of ['ssr', 'combined']) {
        const dir = resolve(config.analysisLogPath, config.jsonPaths[type]);
        generated[type] = readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => resolve(dir, f));
      }

      return JSON.stringify({ success: true, dates, files: generated });
    }

    case 'upload_to_drive': {
      const { type, dates } = input;
      const accessToken = execSync('gcloud auth print-access-token').toString().trim();
      const authClient = new google.auth.OAuth2();
      authClient.setCredentials({ access_token: accessToken });
      const drive = google.drive({ version: 'v3', auth: authClient });

      const dir = resolve(config.analysisLogPath, config.jsonPaths[type]);
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.json') && dates.some((d) => f.includes(d)));

      const uploaded = [];
      for (const fileName of files) {
        const filePath = resolve(dir, fileName);
        const res = await drive.files.create({
          requestBody: {
            name: fileName,
            parents: [config.driveFolderIds[type]],
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
            parents: [config.seoAgentFolderIds[type]],
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
      const { gasWebhookUrl, sheetName, spreadsheetId } = config.sheets[type];

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
      const dir = resolve(config.analysisLogPath, config.jsonPaths[type]);
      const allFiles = readdirSync(dir).filter((f) => f.endsWith('.json'));
      const target = date
        ? allFiles.find((f) => f.includes(date))
        : allFiles.sort().at(-1);

      if (!target) return JSON.stringify({ error: `找不到 json 檔（${type}${date ? ` ${date}` : ''}）` });

      const raw = JSON.parse(readFileSync(resolve(dir, target), 'utf-8'));

      if (type === 'ssr') {
        const total  = raw.data_source_stats?.valid_duration_records ?? raw.data_source_stats?.total_records ?? 0
        const slow   = raw.render_time_stats?.count_above_3000to5000ms ?? 0
        const abnorm = raw.render_time_stats?.count_above_5000ms       ?? 0
        return JSON.stringify({
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
        })
      }

      if (type === 'combined') {
        const ssrRecords  = raw.data_source_stats?.ssr_records       ?? 0
        const cacheHitSsr = raw.cloudflare_cache_hit?.total_ssr_hits ?? 0
        const totalSsr    = ssrRecords + cacheHitSsr
        return JSON.stringify({
          date:                   target.match(/\d{8}/)?.[0],
          total_records:          raw.data_source_stats?.total_records ?? null,
          ssg_records:            raw.data_source_stats?.ssg_records   ?? null,
          ssr_records:            ssrRecords,
          max_request_per_minute: raw.per_minute_stats?.max_value      ?? null,
          cache_hit_ssr:          cacheHitSsr,
          cache_hit_rate_pct:     totalSsr > 0 ? parseFloat((cacheHitSsr / totalSsr * 100).toFixed(2)) : null,
        })
      }

      return JSON.stringify({ error: `未知 type: ${type}` });
    }

    default:
      return JSON.stringify({ error: `未知工具: ${name}` });
  }
}

// ── 日期工具 ───────────────────────────────────
function formatDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
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
