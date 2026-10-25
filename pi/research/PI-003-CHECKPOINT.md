# PI-003 — tested plumbing checkpoint (2026-10-25)

**Status: in progress, not feature-complete or terminal/provider accepted.** This record supersedes earlier progress snapshots where they describe the current index as wholly unintegrated. The user explicitly requested a logical checkpoint commit after previously prohibiting commits; no push was requested.

## Development and review

All implementation code and implementation-test edits were performed by verified `openai/gpt-6-luna` with high reasoning. The coordinating Sol session read/reviewed source, ran independent offline checks, prepared this review record and the license notice, and handled the checkpoint commit. Product agents are not forced to use Luna.

Last implementation worker: `19725695-b47a-4234-a482-ef317551fcaf`. Its saved edits include the new public-adapter test, but it was terminated at turn 41 by the previously loaded runtime's old 40-turn limit before writing a final handoff. All implementation workers are now disconnected/stopped. Edited source defaults do not replace the already loaded manager, whose 12 cumulative allocations are exhausted. Do not bypass that budget by creating an unmanaged supervisor. Further code-writing requires a verified Luna-high implementation context, preferably the main session, or an explicitly reviewed runtime transition.

## Included plumbing

- One root-owned agent registry, ancestry checks, shared connection/allocation/depth limits and immediate-parent default/capability inheritance.
- Proposed source defaults: 16 connections, 128 allocations, depth 3, 1,000 task turns and 240 active-task minutes. These are configurable proposals, not measured fleet-capacity guarantees.
- Interrupt distinct from close, retained context/queues, task/lifetime counters, active-time accounting, explicit new-task resets and owned-subtree close.
- Private atomic metadata/root ownership lock, rotated event journals, conservative retained-record discovery and explicit reopen using the child session path.
- Versioned Node IPC alongside Pi JSONL RPC, authenticated transport caller identity, shared scoped controls, nested delegation and compatible `message_parent`.
- Durable typed completion/failure/input/progress snapshots, parent routing, idle coalescing, busy-boundary dispatch, visible holds, delivery preflight, and explicit inspection/reconciliation.
- Root reply/result/resume controls and correct parent-to-descendant sender direction. Replies preserve actual sender provenance and clear the child's correlated input gate before prompting.
- Inline Pi Editor chat and hierarchical roster, drafts/history, scoped navigation, interrupt/close/resume controls, and an active-branch transcript parser.
- Required MIT attribution retained in `../.pi/agent/extensions/agents-hub/THIRD-PARTY-NOTICES.md` (relative to this research directory: `../.pi` refers to the project's `.pi`).

The public-adapter fixture uses a fake connection and root Pi callbacks. It exercises registration, nested launch/send ownership, input/reply controls, notification status/reconciliation, actual event field handling, and shutdown. It is not a real-provider or physical terminal acceptance test, and does not prove every delivery race.

## Independent validation after the last writer disconnected

All **16 entry points** below passed. Run from the project root with `PI_AGENTS_HUB_CHILD=0` so the root extension guard is not accidentally activated by a child shell:

```sh
for test in tests/agents-hub*.test.mjs \
  tests/plan-hub-integration.test.mjs tests/feature-integration.test.mjs \
  tests/typecheck-agents-hub.mjs tests/transcript-navigation.test.mjs; do
  env PI_AGENTS_HUB_CHILD=0 node "$test" || exit
done
```

The glob includes bridge, chat, control, dispatch, foundation, **index**, mailbox, protocol, recovery, main Hub, transcript and Hub UI tests. Plan/Hub integration passed 5/5 tests. Installed-Pi offline smoke and IPC compatibility checks passed without provider-backed acceptance requests. Feature integration printed the already known Ctrl+S shortcut-conflict warning.

`git diff --check` reports one trailing space in `index.ts`'s notification schema line. This non-functional style warning is retained rather than silently editing Luna's implementation from a different model. It is not a passing whitespace check.

## Remaining work — do not mark PI-003 done

1. **Notification semantics and coverage:** audit explicit hold release at every depth, planning-policy resumption, delivery outcomes/reconciliation, and result consumption. Result retrieval still reads mutable output tails rather than a fully versioned result store. Root result reads are not yet wired to successful matching-revision notification consumption. Explicit result reports and lifecycle completion may overlap. The public fixture does not yet prove all busy/retry/generation/UI races.
2. **Branch/session isolation:** current root generation is local to the runtime; branch changes and retained pending events require stronger association/filtering. A new session context must not reuse the wrong manager or auto-deliver old-branch events.
3. **Transcript/chat integration:** the index still projects live rows from bounded activity indices and can repeatedly hydrate the full session on updates. Replace this with stable event identities, hydration once on open/settle, usable history pagination, and stale-result guards. Verify Alt+A actually returns to the main session rather than reopening the roster; check NAV/IME focus, unsupported slash-command rejection, new-task/input-reply affordances and task-vs-lifetime budget display.
4. **Configuration/control parity:** approved definition origins and actual provider/model/reasoning validation remain incomplete for nested launches; commands, UI, model tools and IPC do not yet have complete shared-adapter parity. Continue preserving tool envelopes and planning restrictions.
5. **Recovery/accounting:** preserve blocked/limited/interrupted work state when restoring retained records, reestablish the child input gate, report corrupt/missing artifacts actionably, validate current policy/capabilities, deduplicate assistant/compaction usage and distinguish unknown prices. Current recovery/component tests do not establish all of these guarantees.
6. **Budgets/resources/storage:** prove exact child-local request admission with installed-runtime fixtures, synthetic 1,000-turn/wrap-up tests, and offline resource measurements before advertising fleet capacity. Mailbox/delivery retention still needs review for long-lived workloads.
7. **Provider-failure resilience (user follow-up): NOT implemented.** After the original integration is ready, distinguish terminal provider/work errors from healthy built-in retry, retain a healthy child connection/context/task budget, hold automatic wakeups and allow deliberate continuation. Fatal process/protocol/required-persistence failure remains different; no blind retry or uncertain side-effect replay.
8. Update `AGENTS-HUB.md`, `ORCHESTRATION-LIMITATIONS.md`, source-reuse research and PI-003 backlog accurately. Earlier handoff/progress notes may be stale. In particular, `manager.stop` already closes descendants; do not change that to match older inaccurate prose.
9. Physical WezTerm → tmux → Neovim terminal checks, reload acceptance and optional live-provider demonstrations remain unperformed. **Do not treat this commit as approval to reload an accepted/finished PI-003 implementation.**

Unrelated Neovim/OpenCode edits, pre-existing backlog edits (including PI-013/PI-017), and intermediate untracked agent research/progress files are intentionally excluded from the checkpoint commit and remain in the worktree.
