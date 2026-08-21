// ─────────────────────────────────────────────
// daily-update.js
// 固定流程：fetch → upload → GAS → 每日分析
// ─────────────────────────────────────────────

import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { executeTool, getDatesToProcess, uploadReportToDrive, extractBotName, loadSpecialEvents, isQualifyingDay, evaluateObservationWindow, dateRangeExclusiveStart, parseWeeklyReportResponse, shiftDates, buildCrawlerWow, average, buildSsrWow } from './tools.js'
import { config } from './config.js'
import { buildDailyAnalysisPrompt, buildWeeklyAnalysisPrompt } from './prompts.js'

const DAILY_REPORTS_DIR  = resolve(config.analysisLogPath, 'reports', 'daily')
const WEEKLY_REPORTS_DIR = resolve(config.analysisLogPath, 'reports', 'weekly')

// PAGE_KIND_KEYS = ['product', 'category', ...]，新增頁面類型不用改這份檔案的邏輯本體
const PAGE_KIND_KEYS = Object.keys(config.pageKinds)
const ALL_TYPES = [...PAGE_KIND_KEYS, 'combined']
const SSR_WOW_METRICS = ['p95_ms', 'p99_ms', 'abnormal_render_rate_pct', 'slow_render_rate_pct']

// 各頁面類型在 weekDates 這幾天的 SSR 效能週均值（忽略缺資料的日期）
async function aggregateSsrWeeklyAvg(weekDates) {
  const result = {}
  for (const kind of PAGE_KIND_KEYS) {
    const daily = []
    for (const date of weekDates) {
      const parsed = parseToolResult(await executeTool('read_json', { type: kind, date }))
      if (parsed) daily.push(parsed)
    }
    result[kind] = Object.fromEntries(
      SSR_WOW_METRICS.map(metric => [metric, average(daily.map(d => d[metric]))]),
    )
  }
  return result
}

function aggregateCrawlerStats(weekDates) {
  const totals = {}
  for (const date of weekDates) {
    try {
      const dir = resolve(config.analysisLogPath, config.combined.jsonPath)
      const file = readdirSync(dir).find(f => f.endsWith('.json') && f.includes(date))
      if (!file) continue
      const raw = JSON.parse(readFileSync(resolve(dir, file), 'utf-8'))
      for (const entry of raw.user_agent_analysis?.user_agent_ranking ?? []) {
        const bot = extractBotName(entry.userAgent)
        totals[bot] = (totals[bot] ?? 0) + entry.total
      }
    } catch { /* 跳過缺漏日期 */ }
  }

  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0)
  const classify = bot => {
    const b = bot.toLowerCase()
    if (b.includes('google')) return 'Google系'
    if (['chatgpt', 'gptbot', 'oai-searchbot', 'claudebot', 'youbot', 'perplexitybot'].some(x => b.includes(x))) return 'AI系'
    if (['ahrefsbot', 'mj12bot', 'semrushbot', 'dotbot', 'petalbot', 'rogerbot'].some(x => b.includes(x))) return 'SEO工具'
    return '其他'
  }

  const bots = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([bot, total]) => ({
      bot,
      group: classify(bot),
      total,
      pct: grandTotal > 0 ? parseFloat((total / grandTotal * 100).toFixed(1)) : 0,
    }))

  const groupTotals = {}
  for (const { group, total } of bots) groupTotals[group] = (groupTotals[group] ?? 0) + total

  return { bots, groupTotals, grandTotal }
}

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

function specialEventsBlock(date) {
  const events = loadSpecialEvents(date)
  if (events.length === 0) return ''
  return `\n已知特殊事件：\n${events.map(e => e.content).join('\n\n')}`
}

// 依 config.rules.rollout.start_date 到 uptoDate 之間每一天是否為觀測達標日，
// 算出觀察期進度（第幾天／累積幾個達標日）與是否已達 10 天停損點
async function getObservationWindowStatus(uptoDate) {
  const qd = config.rules.qualifying_day
  const startDate = config.rules.rollout.start_date.replace(/\//g, '')
  const dates = dateRangeExclusiveStart(startDate, uptoDate)
  const flags = []
  for (const d of dates) {
    const data = parseToolResult(await executeTool('read_json', { type: qd.page_kind, date: d }))
    flags.push(isQualifyingDay(data, qd))
  }
  return evaluateObservationWindow(flags, config.rules.rollout.observation_window_days, qd.target_count)
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
  const uploadResults = {}
  const gasResults = {}
  if (!skipToAnalysis) {
    console.log('▶ Step 2：上傳 Drive')
    for (const type of ALL_TYPES) {
      try {
        uploadResults[type] = JSON.parse(await executeTool('upload_to_drive', { type, dates }))
      } catch (e) {
        console.warn(`  ⚠ [${type}] 上傳失敗（可能尚未設定 Drive 資料夾）：${e.message}`)
      }
    }

    // ── Step 3: 觸發 GAS ──────────────────────────
    console.log('▶ Step 3：觸發 GAS')
    for (const type of ALL_TYPES) {
      try {
        gasResults[type] = JSON.parse(await executeTool('trigger_gas', { type, dates }))
      } catch (e) {
        console.warn(`  ⚠ [${type}] GAS 觸發失敗（可能尚未設定 Sheet）：${e.message}`)
      }
    }
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

    const curCombined = parseToolResult(await executeTool('read_json', { type: 'combined', date }))
    const prvCombined = parseToolResult(await executeTool('read_json', { type: 'combined', date: prevStr }))

    const perKindData = {}
    const perKindBlocks = []
    for (const kind of PAGE_KIND_KEYS) {
      const label = config.pageKinds[kind].label
      const cur = parseToolResult(await executeTool('read_json', { type: kind, date }))
      const prv = parseToolResult(await executeTool('read_json', { type: kind, date: prevStr }))
      perKindData[kind] = cur
      perKindBlocks.push(`${label} SSR 今日：${JSON.stringify(cur)}\n${label} SSR 前日：${JSON.stringify(prv)}`)
    }

    const qd = config.rules.qualifying_day
    const qdSource = perKindData[qd.page_kind] ?? curCombined
    const qdLabel = config.pageKinds[qd.page_kind]?.label ?? 'Combined'
    const isQualifying = isQualifyingDay(qdSource, qd)
    const windowStatus = await getObservationWindowStatus(date)
    const windowLine = `觀察期進度：第 ${windowStatus.daysElapsed}/${config.rules.rollout.observation_window_days} 天，累積 ${windowStatus.cumulativeQualifyingDays}/${qd.target_count} 個達標日`
      + (windowStatus.stopLossHit ? '（🚨 已達觀察期上限但未達標，建議人工檢討門檻或流量分配）' : '')

    sections.push(`【${date} vs ${prevStr}】
觀測達標日（依${qdLabel}）：${isQualifying ? '✅ 是' : '❌ 否（請求數或尖峰 RPM 未達門檻）'}
${windowLine}
${perKindBlocks.join('\n')}
Combined 今日：${JSON.stringify(curCombined)}
Combined 前日：${JSON.stringify(prvCombined)}${specialEventsBlock(date)}`)
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
    for (const type of ALL_TYPES) {
      const label = type === 'combined' ? 'Combined' : config.pageKinds[type].label
      const up = uploadResults[type]
      const gas = gasResults[type]
      console.log(`📁 上傳：${label} ${up ? `${up.count} 筆` : '⏭ 略過（尚未設定）'}`)
      console.log(`⚙️  GAS ${label}：${gas ? (gas.success ? '✅ 成功' : '❌ 失敗') : '⏭ 略過（尚未設定）'}`)
    }
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log(summary)

  const reportFileName = `daily-${today}.md`
  const reportPath = saveReport(DAILY_REPORTS_DIR, reportFileName, summary)

  const reportUrl = await uploadReportToDrive(reportPath, reportFileName, config.driveFolderIds.dailyReports)
  console.log(`☁️  日報已上傳：${reportUrl}`)
}

// ── 週報（週五執行）────────────────────────────
async function runWeeklyReport(baseDate = null) {
  console.log('\n📋 產出週報...\n')

  const authToken = process.env.ANTHROPIC_AUTH_TOKEN

  // 以 baseDate（或執行當下）為錨點，往前推 7 天
  const base = baseDate
    ? new Date(baseDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))
    : new Date()
  const weekDates = []
  for (let i = 7; i >= 1; i--) {
    const d = new Date(base)
    d.setDate(d.getDate() - i)
    weekDates.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`)
  }

  const sections = []
  for (const date of weekDates) {
    const prev = new Date(date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))
    prev.setDate(prev.getDate() - 1)
    const prevStr = `${prev.getFullYear()}${String(prev.getMonth() + 1).padStart(2, '0')}${String(prev.getDate()).padStart(2, '0')}`

    try {
      const curCombined = parseToolResult(await executeTool('read_json', { type: 'combined', date }))

      const perKindData = {}
      const perKindLines = []
      for (const kind of PAGE_KIND_KEYS) {
        const label = config.pageKinds[kind].label
        const cur = parseToolResult(await executeTool('read_json', { type: kind, date }))
        perKindData[kind] = cur
        perKindLines.push(`${label}：${JSON.stringify(cur)}`)
      }

      const qd = config.rules.qualifying_day
      const qdSource = perKindData[qd.page_kind] ?? curCombined
      const qdLabel = config.pageKinds[qd.page_kind]?.label ?? 'Combined'
      const isQualifying = isQualifyingDay(qdSource, qd)

      sections.push(`【${date}】觀測達標日（依${qdLabel}）：${isQualifying ? '✅ 是' : '❌ 否'}
${perKindLines.join('\n')}
Combined：${JSON.stringify(curCombined)}${specialEventsBlock(date)}`)
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

  const crawlerStats = aggregateCrawlerStats(weekDates)
  const prevWeekCrawlerStats = aggregateCrawlerStats(shiftDates(weekDates, 7))
  crawlerStats.wow = buildCrawlerWow(crawlerStats, prevWeekCrawlerStats)

  const ssrCurrentAvg  = await aggregateSsrWeeklyAvg(weekDates)
  const ssrPreviousAvg = await aggregateSsrWeeklyAvg(shiftDates(weekDates, 7))
  const ssrWow = buildSsrWow(ssrCurrentAvg, ssrPreviousAvg, SSR_WOW_METRICS)

  const dateRange = `${weekDates[0]} - ${weekDates[weekDates.length - 1]}`
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'Authorization':     'Bearer ' + authToken,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-4.6-sonnet',
      max_tokens: 12000,
      messages: [{ role: 'user', content: buildWeeklyAnalysisPrompt(sections, dateRange, gscData, crawlerStats, ssrWow) }],
    }),
  })

  if (!res.ok) throw new Error(`週報 API 錯誤 ${res.status}: ${await res.text()}`)

  const data = await res.json()
  const { markdown, chat, truncated, chatParsed } = parseWeeklyReportResponse(data)
  if (truncated) {
    console.warn('⚠️ 週報 API 回應被截斷（stop_reason=max_tokens），Chat 摘要將改用備援訊息，請檢查 Drive 完整版是否也不完整')
  }
  if (!chatParsed) {
    console.warn('⚠️ 週報回應找不到 ===CHAT=== 分隔標記，Chat 摘要將改用備援訊息')
  }

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
    const dateIdx = process.argv.indexOf('--date')
    const weeklyBase = dateIdx !== -1 ? process.argv[dateIdx + 1] : null
    await runWeeklyReport(weeklyBase)
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
