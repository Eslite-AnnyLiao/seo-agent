// ─────────────────────────────────────────────
// daily-update.js
// 固定流程：fetch → upload → GAS → 每日分析
// ─────────────────────────────────────────────

import { writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { executeTool, getDatesToProcess } from './tools.js'
import { config } from './config.js'
import { buildDailyAnalysisPrompt, buildWeeklyAnalysisPrompt } from './prompts.js'

const DAILY_REPORTS_DIR  = resolve(config.analysisLogPath, 'reports', 'daily')
const WEEKLY_REPORTS_DIR = resolve(config.analysisLogPath, 'reports', 'weekly')

function saveReport(dir, filename, content) {
  mkdirSync(dir, { recursive: true })
  const path = resolve(dir, filename)
  writeFileSync(path, content, 'utf-8')
  console.log(`📄 報告已儲存：${path}`)
}

function extractSsrStats(jsonStr) {
  try {
    const d      = JSON.parse(jsonStr)
    const total  = d.data_source_stats?.valid_duration_records ?? d.data_source_stats?.total_records ?? 0
    const slow   = d.render_time_stats?.count_above_3000to5000ms ?? 0
    const abnorm = d.render_time_stats?.count_above_5000ms       ?? 0
    const slowRate   = total > 0 ? parseFloat((slow   / total * 100).toFixed(2)) : null
    const abnormRate = total > 0 ? parseFloat((abnorm / total * 100).toFixed(2)) : null
    return {
      total_records:          total,
      average_ms:             d.render_time_stats?.average_ms    ?? null,
      median_p50_ms:          d.render_time_stats?.median_p50_ms ?? null,
      p95_ms:                 d.render_time_stats?.p95_ms        ?? null,
      p99_ms:                 d.render_time_stats?.p99_ms        ?? null,
      max_ms:                 d.render_time_stats?.max_ms        ?? null,
      slow_render_rate_pct:   slowRate,
      abnormal_render_rate_pct: abnormRate,
      max_request_per_minute: d.per_minute_stats?.max_value      ?? null,
    }
  } catch { return null }
}

function extractCombinedStats(jsonStr) {
  try {
    const d          = JSON.parse(jsonStr)
    const ssrRecords  = d.data_source_stats?.ssr_records        ?? 0
    const cacheHitSsr = d.cloudflare_cache_hit?.total_ssr_hits  ?? 0
    const totalSsr    = ssrRecords + cacheHitSsr
    const cacheHitRate = totalSsr > 0
      ? parseFloat((cacheHitSsr / totalSsr * 100).toFixed(2))
      : null
    return {
      total_records:          d.data_source_stats?.total_records ?? null,
      ssg_records:            d.data_source_stats?.ssg_records   ?? null,
      ssr_records:            ssrRecords,
      max_request_per_minute: d.per_minute_stats?.max_value      ?? null,
      cache_hit_ssr:          cacheHitSsr,
      cache_hit_rate_pct:     cacheHitRate,
    }
  } catch { return null }
}

async function runDailyUpdate() {
  const dates = getDatesToProcess()
  const today = dates.at(-1)

  // 取上一個比較基準日（dates[0] 的前一天）
  const prevDay = new Date(dates[0].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))
  prevDay.setDate(prevDay.getDate() - 1)
  const prevDate = prevDay.toISOString().slice(0, 10).replace(/-/g, '')

  console.log(`\n📅 處理日期：${dates.join('、')}`)
  console.log(`📊 比較基準：${prevDate}\n`)

  // ── Step 1: 下載資料 ──────────────────────────
  console.log('▶ Step 1：下載資料')
  await executeTool('run_fetch', { dates })

  // ── Step 2: 上傳 Drive ────────────────────────
  console.log('▶ Step 2：上傳 Drive')
  const ssrUpload      = JSON.parse(await executeTool('upload_to_drive', { type: 'ssr',      dates }))
  const combinedUpload = JSON.parse(await executeTool('upload_to_drive', { type: 'combined', dates }))

  // ── Step 3: 觸發 GAS ──────────────────────────
  console.log('▶ Step 3：觸發 GAS')
  const ssrGas      = JSON.parse(await executeTool('trigger_gas', { type: 'ssr',      dates }))
  const combinedGas = JSON.parse(await executeTool('trigger_gas', { type: 'combined', dates }))

  // ── Step 4: 每日分析 ──────────────────────────
  console.log('▶ Step 4：每日分析\n')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 環境變數未設定')

  // 每個 date 各與前一天比較
  const sections = []
  for (const date of dates) {
    const prev = new Date(date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))
    prev.setDate(prev.getDate() - 1)
    const prevStr = prev.toISOString().slice(0, 10).replace(/-/g, '')

    const curSsr      = extractSsrStats(     await executeTool('read_json', { type: 'ssr',      date }))
    const curCombined = extractCombinedStats(await executeTool('read_json', { type: 'combined', date }))
    const prvSsr      = extractSsrStats(     await executeTool('read_json', { type: 'ssr',      date: prevStr }))
    const prvCombined = extractCombinedStats(await executeTool('read_json', { type: 'combined', date: prevStr }))

    const qd = config.rules.qualifying_day
    const isQualifying = (curCombined?.total_records ?? 0) > qd.min_requests
      && (curCombined?.max_request_per_minute ?? 0) > qd.min_peak_rpm

    sections.push(`【${date} vs ${prevStr}】
觀測達標日：${isQualifying ? '✅ 是' : '❌ 否（請求數或尖峰 RPM 未達門檻）'}
SSR 今日：${JSON.stringify(curSsr)}
SSR 前日：${JSON.stringify(prvSsr)}
Combined 今日：${JSON.stringify(curCombined)}
Combined 前日：${JSON.stringify(prvCombined)}`)
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages: [{
        role:    'user',
        content: buildDailyAnalysisPrompt(sections),
      }],
    }),
  })

  if (!res.ok) throw new Error(`API 錯誤 ${res.status}: ${await res.text()}`)

  const data     = await res.json()
  const rawText  = data.content.find(b => b.type === 'text')?.text ?? ''
  const mdMatch   = rawText.split('===MARKDOWN===')[1]?.split('===CHAT===')[0]?.trim()
  const chatMatch = rawText.split('===CHAT===')[1]?.trim()
  const markdown  = mdMatch   ?? rawText
  const chat      = chatMatch ?? rawText
  const summary = markdown

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`✅ SEO 每日更新完成`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`📁 上傳：SSR ${ssrUpload.count} 筆、Combined ${combinedUpload.count} 筆`)
  console.log(`⚙️  GAS SSR：${ssrGas.success ? '✅ 成功' : '❌ 失敗'}`)
  console.log(`⚙️  GAS Combined：${combinedGas.success ? '✅ 成功' : '❌ 失敗'}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log(summary)

  saveReport(DAILY_REPORTS_DIR, `daily-${today}.md`, summary)
}

// ── 週報（週五執行）────────────────────────────
async function runWeeklyReport() {
  console.log('\n📋 產出週報...\n')

  const apiKey = process.env.ANTHROPIC_API_KEY

  // 上週五到本週四（7 天）
  const weekDates = []
  for (let i = 7; i >= 1; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    weekDates.push(d.toISOString().slice(0, 10).replace(/-/g, ''))
  }

  const sections = []
  for (const date of weekDates) {
    const prev = new Date(date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))
    prev.setDate(prev.getDate() - 1)
    const prevStr = prev.toISOString().slice(0, 10).replace(/-/g, '')

    try {
      const curSsr      = extractSsrStats(     await executeTool('read_json', { type: 'ssr',      date }))
      const curCombined = extractCombinedStats(await executeTool('read_json', { type: 'combined', date }))
      const qd = config.rules.qualifying_day
      const isQualifying = (curCombined?.total_records ?? 0) > qd.min_requests
        && (curCombined?.max_request_per_minute ?? 0) > qd.min_peak_rpm

      sections.push(`【${date}】觀測達標日：${isQualifying ? '✅ 是' : '❌ 否'}
SSR：${JSON.stringify(curSsr)}
Combined：${JSON.stringify(curCombined)}`)
    } catch {
      sections.push(`【${date}】無資料`)
    }
  }

  const dateRange = `${weekDates[0]} ~ ${weekDates[weekDates.length - 1]}`
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages: [{ role: 'user', content: buildWeeklyAnalysisPrompt(sections, dateRange) }],
    }),
  })

  if (!res.ok) throw new Error(`週報 API 錯誤 ${res.status}: ${await res.text()}`)

  const data     = await res.json()
  const rawText  = data.content.find(b => b.type === 'text')?.text ?? ''
  const mdMatch   = rawText.split('===MARKDOWN===')[1]?.split('===CHAT===')[0]?.trim()
  const chatMatch = rawText.split('===CHAT===')[1]?.trim()
  const markdown  = mdMatch   ?? rawText
  const chat      = chatMatch ?? rawText

  saveReport(WEEKLY_REPORTS_DIR, `weekly-${weekDates[weekDates.length - 1]}.md`, markdown)

  if (config.googleChatWebhookUrl) {
    await sendToGoogleChat(`📋 *SEO 週報 ${dateRange}*\n\n${chat}`)
  }
}

async function sendToGoogleChat(text) {
  const res = await fetch(config.googleChatWebhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text }),
  })
  if (res.ok) {
    console.log('💬 已發送至 Google Chat')
  } else {
    console.warn(`⚠ Google Chat 發送失敗：${res.status}`)
  }
}

async function main() {
  await runDailyUpdate()

  const isFriday = new Date().getDay() === 5
  if (isFriday) {
    await runWeeklyReport()
  }
}

main().catch(err => {
  console.error('\n🚨 執行失敗：', err.message)
  if (err.cause) console.error('原因：', err.cause)
  process.exit(1)
})
