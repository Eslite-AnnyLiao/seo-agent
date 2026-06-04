// ─────────────────────────────────────────────
// daily-update.js
// 固定流程：fetch → upload → GAS → 每日分析
// ─────────────────────────────────────────────

import { writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { executeTool, getDatesToProcess, uploadReportToDrive } from './tools.js'
import { config } from './config.js'
import { buildDailyAnalysisPrompt, buildWeeklyAnalysisPrompt } from './prompts.js'

const DAILY_REPORTS_DIR  = resolve(config.analysisLogPath, 'reports', 'daily')
const WEEKLY_REPORTS_DIR = resolve(config.analysisLogPath, 'reports', 'weekly')


function saveReport(dir, filename, content) {
  mkdirSync(dir, { recursive: true })
  const path = resolve(dir, filename)
  writeFileSync(path, content, 'utf-8')
  console.log(`📄 報告已儲存：${path}`)
  return path
}

function parseToolResult(jsonStr) {
  try { return JSON.parse(jsonStr) } catch { return null }
}

async function runDailyUpdate(skipFetch = false, skipToAnalysis = false) {
  const dates = getDatesToProcess()
  const today = dates.at(-1)

  // 取上一個比較基準日（dates[0] 的前一天）
  const prevDay = new Date(dates[0].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))
  prevDay.setDate(prevDay.getDate() - 1)
  const prevDate = prevDay.toISOString().slice(0, 10).replace(/-/g, '')

  console.log(`\n📅 處理日期：${dates.join('、')}`)
  console.log(`📊 比較基準：${prevDate}\n`)

  // ── Step 1: 下載資料 ──────────────────────────
  if (!skipFetch) {
    console.log('▶ Step 1：下載資料')
    await executeTool('run_fetch', { dates })
  } else {
    console.log('⏭ Step 1：跳過下載')
  }

  // ── Step 2: 上傳 Drive ────────────────────────
  let ssrUpload, combinedUpload, ssrGas, combinedGas
  if (!skipToAnalysis) {
    console.log('▶ Step 2：上傳 Drive')
    ssrUpload      = JSON.parse(await executeTool('upload_to_drive', { type: 'ssr',      dates }))
    combinedUpload = JSON.parse(await executeTool('upload_to_drive', { type: 'combined', dates }))

    // ── Step 3: 觸發 GAS ──────────────────────────
    console.log('▶ Step 3：觸發 GAS')
    ssrGas      = JSON.parse(await executeTool('trigger_gas', { type: 'ssr',      dates }))
    combinedGas = JSON.parse(await executeTool('trigger_gas', { type: 'combined', dates }))
  } else {
    console.log('⏭ Step 2-3：跳過上傳與 GAS')
  }

  // ── Step 4: 每日分析 ──────────────────────────
  console.log('▶ Step 4：每日分析\n')

  const authToken = process.env.ANTHROPIC_AUTH_TOKEN
  if (!authToken) throw new Error('ANTHROPIC_AUTH_TOKEN 環境變數未設定')

  // 每個 date 各與前一天比較
  const sections = []
  for (const date of dates) {
    const prev = new Date(date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))
    prev.setDate(prev.getDate() - 1)
    const prevStr = prev.toISOString().slice(0, 10).replace(/-/g, '')

    const curSsr      = parseToolResult(await executeTool('read_json', { type: 'ssr',      date }))
    const curCombined = parseToolResult(await executeTool('read_json', { type: 'combined', date }))
    const prvSsr      = parseToolResult(await executeTool('read_json', { type: 'ssr',      date: prevStr }))
    const prvCombined = parseToolResult(await executeTool('read_json', { type: 'combined', date: prevStr }))

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

  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'Authorization':     'Bearer ' + authToken,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-4.6-sonnet',
      max_tokens: 5000,
      messages: [{
        role:    'user',
        content: buildDailyAnalysisPrompt(sections),
      }],
    }),
  })

  if (!res.ok) throw new Error(`API 錯誤 ${res.status}: ${await res.text()}`)

  const data    = await res.json()
  const summary = data.content.find(b => b.type === 'text')?.text?.trim() ?? ''

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`✅ SEO 每日更新完成`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  if (!skipToAnalysis) {
    console.log(`📁 上傳：SSR ${ssrUpload.count} 筆、Combined ${combinedUpload.count} 筆`)
    console.log(`⚙️  GAS SSR：${ssrGas.success ? '✅ 成功' : '❌ 失敗'}`)
    console.log(`⚙️  GAS Combined：${combinedGas.success ? '✅ 成功' : '❌ 失敗'}`)
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log(summary)

  const reportFileName = `daily-${today}.md`
  const reportPath = saveReport(DAILY_REPORTS_DIR, reportFileName, summary)

  const reportUrl = await uploadReportToDrive(reportPath, reportFileName, config.driveFolderIds.dailyReports)
  console.log(`☁️  日報已上傳：${reportUrl}`)
}

// ── 週報（週五執行）────────────────────────────
async function runWeeklyReport() {
  console.log('\n📋 產出週報...\n')

  const authToken = process.env.ANTHROPIC_AUTH_TOKEN

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
      const curSsr      = parseToolResult(await executeTool('read_json', { type: 'ssr',      date }))
      const curCombined = parseToolResult(await executeTool('read_json', { type: 'combined', date }))
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

  let gscData = null
  try {
    gscData = parseToolResult(await executeTool('read_gsc_sheet', {}))
  } catch {
    console.warn('⚠️ GSC Sheet 讀取失敗，週報將略過 GSC 分析')
  }

  const dateRange = `${weekDates[0]} ~ ${weekDates[weekDates.length - 1]}`
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'Authorization':     'Bearer ' + authToken,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-4.6-sonnet',
      max_tokens: 8000,
      messages: [{ role: 'user', content: buildWeeklyAnalysisPrompt(sections, dateRange, gscData) }],
    }),
  })

  if (!res.ok) throw new Error(`週報 API 錯誤 ${res.status}: ${await res.text()}`)

  const data     = await res.json()
  const rawText  = data.content.find(b => b.type === 'text')?.text ?? ''
  const mdMatch   = rawText.split('===MARKDOWN===')[1]?.split('===CHAT===')[0]?.trim()
  const chatMatch = rawText.split('===CHAT===')[1]?.trim()
  const markdown  = mdMatch   ?? rawText
  const chat      = chatMatch ?? rawText

  const reportFileName = `weekly-${weekDates[weekDates.length - 1]}.md`
  const reportPath = saveReport(WEEKLY_REPORTS_DIR, reportFileName, markdown)

  if (config.googleChatWebhookUrl) {
    const reportUrl = await uploadReportToDrive(reportPath, reportFileName, config.driveFolderIds.weeklyReports)
    await sendToGoogleChat(`📋 *SEO 週報 ${dateRange}*\n\n${chat}\n\n📄 詳細週報：${reportUrl}`)
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
  const skipFetch      = process.argv.includes('--from-upload')
  const skipToAnalysis = process.argv.includes('--analysis-only')
  const weeklyOnly     = process.argv.includes('--weekly')

  if (weeklyOnly) {
    await runWeeklyReport()
    return
  }

  await runDailyUpdate(skipFetch || skipToAnalysis, skipToAnalysis)

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
