# Delegation and orchestration limitations

## Current implementation

Subagents are provided by the installed
[Raaghav-Arya/pi-subagents](https://github.com/Raaghav-Arya/pi-subagents) fork,
pinned in `.pi/agent/settings.json`. See `SUBAGENTS.md` for installation,
migration, source pin and security caveats. The superseded custom Agents Hub and
its plan-policy adapter/tests have been removed; commit `aebf606` preserves their
historical checkpoint. Old custom-Hub connection caps, turn counters, delivery
states and lifecycle test results do not describe the fork.

## Plan mode does not retroactively constrain agents

The local plan-mode tool gate blocks new non-allowlisted main-session tool calls,
including delegation and steering tools. It does **not** stop already-running
agents or gate other extension slash commands, mention handlers, schedules,
workflows or extension-internal APIs. Main-session idle state is not proof that
background work has stopped. The removed Hub's veto, queued-send checks and
restricted-branch cleanup are not implemented for the fork.

Stop delegated work explicitly before entering plan mode. Do not present local
plan mode as an OS sandbox or mandatory enforcement layer. Fork-specific policy
integration and its acceptance tests remain open PI-003 work.

## Workspaces, capabilities and user input

A working directory and tool allowlist do not sandbox filesystem/network access.
Shared-checkout writers can conflict with each other and with pre-existing user
changes. Choose non-overlapping ownership or explicit isolation; no automatic
worktree, commit, merge or cleanup policy is imposed by this local configuration.
Review fork definitions and nested delegation grants: a child's capabilities need
not be the same as its parent's. Do not assume local custom tools/MCP policies
are inherited or that a read-only parent makes its children read-only.

Child questions must be relayed through a supported parent/user interaction path;
no agent may invent a user's answer, confirmation or approval. A status/progress
report is not evidence that an operation completed. Read the actual result and
verify edited files and commands before reporting completion.

## Validation boundaries

`tests/feature-integration.test.mjs` checks local extension discovery, Ctrl+S
registration/dispatch, footer status and isolated offline Pi `/plan` shell gating
and `/clear`, with `/agents` registered from the fork. It does not exercise model
requests or establish fork lifecycle/recovery, inheritance, accounting, nested
admission or notification reliability. Those need focused review/testing against
the fork rather than reuse of deleted custom-Hub tests.

Offline fixtures cannot establish visual/input acceptance through
WezTerm → tmux → Neovim. Regular/fullscreen rendering, IME, resize and terminal
key forwarding remain separate manual checks. Restart/reload is user initiated;
source edits do not replace an already-loaded runtime.

## Historical parallel ticket run

PI-006/007/008/013/014 were originally implemented using the removed custom Hub.
Their individual source, tests and research remain; their delivery does not imply
current fork policy compatibility. The old run's four-connection and 40-turn
limits, failed-worker recovery notes and old integration guarantees are historical
only, available in commit `aebf606`, not active operating instructions.
