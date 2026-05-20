// ─────────────────────────────────────────────
// seo-agent.js
// 使用方式：
//   npm run query 昨天 SSR P95 多少？
// ─────────────────────────────────────────────

import { toolDefinitions, executeTool, getDatesToProcess } from './tools.js'
import { buildQuerySystemPrompt } from './prompts.js'

// ── Agent Loop ─────────────────────────────────
async function runAgent(userMessage) {
  const dates    = getDatesToProcess()
  const messages = [{ role: 'user', content: userMessage }]
  let   iter     = 0
  const MAX_ITER = 15
  const model    = 'claude-sonnet-4-20250514'

  console.log(`\n🤖 SEO Agent 啟動`)
  console.log(`📅 處理日期：${dates.join('、')}\n`)

  while (iter < MAX_ITER) {
    iter++

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY 環境變數未設定')

    const body = JSON.stringify({
      model,
      max_tokens: 4096,
      system:     buildQuerySystemPrompt(dates),
      tools:      toolDefinitions,
      messages,
    })

    let response
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method:  'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         apiKey,
            'anthropic-version': '2023-06-01',
          },
          body,
        })
        break
      } catch (e) {
        if (attempt === 3) throw e
        console.warn(`  ⚠ API 連線失敗，第 ${attempt} 次重試... (${e.message})`)
        await new Promise(r => setTimeout(r, 3000 * attempt))
      }
    }

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`API 錯誤 ${response.status}: ${err}`)
    }

    const data = await response.json()

    // 任務完成
    if (data.stop_reason === 'end_turn') {
      const text = data.content.find(b => b.type === 'text')?.text ?? ''
      console.log('\n' + text)
      return text
    }

    // 呼叫工具
    if (data.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: data.content })

      const toolResults = []
      for (const block of data.content) {
        if (block.type !== 'tool_use') continue

        console.log(`🔧 ${block.name}`, JSON.stringify(block.input))
        let result
        try {
          result = await executeTool(block.name, block.input)
        } catch (e) {
          console.error(`  ✗ ${block.name} 失敗：${e.message}`)
          result = JSON.stringify({ error: e.message })
        }

        toolResults.push({
          type:        'tool_result',
          tool_use_id: block.id,
          content:     result,
        })
      }

      messages.push({ role: 'user', content: toolResults })
      continue
    }

    // 其他 stop_reason（max_tokens 等）
    console.warn(`⚠ 非預期 stop_reason: ${data.stop_reason}`)
    break
  }

  throw new Error('超過最大迭代次數，請檢查 agent 是否卡住')
}

// ── CLI 入口 ───────────────────────────────────
const userInput = process.argv.slice(2).join(' ')
if (!userInput) {
  console.error('請輸入查詢問題，例如：npm run query 昨天 SSR P95 多少？')
  process.exit(1)
}
runAgent(userInput).catch(err => {
  console.error('\n🚨 Agent 執行失敗：', err.message)
  if (err.cause) console.error('原因：', err.cause)
  process.exit(1)
})