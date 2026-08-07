import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isQualifyingDay, evaluateObservationWindow, dateRangeExclusiveStart, parseWeeklyReportResponse, isAuthError, shiftDates, calcWowChangePct, buildCrawlerWow, average, buildSsrWow } from '../tools.js'

const qd = { min_requests: 350000, min_peak_rpm: 1300 }

test('isQualifyingDay：兩項門檻同時滿足才算達標', () => {
  assert.equal(isQualifyingDay({ total_records: 424992, max_request_per_minute: 1492 }, qd), true)
  assert.equal(isQualifyingDay({ total_records: 341945, max_request_per_minute: 1573 }, qd), false) // 請求數不足
  assert.equal(isQualifyingDay({ total_records: 433939, max_request_per_minute: 713 }, qd), false)  // RPM 不足
  assert.equal(isQualifyingDay(null, qd), false) // 資料缺失時視為未達標，不拋錯
})

test('dateRangeExclusiveStart：回傳 startDate 隔天到 endDate（含）的日期，起始日排除', () => {
  assert.deepEqual(
    dateRangeExclusiveStart('20260630', '20260704'),
    ['20260701', '20260702', '20260703', '20260704'],
  )
  assert.deepEqual(dateRangeExclusiveStart('20260630', '20260630'), [])
})

test('evaluateObservationWindow：累積滿 target_count 即達標，不受 stop-loss 影響', () => {
  const flags = [false, false, true, true, true, true, true] // 7 天內累積 5 個達標日
  const status = evaluateObservationWindow(flags, 10, 5)
  assert.equal(status.daysElapsed, 7)
  assert.equal(status.cumulativeQualifyingDays, 5)
  assert.equal(status.targetReached, true)
  assert.equal(status.stopLossHit, false)
})

test('isAuthError：認得 scope 不足（insufficient permission）與既有的 reauth 類錯誤', () => {
  assert.equal(isAuthError(new Error('Insufficient Permission')), true)
  assert.equal(isAuthError(new Error('ACCESS_TOKEN_SCOPE_INSUFFICIENT: Insufficient Permission')), true)
  assert.equal(isAuthError(new Error('invalid_grant')), true)
  assert.equal(isAuthError(new Error('reauth required')), true)
  assert.equal(isAuthError(new Error('Not Found')), false)
})

test('evaluateObservationWindow：滿 10 天但未達標 → 觸發停損', () => {
  const flags = [false, false, false, false, false, false, false, false, false, true] // 10 天只中 1
  const status = evaluateObservationWindow(flags, 10, 5)
  assert.equal(status.daysElapsed, 10)
  assert.equal(status.cumulativeQualifyingDays, 1)
  assert.equal(status.targetReached, false)
  assert.equal(status.stopLossHit, true)
})

test('evaluateObservationWindow：邊界值——第 10 天當天累積剛好達標，不算停損', () => {
  const flags = new Array(5).fill(false).concat(new Array(5).fill(true)) // 10 天，剛好 5 個達標
  const status = evaluateObservationWindow(flags, 10, 5)
  assert.equal(status.daysElapsed, 10)
  assert.equal(status.cumulativeQualifyingDays, 5)
  assert.equal(status.targetReached, true)
  assert.equal(status.stopLossHit, false)
})

test('evaluateObservationWindow：未滿 10 天、未達標 → 尚未停損，仍在觀察', () => {
  const flags = [false, false, true] // 第 3 天，累積 1 個
  const status = evaluateObservationWindow(flags, 10, 5)
  assert.equal(status.stopLossHit, false)
  assert.equal(status.targetReached, false)
})

test('parseWeeklyReportResponse：正常回應——完整切出 markdown 與 chat 兩段', () => {
  const data = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '===MARKDOWN===\n完整週報內容\n===CHAT===\n精簡摘要內容' }],
  }
  const result = parseWeeklyReportResponse(data)
  assert.equal(result.markdown, '完整週報內容')
  assert.equal(result.chat, '精簡摘要內容')
  assert.equal(result.truncated, false)
  assert.equal(result.chatParsed, true)
})

test('parseWeeklyReportResponse：stop_reason=max_tokens 截斷、===CHAT=== 從未出現 → chat 改用備援訊息，不外洩原始回應', () => {
  // 模擬本次事故：模型還在寫 MARKDOWN 表格時就被截斷，rawText 含前言、字面 ===MARKDOWN=== 標記、表格，但沒有 ===CHAT===
  const rawText = '我先整理本週數據，進行異常判斷，再輸出週報。\n\n===MARKDOWN===\n## 週報\n| P95 | 2148 |\n分類頁 404 Rate = **'
  const data = {
    stop_reason: 'max_tokens',
    content: [{ type: 'text', text: rawText }],
  }
  const result = parseWeeklyReportResponse(data)
  assert.equal(result.truncated, true)
  assert.equal(result.chatParsed, false)
  assert.doesNotMatch(result.chat, /===MARKDOWN===/) // 不可外洩字面分隔標記
  assert.doesNotMatch(result.chat, /我先整理本週數據/) // 不可外洩模型前言
  assert.doesNotMatch(result.chat, /\|/) // 不可外洩表格語法
})

test('parseWeeklyReportResponse：非截斷但格式漂移、===CHAT=== 仍缺席 → 同樣改用備援訊息', () => {
  const data = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '===MARKDOWN===\n完整週報內容（模型忘了輸出分隔標記後面的段落）' }],
  }
  const result = parseWeeklyReportResponse(data)
  assert.equal(result.truncated, false)
  assert.equal(result.chatParsed, false)
  assert.doesNotMatch(result.chat, /完整週報內容/)
})

test('shiftDates：整批位移 7 天，用於算上週同期日期', () => {
  assert.deepEqual(
    shiftDates(['20260731', '20260801'], 7),
    ['20260724', '20260725'],
  )
})

test('calcWowChangePct：計算週對週變化率，上週基準為 0 或任一邊缺資料時回傳 null 避免誤算', () => {
  assert.equal(calcWowChangePct(95148, 84700), 12.3)
  assert.equal(calcWowChangePct(80, 100), -20)
  assert.equal(calcWowChangePct(100, 0), null)
  assert.equal(calcWowChangePct(0, 0), null)
  assert.equal(calcWowChangePct(null, 2000), null) // 本週缺資料，不可讓 null 被當 0 算出誤導的變化率
  assert.equal(calcWowChangePct(2000, null), null) // 上週缺資料
})

test('average：忽略缺資料的日期取平均，全部缺值回傳 null', () => {
  assert.equal(average([2000, 2200, 2400]), 2200)
  assert.equal(average([2000, null, 2400, undefined]), 2200) // 中間缺一天不拉低平均
  assert.equal(average([null, undefined]), null)
  assert.equal(average([]), null)
})

test('buildCrawlerWow：合併本週／上週分類統計，算出總量與各分類的變化率', () => {
  const current  = { grandTotal: 95148, groupTotals: { 'Google系': 80000, 'AI系': 700, 'SEO工具': 5000 } }
  const previous = { grandTotal: 84700, groupTotals: { 'Google系': 75000, 'AI系': 500 } } // 上週沒有 SEO工具分類
  const wow = buildCrawlerWow(current, previous)
  assert.equal(wow.grandTotal.changePct, 12.3)
  assert.equal(wow.groups['AI系'].current, 700)
  assert.equal(wow.groups['AI系'].previous, 500)
  assert.equal(wow.groups['AI系'].changePct, 40)
  assert.equal(wow.groups['SEO工具'].previous, 0)
  assert.equal(wow.groups['SEO工具'].changePct, null) // 上週基準為 0
})

test('buildSsrWow：合併本週／上週各頁面類型的 SSR 週均值，算出各指標的變化率', () => {
  const metrics  = ['p95_ms', 'abnormal_render_rate_pct']
  const current  = { product: { p95_ms: 2200, abnormal_render_rate_pct: 1.5 }, category: { p95_ms: 1800, abnormal_render_rate_pct: 0.5 } }
  const previous = { product: { p95_ms: 2000, abnormal_render_rate_pct: 1.0 }, category: { p95_ms: null, abnormal_render_rate_pct: null } } // 分類頁上週缺資料
  const wow = buildSsrWow(current, previous, metrics)
  assert.equal(wow.product.p95_ms.changePct, 10) // 效能變差 10%
  assert.equal(wow.product.abnormal_render_rate_pct.changePct, 50)
  assert.equal(wow.category.p95_ms.changePct, null) // 上週缺資料，不可誤算
})
