import { describe, expect, it } from 'vitest'
import { apply, ASK_TIMEOUT } from '../src/index.ts'

type FakeExec = { name: string; signal: AbortSignal }

function makeCtx() {
  const listeners: Array<(exec: FakeExec, next: () => Promise<unknown>) => Promise<unknown>> = []
  return {
    on(ev: string, fn: (exec: FakeExec, next: () => Promise<unknown>) => Promise<unknown>) {
      if (ev === 'tools/execute') listeners.push(fn)
    },
    tools: { get() { return {} } },
    listeners,
  }
}

/** next that observes exec.signal (the wrapper-installed fused deadline) and settles on abort. */
function makeNext(exec: FakeExec, onAbortResult: unknown) {
  return () => new Promise<unknown>((resolve) => {
    if (exec.signal.aborted) return resolve(onAbortResult)
    exec.signal.addEventListener('abort', () => resolve(onAbortResult), { once: true })
  })
}

describe('dsh-ask-user-timeout wrapper', () => {
  it('passes non-ask tools through unchanged', async () => {
    const ctx = makeCtx() as never
    apply(ctx as never, { timeoutMs: 10_000 })
    const exec = { name: 'bash', signal: new AbortController().signal }
    const result = await ctx.listeners[0]!(exec, async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }))
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }], isError: false })
  })

  it('times out a never-answered ask_user_question with ASK_TIMEOUT', async () => {
    const ctx = makeCtx() as never
    apply(ctx as never, { timeoutMs: 150 })
    const exec = { name: 'ask_user_question', signal: new AbortController().signal }
    const result = await ctx.listeners[0]!(exec, makeNext(exec, { content: [{ type: 'text', text: 'aborted' }], isError: true }))
    expect((result as { error: { info: { code: string } } }).error.info.code).toBe(ASK_TIMEOUT)
  })

  it('passes a promptly answered ask_user_question through', async () => {
    const ctx = makeCtx() as never
    apply(ctx as never, { timeoutMs: 10_000 })
    const exec = { name: 'ask_user_question', signal: new AbortController().signal }
    const result = await ctx.listeners[0]!(exec, async () => ({ content: [{ type: 'text', text: 'answered' }], isError: false }))
    expect(result).toEqual({ content: [{ type: 'text', text: 'answered' }], isError: false })
  })

  it('passes an upstream abort (user stop) through without substituting ASK_TIMEOUT', async () => {
    const ctx = makeCtx() as never
    apply(ctx as never, { timeoutMs: 10_000 })
    const c = new AbortController()
    const exec = { name: 'ask_user_question', signal: c.signal }
    setTimeout(() => c.abort(), 20)
    const result = await ctx.listeners[0]!(exec, makeNext(exec, {
      content: [{ type: 'text', text: 'Error: aborted' }], isError: true,
      error: { message: 'aborted', info: { code: 'ASK_ABORTED' } },
    }))
    expect((result as { error: { info: { code: string } } }).error.info.code).toBe('ASK_ABORTED')
  })
})
