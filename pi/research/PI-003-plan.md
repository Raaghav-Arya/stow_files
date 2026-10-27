# PI-003 implementation plan — checkpoint hardening and completion

Date: 2026-10-26. User request: thoroughly plan PI-003, then launch a Luna/high implementation agent. No commit, push, package installation, reload or physical-terminal acceptance is authorized by this plan.

## 1. Baseline and scope

Authoritative starting point: `research/PI-003-CHECKPOINT.md`, current source and tests, not the older feature lists in `BACKLOG.md` or `AGENTS-HUB.md`. Those documents materially underreport current code. Keep PI-003 **in-progress** until outstanding requirements are actually verified.

Existing source already supplies root-owned nested agents, immediate-parent tool envelopes, shared depth/admission limits, task counters, interrupt/close/resume, private persisted metadata and sessions, versioned Node IPC, typed durable events, parent wakeups, an inline Editor chat and an active-branch transcript parser. Preserve and harden this architecture; do not rewrite it as an orchestration framework.

Parent independently ran all 16 checkpoint entry points successfully before implementation: `tests/agents-hub*.test.mjs`, `tests/plan-hub-integration.test.mjs`, `tests/feature-integration.test.mjs`, `tests/typecheck-agents-hub.mjs`, `tests/transcript-navigation.test.mjs`, with `PI_AGENTS_HUB_CHILD=0 PI_OFFLINE=1`. Feature integration reports the known Ctrl+S conflict. Passing tests do not cover the gaps below.

Workspace: `/home/raaghav/.stow_files/pi`. Implementation files under `.pi/agent/extensions/agents-hub/`; tests under `tests/`. The live extension is already symlinked. Editing source does not change the manager loaded in this parent session. Never start an unmanaged supervisor or reload the parent to evade its budgets. Preserve unrelated dirty Bash/OpenCode files outside this directory.

## 2. Contracts and source review

Parent read installed README and complete `docs/extensions.md`, `sdk.md`, `rpc.md`, `rpc-commands.md`, `json.md`, `tui.md`, `cli.md`, `session-format.md`, `sessions.md`, `message-types.md`, `rpc-extension-ui.md`, `security.md`, `models.md`, plus the official subagent example README. Implementation must consult exact installed declarations/source and relevant examples before changing a contract. Relevant findings:

- `message_end` is authoritative, but an assistant error is not necessarily final: Pi may retry/recover. `agent_end.willRetry` is not final settlement; `agent_settled.aborted` is the final boundary.
- `prompt` success means acceptance, not work completion. Lost acknowledgement is uncertain, not permission to replay.
- `abort` waits for idle; `clear_queue` must precede it to retain queued work rather than allowing it to continue. Preserve steering/follow-up classification and delivery uncertainty.
- `turn_start` is not automatically proof of a provider request. Verify local admission against installed loop ordering; prevent request N+1 locally, not with a parent round-trip race.
- Session trees require active-branch ownership, not all file entries. Branch navigation can occur without replacing the extension runtime.
- `sendMessage(..., {triggerTurn:true})` is supported, not necessarily awaited proof of persistence or model acknowledgement. Busy notifications must use supported complete tool-batch/turn boundaries.
- Custom terminal UI is TUI-only; model controls remain available in RPC/headless modes. Propagate focus to the Pi Editor for IME. Never replace the existing main transcript editor.

`pi-subagents` is ambiguous: prior research identifies both `tintinweb/pi-subagents` and `nicobailon/pi-subagents`. The local reviewed checkout is `/tmp/pi-reference-review/tintinweb-pi-subagents`, pinned at `ca93a5247e72e7053fcd10bea7125d6c4205f949`; package version 0.22.0, MIT (2026 tintinweb), peer Pi >=1.1.0, runtime dependencies croner ^10.0.1 and nanoid ^5.1.16. Last pinned commit is dated 2026-10-13 and addresses resume/nested turn budgets. Parent re-read actual `src/completion-outbox.ts`, `src/child-context.ts`, package manifest and license, and located nested/inheritance/turn-limit code in `src/agent-runner.ts`, `src/agent-manager.ts`, `src/types.ts`. No upstream code was executed or installed. Existing `delivery.ts` explicitly adapts outbox batching/coalescing and has MIT attribution; older research claims of zero reuse are stale.

Before application changes, extend `research/PI-003-subagents.md` with actual relevant source review: nested-tools, runner scope/loadout, counters, completion/input signalling, lifecycle, messaging and inheritance. Verify the other candidate at its already recorded revision if accessible; clearly distinguish reviewed from unreviewed material. Record licenses, dependency exposure, maintenance/adoption evidence or unavailable evidence, API compatibility and concrete reuse/non-reuse decisions. Popularity is not established; do not invent rankings. Reuse reviewed suitable functionality where practical, retaining attribution. Do not adopt scheduler/worktree/automatic-commit code. This is source inspection, not a full dependency security endorsement.

## 3. Design invariants

1. Exactly one root-owned registry/control plane; authenticated process identity cannot be supplied by payloads. Ownership and current policy are rechecked at queued dispatch.
2. Separate connection health, active-work outcome, pending-input gate and budget state. A recoverable model failure must not close a healthy process; fatal process/protocol/required-persistence failure must clean up its subtree.
3. Ordinary continuation/reply/resume preserves identity, conversation, task budgets and lifetime accounting. Only an explicit settled new-task operation resets task-local counters. No silent resets on reload/recovery.
4. Immutable result/event identities include agent, task and revision. Viewing is not consuming. An explicit successful matching-revision model result read may consume the corresponding notification; failed/stale/UI reads may not.
5. Every notification belongs to a root session and branch scope. No old-session callback, stale timer or async transcript load may mutate the replacement context or wake a different branch.
6. Wakeups are configurable and bounded, with passive mode available and no implicit auto-wakeup default. Every hold/limit/unknown delivery remains inspectable; no blind replay or silent drop.
7. Cwd and tool selection are independent, existing-directory inputs. No worktrees, commits, copies, cleanup or compulsory serialization. Tool envelopes are not OS sandboxes.
8. Future PI-004 policy and current PI-013 plan restrictions cannot silently be dropped by delegation. Unsupported required inheritance must refuse explicitly, not claim protection.

## 4. Ordered implementation milestones

Use one Luna/high writer, with tests at each milestone. Prioritize M1–M3 as the next coherent correctness slice if the whole roadmap exceeds a safe implementation run. Report unfinished milestones explicitly rather than marking the ticket done.

### M0 — reconcile research and regression map

- Read checkpoint, source, existing recovery/dispatch/index fixtures and relevant installed examples/declarations.
- Complete the source-review record above and record the concrete starting failures/missing tests.
- Prefer narrow modules and explicit types over adding more ad-hoc state to `index.ts`.

### M1 — provider-failure resilience and lifecycle correctness

Primary files: `manager.ts`, `bridge.ts`, `rpc.ts`, `index.ts`, lifecycle/control fixtures.

- Introduce a documented work-failure representation distinct from fatal/disconnected state. An assistant error records a provisional outcome while installed Pi retry/overflow recovery runs; finalize recoverable failure only at terminal settlement. Do not kill on the first error message.
- Keep healthy transport/session/descendants and exact task budget intact after terminal provider failure. Pause active-work time when settled. Surface the error, partial result and uncertain effects. Require deliberate continuation/retry; do not resubmit the old prompt automatically.
- Hold inbound automatic wakeups on a failed/interrupted/input-blocked/limited recipient so pending reports do not silently restart work. A deliberate continuation releases only applicable holds, after successful admission; it must not bypass input correlation or an exhausted task budget.
- Distinguish explicit pre-acceptance RPC rejection from uncertain request acknowledgement and fatal transport failure. Do not treat every prompt rejection as a corrupt child. Preserve proven delivery despite lost/late acknowledgements. Required persistence failure stays fatal.
- Audit interrupt serialization against concurrent sends and settlement: preserve queued text, original delivery class and message IDs, mark uncertain outcomes, and never auto-replay retained queues. Close remains subtree termination.
- Regression cases: provider error then successful built-in retry; exhausted retry; non-retryable error; error during overflow recovery; deliberate continuation with unchanged budget/context; no auto wake; explicit command rejection versus lost acknowledgement; fatal exit/protocol/persistence cleanup; interrupted queues and races.

### M2 — durable results, notification state machine and explicit policy

Primary files: a small result-store module if needed, `mailbox.ts`, `delivery.ts`, `control.ts`, `protocol.ts`, `bridge.ts`, `index.ts`.

- Store immutable settled/explicit result snapshots keyed by agent/task/revision with status and artifact references. Never return a mutable output tail as if it were the requested historical result. Reject stale/nonexistent revisions accurately; retain a bounded model-facing preview and private full artifact where needed.
- Connect root and nested `agents.result` reads to matching-revision consumption only after result preparation succeeds, scoped to the caller's addressed notification. UI/read inspection never consumes. Do not consume unrelated task revisions or progress/input events.
- Define explicit result report versus lifecycle completion semantics to avoid duplicate automatic wakeups for the same outcome. Keep provenance and the difference between reported result and actual settlement.
- Add validated notification configuration separate from numerical resource limits: passive default; opt-in active delivery; coalescing, batch/context sizes and per-recipient/root wakeup budgets. Preserve compatibility or diagnose prior config clearly. Explicit drain is distinct from spending/resetting an automatic-wakeup allowance.
- Fix hold release at all depths: interrupted boundary, explicit interrupt, waiting input, recoverable failure, plan restriction, human dialog and budget exhaustion have named release conditions. Do not offer an unrestricted `resume()` that clears safety holds. Planning policy is checked again at dispatch; release only after an actual permitted transition.
- Fix restoration/reconciliation: pending pre-send and unknown in-flight outcomes are differentiated conservatively, consumed events cannot be resurrected, confirmed absence permits deliberate retry only, and uncertain sends never auto-replay. Dispose/in-flight shutdown cannot inject after ownership changes.
- Avoid repeated zero-progress timers for oversized events; retain a visible held/truncated-delivery policy with full artifact access. Bound retention/context growth with explicit capacity errors; never discard pending/unknown input/result events silently.
- Test through registered root tool and authenticated nested IPC, not just isolated helpers: idle coalescing, busy tool batch, errors/aborts/UI, result races, stale revisions, held-budget drain, partial batches, oversized text, interrupted persistence and delivery uncertainty.

### M3 — branch/session ownership and safe retained recovery

Primary files: `storage.ts`, `manager.ts`, `index.ts`, `mailbox.ts`, recovery/index fixtures.

- Bind the runtime to the actual root session ID; manager lookup may not silently attach a new session context to an old registry. Reset/dispose all context-scoped maps, drafts, counters and lifecycle deduplication on replacement.
- Use supported session-tree events and persisted branch anchors (not a counter reset to zero on restart) to associate launches/events with the active branch. Navigation must hold incompatible automatic delivery and stop/hold incompatible active work conservatively; old branch records may remain inspectable. Advancing normally on one branch must not be mistaken for switching it. Do not wake an unrelated branch after restore.
- Preserve retained work outcome/limit/input/interrupted states separately from disconnected connection state. Reopen is explicit and never evidence of reconnection. Do not emit fresh completion notifications merely because a retained record was restored.
- Validate session artifact/header/ownership/lineage, canonical cwd, current tools/capabilities, definition origin, provider/model and effective thinking before reopening. Reestablish child input gates via configuration before allowing tools or model work. Missing/corrupt artifacts must produce actionable diagnostics instead of silently disappearing.
- Guard concurrent resume/close/startup with a single serialized state transition and admission reservation. Failed resume closes the new transport, retains old artifacts/state and reports its cause; no duplicate live connection or silent session creation.
- Test same-runtime session replacement, branch navigation and return, restart with pending/unknown notifications, waiting-input/limited/provider-failed records, invalid path/symlink/cycle/corrupt metadata, duplicate resume, cleanup failure and stale callbacks.

### M4 — shared controls, policy-aware configuration and addressed routing

- Route root model tools, `/agent`, roster/chat, nested IPC and extension-facing controls through the same validated adapter and launch resolver. No direct UI manager path that bypasses holds, provenance, policy or model/definition validation.
- Resolve nested named definitions only from approved origins; do not trust execution cwd automatically. Tools never widen the immediate-parent envelope. Validate actual model/provider availability and thinking support; surface clamping or reject unsupported explicit requests rather than silently changing them.
- Formalize a versioned correlated extension API over the existing owned registry (request IDs, errors, cancellation, observation and shutdown); never create another manager for external consumers.
- Add explicit opt-in sibling messaging policy within the same root, with authenticated caller, stable address, no lifecycle authority over siblings, retained delivery/uncertainty states, busy/idle/disconnected rules, rate/queue budgets and loop guards. Do not loosen subtree management authorization to implement messaging.
- Define supported capability inheritance. Default remains the reviewed bridge plus constrained built-ins/nesting; permit only explicit approved child-safe extensions/skills/custom/MCP capabilities where enforcement is implemented and tested. Reject required unsupported policies. Do not bulk-copy executable config or start MCP servers merely because they are discoverable. Broad PI-001 mapping and actual PI-004 classifier implementation remain separate tickets.

### M5 — transcript/chat correctness and discoverability

- Replace index-based live row IDs (which shift after the 80-item ring wraps) with stable event IDs and scoped transcript state. Do not map outgoing child/sibling provenance to the label “You”.
- Hydrate once on open and once per settlement/version change; guard async results by agent/session/branch/open generation. No full session reread per unrelated manager update. Merge provisional rows with authoritative history without duplicate tool/message entries.
- Wire usable history pagination and stale/invalid cursor diagnostics. Prefer installed session APIs for active-leaf authority; do not infer branch identity only from last physical JSONL leaf.
- Preserve drafts/history per agent, focus/IME, multiline input and main-editor draft. Unsupported slash commands must be rejected honestly. Provide input-request reply and explicit new-task affordances; show task turns versus lifetime turns and active-time/budget state accurately.
- Verify Alt+A from chat goes directly to main, Escape/roster behavior is intentional, close requires confirmation, interrupt preserves context, closed/resumable/recoverable-failure states have correct controls. No competing main-editor replacement or global shortcut changes.
- Real dark/light themes, Unicode, narrow/short layouts, regular/fullscreen, key releases, scrolling/resizing, async disposal and editor focus must be tested offline. Physical stack acceptance is separate.

### M6 — budgets, accounting and documentation

- Retain proposed defaults (16 connected across tree, 128 cumulative allocations, depth 3, 1,000 task model turns, 240 active task minutes) unless measurements justify adjustment. Add an explicit configurable per-parent bound if implementing the ticket's per-parent/whole-tree distinction; no hidden tiny nesting cap.
- Prove exact local request admission at the limit with installed-runtime/no-network fixtures and a synthetic 1,000-turn run. Explain provider retries, compaction, tool calls and explicit new-task counters; do not claim a turn cap is a financial cap. Include approaching-limit warning without exceeding the hard allowance for a wrap-up request.
- Account assistant/tool/compaction/branch-summary usage once with stable attribution. Keep own versus descendant totals separate; expose a documented PI-012 consumption shape without implementing its footer. Subscription quota is unknown, not reconstructed from tokens; missing prices are unknown, not free.
- Measure idle RPC startup memory/process/FD overhead offline and document measured environment, not a provider concurrency guarantee. Bound mailbox/delivery/result retention and disclose remaining manual artifact retention.
- Update `AGENTS-HUB.md`, `ORCHESTRATION-LIMITATIONS.md`, source research and only PI-003 status/checkboxes in `BACKLOG.md` to match delivered behavior. Correct stale no-resume/no-nesting/no-inline-chat/default-limit/no-reuse claims. Include settings, usage, recovery, passive/active policy, disable/re-enable and precise remaining gaps.

## 5. Validation and handoff

For each milestone add failing regression coverage first where practical, then run focused tests and Hub typecheck. Final minimum regression command (from `pi/`):

```sh
for test in tests/agents-hub*.test.mjs tests/plan-hub-integration.test.mjs \
  tests/feature-integration.test.mjs tests/typecheck-agents-hub.mjs \
  tests/transcript-navigation.test.mjs; do
  env PI_AGENTS_HUB_CHILD=0 PI_OFFLINE=1 node "$test" || exit
done
```

Also run neighboring AskUser/plan/prompt-stash tests/typechecks when their shared contracts are touched, and `git diff --check`. Do not install dependencies or make test provider calls. Existing testing utilities use the installed Pi runtime. Fake-Pi tests must reproduce actual event payloads and exercise production adapters; helper tests alone do not establish integration correctness.

Implementation agent handoff must list changed files, delivered milestones/decisions, exact tests/results, remaining requirements and manual steps. Parent reads the result, reviews diff/source and independently reruns the regression suite before claiming validation. No automatic reload, commit or push. No physical WezTerm → tmux → Neovim terminal or live-provider acceptance claim without actually performing it with appropriate authorization.

## 6. Continuation execution plan — user authorized remaining implementation

The user has now requested: “Plan and proceed with the rest of the implementation.” This authorizes continuing the roadmap, not commits, reloads, plugin installation or unperformed acceptance claims. M0 and the focused M1 provider-failure slice (including parent review corrections) are implemented. Parent independently reran all 16 checkpoint entry points and diff-check after corrections; they passed. Do not redo source research or regress the M1 fix. Existing child `84bc914c-0d79-41d9-ba80-8b31594e22cf` is verified openai/gpt-6-luna/high and idle; continue its conversation as the sole writer without resetting its task budget.

### Batch A — finish lifecycle foundations and deliver M2

This is the next implementation batch, not a substitute for the remaining roadmap. At its tested handoff the parent reviews before authorizing the next batch in the same implementation request.

1. **Close M1 gaps with adversarial fixtures.** Serialize interrupt/send/resume transitions, including clear-queue-before-abort. Preserve delivery class, stable message references and no automatic replay. Test sends queued before/during interrupt, late settlement/acks, close during interruption, and required metadata/journal write failure. Persistence failure in a dispatched operation must not leave a healthy-looking connected child running without its mandatory recovery record. Fatal cleanup remains subtree-owned.
2. **Repair provisional-failure edge cases.** Inspect actual installed retry-cancellation and final-error event ordering. Clearing `pendingWorkError` on a scheduled retry alone must not turn an aborted retry delay, failed recovery, or terminal error without another assistant response into successful idle completion. Honor `agent_settled.aborted` explicitly. Check diagnostic retention and budget/input precedence. Test actual event sequences without model/network requests.
3. **Add an immutable private result store.** Key by agent ID + task ID + revision, with stable result ID and status. Explicit reports are reports, not proof of settlement. A continuation in the same task creates later revisions without mutating earlier artifacts. `agents.result` must optionally accept task identity/result identity when needed to disambiguate old task revisions; propagate schema consistently to root tools, control and child IPC. Requested absent revisions fail clearly rather than returning a current output tail. Preserve old artifacts and expose bounded previews/full paths.
4. **Wire consumption to production adapters.** A successful result lookup for the immediate addressed parent can consume only its exact matching completion/failure notification. UI inspection/read and wrong-branch/wrong-recipient/stale/failed lookup never consume. Tool-result preparation must succeed before cancellation of pending delivery. Keep consumed events terminal through in-flight send acknowledgement and journal restoration. Deduplicate explicit-report and settlement wakeups with documented semantics, not a prose heuristic.
5. **Make wakeup policy explicit.** Add a strict documented notifications configuration, passive default and opt-in active mode. Do not implicitly preserve the current hard-coded active default as if it were user approval. Validate coalescing, batch/context bounds and root/per-recipient automatic-call allowances. Explicit drain does not consume/reset an automatic allowance. No unconditional clear-all-holds operation; state-owned holds need deliberate valid transitions, operational holds need scoped actions. Keep needs-input visible even under passive delivery.
6. **Make delivery uncertainty and stalls safe.** Restore pre-send/pending versus in-flight unknown conservatively, reject state resurrection, preserve proven delivery, avoid blind replay and avoid zero-progress oversized-message timers. Reconciliation and explicit retry are separate. Disposal/in-flight callbacks must be ownership guarded. Expose capacity/retention failures visibly; never silently drop pending/unknown input/results. At minimum carry compatible ownership hooks for Batch B; do not claim branch isolation finished here.
7. **Integration tests and docs.** Exercise actual registered root and authenticated nested IPC adapters for revisions/consumption, policy defaults/active opt-in, held/limited recipients, explicit drain, errors, cancellation and restart. The roster regression currently uses an exported helper with a fabricated afterSend callback; strengthen production callback/UI coverage when touching these paths. Preserve current neighboring AskUser edits; they belong to another concurrent task.

Batch A acceptance: focused and full checkpoint regression suite + typecheck + whitespace pass; no provider calls; exact implemented/unfinished subitems documented. M1 concurrency/persistence coverage and M2 must not be labelled complete based only on helper tests. Send a short progress report after lifecycle tests and after result/policy integration; ask only for genuine policy/API ambiguity that cannot be resolved conservatively.

### Batch B — M3 branch ownership and retained-session recovery

After parent review of Batch A, implement M3 with persisted branch anchors and root-session binding. Separate connection state from retained work outcome; never restore every state as stopped and then silently reset to idle. Revalidate artifact/session header/cwd/lineage/tools/model/definition and reconfigure pending input gates before allowing requests. Serialize resume with close and admission. Expose corrupt/missing/unsupported records with actionable diagnostics. Test same-runtime tree switches, normal branch advancement, reload/restart, orphaned state, old callbacks, pending delivery and failed cleanup. Automatic notifications from a different branch stay held; inspection does not grant that branch execution authority.

### Batch C — M4 composable controls and capabilities

Implement the shared versioned extension-facing control API and parity across commands/tools/UI/IPC, then explicit bounded opt-in sibling messages without sibling lifecycle authority. Resolve named roles from approved origins and validate effective provider/model/thinking. Provide a narrowly reviewed opt-in capability inheritance contract with explicit child-safe resources and refusal of unsupported mandatory policy; no automatic executable config/MCP discovery. PI-004 itself and broad Claude compatibility remain separate. Any truly unsupported required enforcement is reported, never silently omitted.

### Batch D — M5 and M6 presentation, budgets and accounting

Implement stable transcript event IDs, open/settled hydration with stale guards, active-leaf authority and usable pagination; correct provenance, reply/new-task affordances, task/lifetime budgets and focus/draft behavior. Prove exact child-local request admission at 1,000 turns with a synthetic installed-runtime test, add practical per-parent admission alongside shared bounds, attribute assistant/tool/compaction/delegated usage without double counting, distinguish unknown prices and subscription quota, and measure offline process/FD/memory overhead. Keep PI-012 integration a documented accounting contract rather than a competing footer. Finish usage/config/disable/recovery docs and accurately reconcile ticket checkboxes.

### Review cadence and ownership

One Luna/high writer owns Hub implementation files. The parent does read-only review and independent validation while that writer is active. Each batch produces a bounded tested handoff, not an automatic declaration of full-ticket completion. Subsequent batches remain authorized by this user request but begin after review, with explicit next-batch instructions. Keep unfinished work visible until implemented or genuinely blocked; no silent reduction to Batch A only. Do not alter the concurrent AskUser/UI/test, Bash, OpenCode or WezTerm changes. Physical terminal-stack and live-provider checks remain separately reported follow-ups unless explicitly exercised.
