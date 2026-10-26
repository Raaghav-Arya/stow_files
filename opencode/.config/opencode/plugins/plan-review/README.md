# Automatic Plan review (OpenCode V2)

No slash command is needed. The server companion injects a plan-ready protocol into Plan's model context.
When a successful Plan turn ends with `<!-- opencode-plan-ready -->`, checkbox TODOs and a verification heading,
the TUI saves the complete plan as an immutable, private Markdown revision under `~/.opencode/plan/review/`.
It then creates a native AskUser/form with the saved revision path and two choices. The complete plan remains in the
conversation transcript above the form, so it can be reviewed with Ctrl+Q Vim navigation without moving the form's
initial focus away from its decision choices:

- **Approve and build**: resolve Build's effective model for this session's location, validate its availability,
  switch the session agent and model explicitly, and submit the exact approved plan with an idempotent message ID.
- **Request changes**: require feedback, select Plan and its effective model, and request a complete updated plan.

Clarifications, research answers, failed/interrupted turns, and subagents are not submitted for approval.
Pending forms are server-owned and stay available when changing tabs. The TUI reconciles persisted reviews on reload
and while running. A running TUI with this plugin is required to create reviews and process answers.

Cancellation never approves a plan. Use **Reopen saved plan review** in the command palette to reopen a cancelled
current review. Before a handoff the plugin rechecks pending input, the session's active agent, current plan text,
and saved file integrity. Changed plans invalidate the previous review. File claims prevent two TUI instances from
starting the same handoff. If a process crashes or a network operation fails during a handoff, the review is marked
uncertain and is **not automatically replayed**: inspect session history and request a new plan rather than risking
duplicate implementation. Concurrent external API changes during the final switch-and-prompt sequence cannot be
made transactional by a TUI plugin; checks narrow this window and fail closed when a change is detected.

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

`node --test plugins/plan-review/workflow.test.mjs`

The workflow is type-checked against the actual `@opencode/plugin@2.1.4` and `@opencode/client@2.1.4` declarations,
not the unrelated legacy `@opencode-ai` packages installed in the global configuration's `node_modules`.
