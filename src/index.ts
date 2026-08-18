/**
 * dsh-ask-user-timeout: a guard plugin for DeepSeek Harness that gives the
 * model-facing `ask_user_question` tool a bounded lifetime.
 *
 * Background — why this plugin exists:
 *
 * When the model calls `ask_user_question`, the tool call parks the agent
 * loop until a human answers in the Web UI. The question is rendered only by
 * the live browser composer takeover (`ui-user-questions`); if no tab is
 * actively showing the session (tab closed, backgrounded overnight, mux
 * dropped), nothing renders the question and NOTHING ever times it out — the
 * turn stays "in progress" indefinitely, and the only exit is a manual stop
 * that surfaces a misleading `ASK_ABORTED`.
 *
 * This plugin wraps `ask_user_question`'s execution with a deadline (the same
 * cooperative `deadline()` primitive the shipped `timeout-policy` guard
 * uses). When the deadline wins, the tool returns a structured, model-visible
 * `ASK_TIMEOUT` result instead of hanging forever, so the loop can move on
 * and the model can re-ask or proceed.
 *
 * It is a guard plugin (like `dsh-tool-call-timeout-policy`): it only wraps
 * the tool's lifetime and never changes the tool's schema or behavior.
 *
 * @module dsh-ask-user-timeout
 */

import type { Context } from '@deepseek-ai/cordis'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** Structured error code this plugin owns (scoped: a nested upstream deadline reads as an ordinary cancel). */
export const ASK_TIMEOUT = 'ASK_TIMEOUT'

/** Cordis plugin name (the loader entry id in the profile patch). */
export const name = 'ask-user-timeout'

/** The tool registry service this plugin wraps (`tools/execute`) and reads (`get`). */
export const inject = ['tools']

/** Plugin configuration. */
export interface Config {
  /** Deadline in milliseconds for a pending ask_user_question (default 600000 = 10 min). */
  timeoutMs?: number
}

/**
 * The structured result substituted when this plugin's deadline wins: the
 * model sees a clear "question went unanswered" outcome rather than an
 * indefinite hang, and `error.code` carries {@link ASK_TIMEOUT} so a retry /
 * policy plugin can route on it.
 *
 * @param timeoutMs - the elapsed budget, rendered into the model-facing message.
 * @returns the `isError` {@link ToolExecutionResult} with an `ASK_TIMEOUT` error.
 */
function askTimeoutResult(timeoutMs: number): ToolExecutionResult {
  const message = `ask_user_question went unanswered for ${Math.round(timeoutMs / 1000)}s (timeout ${timeoutMs}ms)`
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: { message, info: { name: 'UserQuestionTimeout', code: ASK_TIMEOUT } },
  }
}

/**
 * Register the timeout wrapper for `ask_user_question`. The wrapper replaces
 * `exec.signal` with the fused deadline for dispatch, delegates, restores the
 * upstream signal, and substitutes the {@link ASK_TIMEOUT} result only when
 * THIS plugin's timer fired.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const timeoutMs = config.timeoutMs ?? 600_000
  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    if (exec.name !== 'ask_user_question') return next()

    using d = deadline(exec.signal, timeoutMs, ASK_TIMEOUT)
    const upstream = exec.signal
    exec.signal = d.signal
    try {
      const result = await next()
      // Only THIS plugin's timer (scoped by code) counts; a nested upstream
      // deadline reads as an ordinary cancel and its result passes through.
      if (timeoutOf(d.signal, ASK_TIMEOUT) !== undefined) {
        return askTimeoutResult(timeoutMs)
      }
      return result
    } finally {
      exec.signal = upstream
    }
  })
}
