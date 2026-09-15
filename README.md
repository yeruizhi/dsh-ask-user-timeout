# dsh-ask-user-timeout

Guard plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): gives the model-facing `ask_user_question` tool a **bounded lifetime**, so a question that no browser tab renders cannot hang the agent loop forever.

## The bug this fixes

When the model calls `ask_user_question`, the tool call parks the loop until a human answers in the Web UI. The question is rendered **only** by the live browser composer takeover (`ui-user-questions`). If no tab is actively showing that session — tab closed, backgrounded overnight, mux connection dropped — nothing renders the question, and **nothing ever times it out**:

- the turn stays "in progress" indefinitely (no timeout, no re-notification, no visible error);
- the only exit is a manual stop, which surfaces a misleading `ASK_ABORTED` ("aborted before the user answered") even though the question was never shown to anyone.

This plugin wraps `ask_user_question`'s execution with a cooperative deadline (the same `deadline()` primitive the shipped `timeout-policy` guard uses). When the deadline wins, the tool returns a structured, model-visible **`ASK_TIMEOUT`** result instead of hanging forever — the loop moves on and the model can re-ask or proceed.

## Install

```sh
# public GitHub install (works without an npm account)
dsh plugin --profile web add git+https://github.com/yeruizhi/dsh-ask-user-timeout.git
```

Restart `dsh web`, then hard-refresh the browser. The wrapper applies to `ask_user_question` calls in sessions created after the plugin loads.

## Configuration

| key | default | meaning |
|---|---|---|
| `timeoutMs` | `600000` (10 min) | how long a pending `ask_user_question` may wait before it times out |

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: ask-user-timeout
      name: 'dsh-ask-user-timeout'
      config:
        timeoutMs: 300000
```

## How it works

- Listens on `tools/execute` (same extension point as the official `timeout-policy` guard).
- Only wraps tools named `ask_user_question`; everything else delegates unchanged.
- Swaps `exec.signal` for the fused deadline during dispatch, restores the upstream signal afterwards.
- On timeout, substitutes a result with `error.code = ASK_TIMEOUT`; a nested/upstream deadline reads as an ordinary cancel and passes through untouched.
- Does **not** change the tool's schema, output shape, or semantics.

## Scope

This is a guard plugin, not a fix to the Web UI rendering gap. It stops the *hang*; the deeper issue (a question nobody renders is never re-notified on tab return / reconnect) is tracked upstream in [deepseek-ai/deepseek-harness discussion #2929](https://github.com/deepseek-ai/deepseek-harness/discussions/2929).

## License

MIT
