// ─────────────────────────────────────────────
// gas-webhook.gs
// 貼到 Google Apps Script 編輯器
// 部署成「網路應用程式」後把 URL 填進 config.js
//
// ssr sheet   → 貼到「商品頁 SSR 數據統計」的 GAS
// combined sheet → 貼到「全站流量總覽」的 GAS
// ─────────────────────────────────────────────

function doPost(e) {
  try {
    processSSRData()
    return respond({ success: true })
  } catch (err) {
    return respond({ success: false, error: err.message })
  }
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
}


// ===== SSR 設定區域 =====
const SSR_CONFIG = {
  FOLDER_ID: '1tFUlJhjyEEWBtfbAGKZqOCLLCOO3xXE_',
  SPREADSHEET_NAME: '商品頁 SSR 數據統計',
  HOURLY_SHEET_NAME: '每日每小時請求數',
  MINUTELY_SHEET_NAME: '每日每分鐘請求數',
  DAILY_SHEET_NAME: '每日資料',
  HISTORICAL_SPREADSHEET_ID: 'YOUR_HISTORICAL_SPREADSHEET_ID',
  HISTORICAL_SHEET_NAME: 'SSR商品頁歷史渲染率'
};

const SSR_THRESHOLDS = {
  SLOW_RENDER_MIN: 3000,
  SLOW_RENDER_MAX: 5000,
  ABNORMAL_MIN: 5000
};


// ============================================================
// 主要執行函式
// ============================================================

function processSSRData() {
  try {
    Logger.log('開始處理 SSR 數據...');

    const folder = DriveApp.getFolderById(SSR_CONFIG.FOLDER_ID);
    if (!folder) throw new Error(`找不到資料夾: ${SSR_CONFIG.FOLDER_ID}`);

    const spreadsheet = ssrFindSpreadsheet(SSR_CONFIG.SPREADSHEET_NAME);
    if (!spreadsheet) throw new Error(`找不到試算表: ${SSR_CONFIG.SPREADSHEET_NAME}`);

    const jsonFiles = ssrGetJsonFiles(folder);
    Logger.log(`找到 ${jsonFiles.length} 個 SSR JSON 檔案`);
    if (jsonFiles.length === 0) { Logger.log('沒有找到符合格式的檔案'); return; }

    const allHourlyData   = {};
    const allMinutelyData = {};
    const allDailyData    = {};

    jsonFiles.forEach(file => {
      const data = ssrParseJsonFile(file);
      if (!data) return;

      ssrMergeData(allHourlyData,   data.hourly_request_data   || {});
      ssrMergeData(allMinutelyData, data.minutely_request_data || {});

      const date = ssrFormatDateFromFilename(file.getName());
      if (date) {
        allDailyData[date] = ssrExtractDailyStats(data);
      }
    });

    ssrUpdateSheet(spreadsheet, SSR_CONFIG.HOURLY_SHEET_NAME,   allHourlyData,   'hourly');
    ssrUpdateSheet(spreadsheet, SSR_CONFIG.MINUTELY_SHEET_NAME, allMinutelyData, 'minutely');
    ssrUpdateDailySheet(spreadsheet, SSR_CONFIG.DAILY_SHEET_NAME, allDailyData);

    Logger.log('SSR 數據處理完成！');
  } catch (error) {
    Logger.log(`錯誤: ${error.message}`);
    throw error;
  }
}

function testSSRProcessing() {
  processSSRData();
}


// ============================================================
// 每日資料工作表
// ============================================================

function ssrUpdateDailySheet(spreadsheet, sheetName, dailyData) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    Logger.log(`建立新工作表: ${sheetName}`);
  }

  const headers = [
    '日期',
    '總 Render 數據',
    '平均值 (ms)',
    '中位數 P50 (ms)',
    'P95 (ms)',
    'P99 (ms)',
    '最大值 (ms)',
    `慢渲染 (${SSR_THRESHOLDS.SLOW_RENDER_MIN/1000}-${SSR_THRESHOLDS.SLOW_RENDER_MAX/1000}秒) 總數`,
    `異常渲染 (${SSR_THRESHOLDS.ABNORMAL_MIN/1000}秒以上) 總數`,
    '每分鐘 Request 最高值',
    '慢渲染率',
    '異常渲染率',
    '慢渲染率 7日平均差值',
    '異常渲染率 7日平均差值'
  ];

  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const dates = Object.keys(dailyData).sort((a, b) => new Date(a) - new Date(b));

  const historicalData = ssrReadHistoricalData(
    SSR_CONFIG.HISTORICAL_SPREADSHEET_ID,
    SSR_CONFIG.HISTORICAL_SHEET_NAME
  );

  const dataWithMovingAvg = ssrCalculateMovingAverageDiff(dailyData, dates, historicalData);

  const sheetData = dates.map(date => {
    const s   = dailyData[date];
    const avg = dataWithMovingAvg[date];
    return [
      date,
      s.totalRender,
      s.average,
      s.medianP50,
      s.p95,
      s.p99,
      s.maxValue,
      s.slowRender3to5,
      s.abnormalRender5plus,
      s.maxRequestPerMinute,
      `${s.slowRenderRate}%`,
      `${s.abnormalRenderRate}%`,
      avg.slowRenderRateDiff    !== null ? `${avg.slowRenderRateDiff.toFixed(2)}%`    : 'N/A',
      avg.abnormalRenderRateDiff !== null ? `${avg.abnormalRenderRateDiff.toFixed(2)}%` : 'N/A'
    ];
  });

  if (sheetData.length > 0) {
    sheet.getRange(2, 1, sheetData.length, headers.length).setValues(sheetData);
  }

  ssrFormatDailySheet(sheet, headers.length, sheetData.length + 1);
  Logger.log(`${sheetName}: 已更新 ${dates.length} 天的數據`);
}


// ============================================================
// 核心資料處理
// ============================================================

function ssrExtractDailyStats(data) {
  const stats = {
    totalRender: 0,
    average: 0,
    medianP50: 0,
    p95: 0,
    p99: 0,
    maxValue: 0,
    slowRender3to5: 0,
    abnormalRender5plus: 0,
    maxRequestPerMinute: 0,
    slowRenderRate: 0,
    abnormalRenderRate: 0
  };

  try {
    if (data.data_source_stats) {
      stats.totalRender =
        data.data_source_stats.valid_duration_records ||
        data.data_source_stats.total_records ||
        0;
    }

    if (data.render_time_stats) {
      const r = data.render_time_stats;
      stats.average   = r.average_ms    || 0;
      stats.medianP50 = r.median_p50_ms || 0;
      stats.p95       = r.p95_ms        || 0;
      stats.p99       = r.p99_ms        || 0;
      stats.maxValue  = r.max_ms        || 0;

      stats.slowRender3to5      = r.count_above_3000to5000ms || 0;
      stats.abnormalRender5plus = r.count_above_5000ms       || 0;
    }

    if (data.per_minute_stats) {
      stats.maxRequestPerMinute = data.per_minute_stats.max_value || 0;
    }

    if (stats.totalRender > 0) {
      stats.slowRenderRate     = (stats.slowRender3to5      / stats.totalRender * 100).toFixed(2);
      stats.abnormalRenderRate = (stats.abnormalRender5plus / stats.totalRender * 100).toFixed(2);
    }

  } catch (error) {
    Logger.log(`提取 SSR 每日統計時發生錯誤: ${error.message}`);
  }

  return stats;
}

function ssrCalculateMovingAverageDiff(dailyData, sortedDates, historicalData = {}) {
  const result = {};
  const windowSize = 7;

  const allData = {};
  Object.keys(historicalData).forEach(date => {
    allData[date] = {
      slowRenderRate:     historicalData[date].slowRenderRate,
      abnormalRenderRate: historicalData[date].abnormalRenderRate
    };
  });
  Object.keys(dailyData).forEach(date => {
    allData[date] = {
      slowRenderRate:     parseFloat(dailyData[date].slowRenderRate),
      abnormalRenderRate: parseFloat(dailyData[date].abnormalRenderRate)
    };
  });

  const allDates = Object.keys(allData).sort((a, b) => new Date(a) - new Date(b));
  Logger.log(`7日移動平均計算：共 ${allDates.length} 天，範圍 ${allDates[0]} ~ ${allDates[allDates.length - 1]}`);

  sortedDates.forEach(date => {
    const idx = allDates.indexOf(date);

    if (idx === -1 || idx < windowSize) {
      result[date] = { slowRenderRateDiff: null, abnormalRenderRateDiff: null };
      Logger.log(`${date}: 數據不足，無法計算 7 日平均差值`);
      return;
    }

    let slowSum = 0, abnormalSum = 0;
    for (let i = idx - windowSize; i < idx; i++) {
      const d = allDates[i];
      slowSum     += allData[d].slowRenderRate;
      abnormalSum += allData[d].abnormalRenderRate;
    }

    const slowAvg     = slowSum     / windowSize;
    const abnormalAvg = abnormalSum / windowSize;
    const curSlow     = allData[date].slowRenderRate;
    const curAbnormal = allData[date].abnormalRenderRate;

    result[date] = {
      slowRenderRateDiff:     curSlow     - slowAvg,
      abnormalRenderRateDiff: curAbnormal - abnormalAvg
    };

    Logger.log(`${date}: 慢渲染率 ${curSlow.toFixed(2)}% vs 7日均值 ${slowAvg.toFixed(2)}% = ${result[date].slowRenderRateDiff.toFixed(2)}%`);
    Logger.log(`${date}: 異常渲染率 ${curAbnormal.toFixed(2)}% vs 7日均值 ${abnormalAvg.toFixed(2)}% = ${result[date].abnormalRenderRateDiff.toFixed(2)}%`);
  });

  return result;
}


// ============================================================
// 歷史數據讀取
// ============================================================

function ssrReadHistoricalData(spreadsheetId, sheetName) {
  if (!spreadsheetId || spreadsheetId === 'YOUR_HISTORICAL_SPREADSHEET_ID') {
    Logger.log('⚠️ 未設定歷史數據 Spreadsheet ID，跳過歷史數據讀取');
    return {};
  }

  try {
    const ss    = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`⚠️ 找不到歷史工作表: ${sheetName}`);
      return {};
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return {};

    const rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    const result = {};

    rows.forEach((row) => {
      const rawDate = row[0];
      if (!rawDate) return;

      const dateStr = rawDate instanceof Date
        ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : rawDate.toString().trim();

      const parseRate = val => {
        if (typeof val === 'string' && val.includes('%')) return parseFloat(val.replace('%', '').trim());
        if (typeof val === 'number') return val < 1 ? val * 100 : val;
        return 0;
      };

      result[dateStr] = {
        slowRenderRate:     parseRate(row[1]),
        abnormalRenderRate: parseRate(row[2])
      };
    });

    const dates = Object.keys(result).sort((a, b) => new Date(a) - new Date(b));
    Logger.log(`歷史數據：共 ${dates.length} 筆，範圍 ${dates[0]} ~ ${dates[dates.length - 1]}`);
    return result;

  } catch (error) {
    Logger.log(`❌ 讀取歷史數據失敗: ${error.message}`);
    return {};
  }
}


// ============================================================
// 每小時 / 每分鐘工作表
// ============================================================

function ssrUpdateSheet(spreadsheet, sheetName, data, type) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol > 0 ? lastCol : 1).clear();
  }

  const processed = ssrProcessDataForSheet(data);
  if (processed.dates.length === 0) {
    Logger.log(`${sheetName}: 沒有數據`);
    return;
  }

  const headers    = ['', ...processed.dates];
  const timeLabels = type === 'hourly' ? ssrGenerateHourlyLabels() : ssrGenerateMinutelyLabels();

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const sheetData = timeLabels.map(time => {
    const row = [time];
    processed.dates.forEach(date => {
      row.push(processed.dataMap[`${date} ${time}`] || 0);
    });
    return row;
  });

  if (sheetData.length > 0) {
    sheet.getRange(2, 1, sheetData.length, sheetData[0].length).setValues(sheetData);
  }

  ssrFormatSheet(sheet, headers.length, sheetData.length + 1);
  Logger.log(`${sheetName}: 已更新 ${processed.dates.length} 天的數據`);
}

function ssrProcessDataForSheet(data) {
  const dates   = new Set();
  const dataMap = {};
  Object.keys(data).forEach(ts => {
    const [date, time] = ts.split(' ');
    if (date && time) {
      dates.add(date);
      dataMap[ts] = data[ts];
    }
  });
  return {
    dates:   Array.from(dates).sort((a, b) => new Date(b) - new Date(a)),
    dataMap
  };
}

function ssrGenerateHourlyLabels() {
  return Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0') + ':00');
}

function ssrGenerateMinutelyLabels() {
  const labels = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m++) {
      labels.push(`${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`);
    }
  }
  return labels;
}


// ============================================================
// 格式化
// ============================================================

function ssrFormatDailySheet(sheet, numCols, numRows) {
  const headerRange = sheet.getRange(1, 1, 1, numCols);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1a73e8');
  headerRange.setFontColor('#ffffff');
  headerRange.setHorizontalAlignment('center');

  if (numRows <= 1) return;

  sheet.getRange(2, 1, numRows - 1, 1).setFontWeight('bold').setBackground('#e8f0fe');
  sheet.getRange(2, 2, numRows - 1, 1).setNumberFormat('#,##0');
  sheet.getRange(2, 3, numRows - 1, 5).setNumberFormat('#,##0.00');
  sheet.getRange(2, 8, numRows - 1, 3).setNumberFormat('#,##0');
  sheet.getRange(2, 11, numRows - 1, 2).setHorizontalAlignment('center');
  sheet.getRange(2, 13, numRows - 1, 2).setHorizontalAlignment('center');

  ssrApplyConditionalFormatting(sheet, numRows);

  sheet.getRange(1, 1, numRows, numCols).setBorder(true, true, true, true, true, true);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  sheet.setColumnWidth(1, 100);
  for (let i = 2; i <= numCols; i++) sheet.setColumnWidth(i, 130);
}

function ssrApplyConditionalFormatting(sheet, numRows) {
  if (numRows <= 1) return;
  sheet.clearConditionalFormatRules();

  const rules = [];
  [13, 14].forEach(col => {
    const colLetter = col === 13 ? 'M' : 'N';
    const range = sheet.getRange(2, col, numRows - 1, 1);

    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=AND(NOT(ISBLANK(${colLetter}2)), ${colLetter}2<>"N/A", VALUE(SUBSTITUTE(${colLetter}2,"%",""))>0)`)
        .setBackground('#ffcccc')
        .setRanges([range])
        .build()
    );
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=AND(NOT(ISBLANK(${colLetter}2)), ${colLetter}2<>"N/A", VALUE(SUBSTITUTE(${colLetter}2,"%",""))<0)`)
        .setBackground('#ccffcc')
        .setRanges([range])
        .build()
    );
  });

  sheet.setConditionalFormatRules(rules);
}

function ssrFormatSheet(sheet, numCols, numRows) {
  sheet.getRange(1, 1, 1, numCols).setFontWeight('bold').setBackground('#f0f0f0');
  sheet.getRange(2, 1, numRows - 1, 1).setFontWeight('bold').setBackground('#f8f8f8');
  sheet.getRange(1, 1, numRows, numCols).setBorder(true, true, true, true, true, true);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  sheet.autoResizeColumns(1, numCols);
}


// ============================================================
// 工具函式
// ============================================================

function ssrFindSpreadsheet(name) {
  const files = DriveApp.getFilesByName(name);
  return files.hasNext() ? SpreadsheetApp.openById(files.next().getId()) : null;
}

function ssrGetJsonFiles(folder) {
  const files   = folder.getFiles();
  const pattern = /^ssr-product-log-\d{8}_analysis\.json$/;
  const result  = [];

  while (files.hasNext()) {
    const file = files.next();
    if (pattern.test(file.getName())) {
      Logger.log(`找到 SSR 檔案: ${file.getName()}`);
      result.push(file);
    }
  }
  return result;
}

function ssrParseJsonFile(file) {
  try {
    const data = JSON.parse(file.getBlob().getDataAsString());
    Logger.log(`成功解析: ${file.getName()}`);
    return data;
  } catch (error) {
    Logger.log(`解析失敗 ${file.getName()}: ${error.message}`);
    return null;
  }
}

function ssrMergeData(target, source) {
  Object.keys(source).forEach(k => { target[k] = source[k]; });
}

function ssrFormatDateFromFilename(filename) {
  const match = filename.match(/ssr-product-log-(\d{8})_analysis/);
  if (!match) { Logger.log(`無法從檔名提取日期: ${filename}`); return null; }
  const d = match[1];
  return `${d.substring(0,4)}-${d.substring(4,6)}-${d.substring(6,8)}`;
}

function ssrTestFilenameMatching() {
  const folder  = DriveApp.getFolderById(SSR_CONFIG.FOLDER_ID);
  const files   = folder.getFiles();
  const pattern = /^ssr-product-log-\d{8}_analysis\.json$/;
  let matched = 0, total = 0;

  while (files.hasNext()) {
    const file = files.next();
    total++;
    if (pattern.test(file.getName())) {
      matched++;
      Logger.log(`✅ ${file.getName()} → ${ssrFormatDateFromFilename(file.getName())}`);
    } else {
      Logger.log(`❌ 不匹配: ${file.getName()}`);
    }
  }
  Logger.log(`結果：${total} 個檔案，匹配 ${matched} 個`);
}
