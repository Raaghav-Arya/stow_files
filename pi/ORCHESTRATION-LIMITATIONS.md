# Parallel ticket implementation — orchestration limitations

## Requested run

Tickets: PI-013 plan mode, PI-014 Ctrl+Y picker acceptance, PI-007 `/clear`,
PI-006 Ctrl+S prompt stashing, PI-008 AskUser TUI.

## Observed limits and handling

### Four live connections, not five

The first four launches succeeded. The AskUser launch was rejected with:

> Agent connection limit reached; stop an existing agent first

The loaded Agents Hub defaults to `maxConcurrent: 4`. Starting, running, idle,
and still-terminating connections count. There is no tool action to change the
loaded manager's configuration. A config change/reload would stop the agents
already working; no reload or unmanaged process was used to bypass the budget.

Handling: AskUser was queued until `/clear` completed and its full report was
read; the parent stopped that idle connection, then successfully launched
AskUser. Thus all five could not run simultaneously in this runtime. Future runs can configure `~/.pi/agent/agents-hub.json` before
starting/reloading (documented bound: 1–32 connections).

### Clarification is mediated, not a direct agent-to-user dialog

Each child has `message_parent`, and can ask clarification questions. The parent
relays questions to the user and replies with `agents send`; the user can also
message a child through Alt+A / Agents Hub. Children do not inherit custom tools
or extensions, so they cannot directly use the AskUser tool being implemented.
No user answer or approval may be invented.

### Reports do not automatically wake an idle parent

Child reports enter the parent's next-turn context, rather than independently
starting a parent model turn. The parent must use read/wait and relay questions;
finishing a parent response does not guarantee immediate automatic processing of
later child questions. Read full reports rather than rely on notification tails.
The documented passive-injection cap is 24 reports per runtime; further reports
remain available through read/logs/hub.

### Shared checkout is not automatic isolation

The hub supplies cwd and tools, not Git worktree management or merge/conflict
handling. Agents share the stow repository, which already has unrelated user
changes. Each agent owns a distinct new extension directory, test prefix,
research prefix, and usage document. Existing editor/keybindings/settings,
BACKLOG updates, and live symlinks are reserved for parent integration.
No commits, pushes, automatic installs, or cleanup of unrelated files are allowed.

### Source research and validation

Children have bash/network-capable commands but no dedicated browser/search tool.
They must fetch and inspect actual public implementation source, record immutable
commit/license/source paths, and distinguish source review from README review.
Downloading source for inspection does not authorize installing/executing it.
Network failures or inability to find a suitable reference must be reported,
not replaced with fabricated research or popularity claims.

Automated offline tests cannot establish visual/input acceptance through the
user's WezTerm → tmux → Neovim terminal stack. No model calls, live reloads, or
interactive terminal takeover are authorized as part of child testing.

### Turn/lifetime budgets

The loaded hub caps each child at 40 cumulative model/tool turns and a 30-minute
lifetime. Research and implementation consume that budget together; follow-up
messages do not reset it. Parent reminded agents approaching the cap to finish
reports and tests. This is not an autonomous retry/resume scheduler.

Observed: AskUser sent its implementation handoff reporting 8 passing offline
checks and a strict typecheck, then hit `Agent turn limit reached`. Its work is
on disk, but that runtime error is not a clean final settlement or parent review.
Parent subsequently reviewed the files, reran the tests/typecheck, added a
key-release regression check, and verified actual live tool discovery. The
agent's turn-limit failure did not erase its implementation.

### Plan-mode policy does not retroactively constrain children

The plan-mode agent found that main-session idle state does not prove child
agents are idle/stopped. Children do not inherit newly loaded extension gates,
and a new parent policy cannot interrupt arbitrary already-running child work.
Plan mode therefore requires parent/hub integration to veto entry while active
children exist, and must deny unsafe new delegation. This is a required safety
integration, not something a system prompt can fix.

Completed parent integration: `agents-hub/plan-policy.ts` vetoes explicit entry
with connected children (including idle), checks manager launch/send admission
and queued dispatch, and stops/waits for children on restricted branch restore.
All plan-mode tools remain blocked until cleanup succeeds. Five integration tests
cover discovery order, idle/active entry veto, restoration, queued sends and
cleanup failure. Existing processes outside this hub remain out of scope.

## Progress

- All five agents successfully launched, with at most four connected at once.
- `/clear`: child implementation complete; child reports 5/5 offline tests pass.
  Report read; idle connection stopped to free AskUser's slot. Parent integration
  and isolated actual Pi `/clear` replacement validation subsequently completed.
- Running at AskUser launch: plan mode, Ctrl+Y, Ctrl+S, AskUser.
- IDs: plan `f38a181a-ecea-4af6-a8b4-534b7e12c796`, picker
  `d1d60b54-8297-493b-8206-5cd6fb611b2f`, clear
  `5748532b-4574-419a-b6f7-4a579f5c0b1e`, stash
  `11768188-7e71-4631-ba6e-bbd1c4b63f57`, AskUser
  `00d8b38e-e3cc-4112-96f7-9141673e6ec7`.
- Every agent instructed to write a plan before coding, inspect online plugin
  source, add tests and usage/disable notes, and report questions/limitations.
- All five implementations now reviewed and live-linked. The initial missing live
  links explained the user's nonworking Ctrl+S and absent `/plan` command.
- `tests/feature-integration.test.mjs` verifies actual live discovery, real
  shortcut-registry Ctrl+S dispatch, footer status display and combined isolated
  offline Pi `/plan` shell gate and `/clear` replacement. All independent feature
  suites/typechecks were rerun; no model call or live reload was made.
- Existing sessions still require reload/restart. Physical terminal-stack and
  visual/IME acceptance remain user validation, not claimed by offline tests.
