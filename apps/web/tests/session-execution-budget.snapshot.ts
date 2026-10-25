import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { it,expect } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { launchWebScaffold } from './scaffold.ts'

// The recorded reply is shared with the text-turn scenario; this scenario pins
// the model-visible execution budget through the shipped Web profile layers.
it('persists and applies a public execution budget to a resident agent created outside the controller',async()=>{
  const dir=fileURLToPath(new URL('../../../snapshots/web/session-execution-budget/',import.meta.url))
  const scaffold=await launchWebScaffold({ replayFixture:join(dir,'session.v4.jsonl'),compareReplaySession:true })
  let handle: Awaited<ReturnType<typeof scaffold.ctx.agents.create>>|undefined
  try{
    handle=await scaffold.ctx.agents.create({ sessionId:SessionId('execution-budget-snapshot'),meta:{ cwd:scaffold.workspaceCwd },agentOptions:{ provider:'deepseek-official',model:'deepseek-v4-flash' } })
    await scaffold.ctx.sessionController.configureExecution({ sessionId:handle.agent.id,maxTokens:1024 })
    handle.agent.followup(createUserMessage({ content:[{ type:'text',text:'Reply with exactly: SDK snapshot OK' }],source:{ kind:'user' } }))
    await handle.agent.whenIdle()
    const events=handle.agent.session.snapshotEvents()
    const headers=events.filter(event=>event.type==='request/header')
    expect(headers.length).toBeGreaterThan(0)
    expect(headers.every(event=>event.data.header.config.maxTokens===1024)).toBe(true)
    const answer=events.filter(event=>event.type==='assistant/message').flatMap(event=>event.data.message.content.flatMap(block=>block.type==='text'?[block.text]:[])).join('')
    expect(answer).toBe('SDK snapshot OK')
    expect(events.at(-1)).toMatchObject({ type:'turn/end',data:{ reason:{ kind:'completed' } } })
  }finally{await handle?.dispose();await scaffold.close()}
},60000)
