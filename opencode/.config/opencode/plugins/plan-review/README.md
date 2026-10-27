# Automatic Plan review (OpenCode V2)

No slash command is needed to submit an initial plan. The server companion injects a plan-ready protocol and a
`plan_review_submit` tool into Plan's model context. Plan submits the full Markdown once as tool input; the tool saves
it as an immutable, private revision under `~/.opencode/plan/review/` and returns a compact revision receipt. Submitted
Markdown is trimmed at its
outer edges before hashing and saving. The final assistant response contains
only that receipt and `<!-- opencode-plan-ready -->`, not a repeated copy of the plan. A server RPC serves the exact
revision to the TUI and verifies its session, originating Plan turn, and content hash. The TUI opens a scrollable
session panel with themed saved Markdown and visible **Approve and build** / **Request changes** actions (`Ctrl+A` / `Ctrl+R`). Navigate the plan with `j`/`k`, arrow keys, Page Up/Down, and Home/End. Request changes opens a multiline editor; use Enter for new lines, Ctrl+Enter to submit, or Escape to cancel:

- **Approve and build**: resolve Build's effective model for this session's location, validate its availability,
  switch the session agent and model explicitly, and submit the exact approved plan with an idempotent message ID.
- **Request changes**: require feedback, select Plan and its effective model, and request a complete updated plan.

Clarifications, research answers, failed/interrupted turns, and subagents are not submitted for approval.
Pending reviews are stored by the TUI and stay available when changing tabs. The TUI reconciles persisted reviews on
reload and while running. A running TUI with this plugin is required to preview plans and process decisions.

Closing the panel never approves or cancels a plan. Use **Reopen saved plan review** in the command palette to reopen
the current review after changing tabs or closing the panel. You can also run `/plan-review-reopen` in the current
session. Before a handoff the plugin rechecks pending input, the session's active agent, current plan text, and saved
file integrity. Changed plans invalidate the previous review. File claims prevent two TUI instances from
starting the same handoff. If a process crashes or a network operation fails during a handoff, the review is marked
uncertain and is **not automatically replayed**: inspect session history and request a new plan rather than risking
duplicate implementation. Concurrent external API changes during the final switch-and-prompt sequence cannot be
made transactional by a TUI plugin; checks narrow this window and fail closed when a change is detected.

On upgrade, pending native forms created by the previous plugin version are cancelled rather than treated as approval;
if such a review is still needed, create a fresh plan with the Plan agent.

## Models

Edit `~/.config/opencode/opencode.json` (project overrides are respected):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "agents": {
    "plan": { "model": "openai/gpt-6-sol#medium" },
    "build": { "model": "openai/gpt-6-luna#high" },
    "explore": { "model": "openai/gpt-6-luna#low" }
  }
}
```

The server companion applies Plan/Build's configured model before each new prompt. The review handoff resolves
these settings afresh; there are no hard-coded fallback models. Plan workflow guidance is in
`~/.config/opencode/instructions/plan-workflow.md`.

## Validation

`npm test` and `npm run typecheck` from `plugins/plan-review/`.

The workflow is type-checked against the actual `@opencode/plugin@2.1.4` and `@opencode/client@2.1.4` declarations,
not the unrelated legacy `@opencode-ai` packages installed in the global configuration's `node_modules`.
