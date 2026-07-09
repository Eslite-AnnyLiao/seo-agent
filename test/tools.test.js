import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isQualifyingDay, evaluateObservationWindow, dateRangeExclusiveStart } from '../tools.js'

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
