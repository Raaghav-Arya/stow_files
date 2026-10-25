# PI-003 source research and adversarial review

## Scope and provenance

Reference: [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents/tree/ca93a5247e72e7053fcd10bea7125d6c4205f949),
commit `ca93a5247e72e7053fcd10bea7125d6c4205f949`.
License inspected: MIT, copyright 2026 tintinweb.

Cloned to `/tmp/pi-reference-review/tintinweb-pi-subagents` for read-only source
inspection. No dependency installation, downloaded-code execution or source
copying. No claim of a complete security/dependency audit. The initial review was
README-only; this follow-up explicitly inspected implementation source.

The main session inspected the full `completion-outbox.ts`, `cross-extension-rpc.ts`,
`abortable.ts`, `worktree.ts`, `custom-agents.ts`, `child-context.ts` and
`ui/viewer-keys.ts`, plus the beginning of `agent-manager.ts`. The UI follow-up
also inspected full `ui/fleet-list.ts` and the overlay/rendering/Markdown portions
of `ui/conversation-viewer.ts`. A launched research
subagent additionally reported full inspection of `agent-manager.ts`,
`agent-runner.ts`, `custom-agents.ts`, `cross-extension-rpc.ts`,
`completion-outbox.ts`, `ui/conversation-viewer.ts` and `abortable.ts`, with relevant
integration ranges of `index.ts`. The source tree was mapped, including workflow,
scheduling, UI and test modules. **Not every source/test file was exhaustively
reviewed**; workflow/scheduler internals were not brought into our implementation.

Source-research agent ID: `c422450d-ecb5-4f0b-986f-f5ade8202146`.
Adversarial local-review agent ID: `8b7729d7-af63-46ab-952f-f0a879bf80fa`.
Their private transcripts/artifacts remain under the parent session's local
Agents Hub artifact directory, not in this repository.

## Lessons from actual source

1. **Cwd, configuration origin/trust and tools are different inputs.**
   `AgentManager.startAgent` and `runAgent` distinguish execution `cwd` from
   `configCwd`. Their runner constructs the session at the execution directory
   without automatically trusting its executable project resources. Tool scoping
   is enforced separately. Our smaller RPC implementation keeps target project
   resources unapproved and selects tools independently from cwd.

2. **Stopping and finishing transport cleanup are different boundaries.**
   `AgentManager.abort` marks intent/signals execution; settlement releases slots.
   `shutdownChildSession` handles extension shutdown before session disposal with
   a bounded wait. We retain a connection slot until process transport close has
   finished instead of freeing it merely because state says stopped/failed.
   RPC owns our child runtime shutdown; we do not copy SDK-only disposal calls.

3. **A cancelled wait is not a stop command.**
   `abortable` rejects a caller's wait, removes its listener and absorbs late
   settlement without stopping underlying work. Our bounded `wait` preserves
   that distinction; `stop` is a separate explicit primitive.

4. **Steering acceptance is not proof of model acknowledgement.**
   `AgentManager.steer` can buffer before session creation and immediately return
   success while the eventual session operation can still fail. The inspected
   path does not supply per-message durable receipts. Our states deliberately
   distinguish RPC acceptance, observed transcript entry and unknown delivery;
   none is called proof that the model acted.

5. **Completion notifications are policy layered on results.**
   `CompletionOutbox` snapshots completion data, batches delivery at parent turn
   boundaries, and cancels pending notifications on result consumption. It is
   best-effort, not a durable mailbox; a caught send failure drops the batch.
   We retain passive next-turn reports rather than adopting its idle-parent
   wakeup policy or result-consumption orchestration. Durable mailbox/result
   consumption can be designed separately if requested.

6. **A viewer observes/controls an agent; it does not own the agent's lifetime.**
   `ConversationViewer` subscribes/unsubscribes with its UI lifecycle; close,
   steering and stop are distinct controls. Our hub closes without killing
   agents and cleans up subscriptions independently. Local scrolling now freezes
   a bounded snapshot, rather than pretending a moving tail offset is paused.

7. **External integration needs ownership, validation and lifecycle boundaries.**
   `registerRpcHandlers` uses correlated reply channels and guards stop/steer
   ownership. The inspected handler casts incoming payloads, so our future
   control bus should explicitly validate request IDs/options rather than copy
   it blindly. Child-context guards avoid recursively creating managers.
   Our RPC children load only the bridge and cannot recursively load the hub.

8. **Workspace policy is optional even in a much larger implementation.**
   Its manager accepts cwd independently, with worktree isolation as a separate
   option. Its `worktree.ts` can stage/commit, create branches and force-remove
   worktrees on completion. None of that belongs in this user's requested
   plumbing. Our worktree helper and worktree mode were removed completely;
   even optional built-in worktree lifecycle is deferred to PI-005/a caller.

## Adversarial findings acted on

- Removed mandatory worktree creation, tool-to-workspace inference, mode-based
  prompts, and separate worktree launch UI. Added independent `tools` to launch.
- Preserved explicit display names when selecting a named role.
- Isolated external observer failures from agent execution/transport lifetime.
- Kept starting/running/idle/terminating connections in admission accounting.
- Prevented late prompt acknowledgements from reviving abandoned mail state,
  and preserved transcript-proven delivery even if the RPC acknowledgement fails.
- Reserved the initial task's queue slot behind a startup handshake so concurrent
  follow-up messages cannot overtake it.
- Guarded the hub loop against reopening stale UI after session shutdown.
- Flattened multiline metadata to respect TUI row budgets.
- Made paused output a stable snapshot and clamped overscrolling.

Regression tests exercise these boundaries without model requests. Model-based
review is supplementary evidence, not proof of correctness or authorization.

## UI follow-up

The original local screen was too diagnostic/plain. The revised original design
uses the reference fleet/viewer ideas as presentation inspiration: highlighted
agent cards, semantic state colors, compact usage, separate roster/activity,
Markdown, pinned adaptive action bar and a details view. Fullscreen uses the
terminal area; regular mode uses a centered overlay. Pi's current theme supplies
all colors; no global theme/keybinding settings are changed.

The manager keeps a bounded typed presentation projection so tool arguments and
results need not be dumped as JSON in the hub. Tool results are collapsed by
default; event logs remain authoritative. Completion reports now use the latest
assistant result, not raw tool-log tails. A compact custom-message renderer
reduces transcript noise without changing model-facing messages or wakeups.

This work adds no workflow, scheduler, automatic commit or workspace lifecycle.
Rendering tests use real installed dark/light themes and assert ANSI styling,
responsive geometry, interaction state and compact-report behavior. Preview via
`node pi/tests/preview-agents-hub.mjs` without agents/model calls.

## Deliberately not adopted

No scheduler, automatic planner/reviewer pipeline, workflow interpreter,
automatic worktree creation/integration/cleanup, shared-checkout serialization,
idle-parent wakeup loop, automatic nested delegation or imported framework.
Optional orchestration should consume the primitives, not become their core.

Remaining broader PI-003 work is tracked in `pi/BACKLOG.md` and `pi/AGENTS-HUB.md`.
