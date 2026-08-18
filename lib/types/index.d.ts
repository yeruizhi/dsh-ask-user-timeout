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
import type { Context } from '@deepseek-ai/cordis';
/** Structured error code this plugin owns (scoped: a nested upstream deadline reads as an ordinary cancel). */
export declare const ASK_TIMEOUT = "ASK_TIMEOUT";
/** Cordis plugin name (the loader entry id in the profile patch). */
export declare const name = "ask-user-timeout";
/** The tool registry service this plugin wraps (`tools/execute`) and reads (`get`). */
export declare const inject: string[];
/** Plugin configuration. */
export interface Config {
    /** Deadline in milliseconds for a pending ask_user_question (default 600000 = 10 min). */
    timeoutMs?: number;
}
/**
 * Register the timeout wrapper for `ask_user_question`. The wrapper replaces
 * `exec.signal` with the fused deadline for dispatch, delegates, restores the
 * upstream signal, and substitutes the {@link ASK_TIMEOUT} result only when
 * THIS plugin's timer fired.
 */
export declare function apply(ctx: Context, config?: Config): void;
