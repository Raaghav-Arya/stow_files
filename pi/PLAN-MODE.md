# Plan mode (PI-013)

Local extension: `.pi/agent/extensions/plan-mode/index.ts`. This is an explicit
investigate → draft → user review → execution workflow, **not an OS sandbox** or
PI-004 auto-mode/classifier. It never launches workers or creates worktrees.

## Enable and use

Pi discovers an `index.ts` subdirectory in its configured extensions directory.
The directory is now linked into `~/.pi/agent/extensions/`; restart Pi or run
`/reload` to load it in an existing session. Do not load the official example
alongside it (both claim `/plan`). The existing footer already renders extension
statuses; its layout and the editor are not replaced.

1. Stop current work **and any existing delegated agents/processes**.
2. `/plan` (or `/plan enter`) enters restricted planning; it does not toggle off.
3. Ask the model to investigate. Clarify requirements in normal conversation.
   `plan_draft` writes a dedicated Markdown plan file and reports its path.
   Session history also retains revision snapshots for branch restoration.
4. `/plan show` presents the plan's file path and Markdown contents for review
   without making a model request. External file edits are read back for review.
   `/plan edit`
   opens the standard multiline editor with a template covering scope, components,
   ordered steps, risks/open questions, dependencies and validation. Cancel keeps
   the original. Saving creates a new revision. Fields are a template, not a
   semantic completeness guarantee: review them yourself.
5. Switch back to normal/build with **Shift+Tab** or `/plan leave` whenever
   ready—there is no warning, confirmation, or mandatory approval step.
   Optionally, `/plan approve` displays the current file content for explicit
   revision-specific approval and preserves a separate approved snapshot.
   Neither switching nor approval starts work; send your next execution prompt.
   PI-004 and every other policy gate still apply.
6. `/plan cancel` stops/revokes execution authorization by returning to restricted
   plan mode, preserving the draft and prior approval for reference. It does not
   interrupt already-running work; stop that first.
7. `/plan leave` immediately returns to normal/build without approving a plan.
   The plan file and history are preserved.

`Plan: review rN` / `Plan: execute rN` is published through `setStatus("plan-mode")`.
A footer must render extension statuses or consume the event API below. No main
editor, footer replacement or progress widget is registered. Shift+Tab switches
between planning and build/normal mode using the same guards as the commands.

## Plan files and review

Plans are saved under:

```text
~/.pi/agent/plans/<session-id>/<revision-uuid>.md
```

`PI_CODING_AGENT_DIR` overrides the `~/.pi/agent` base directory. Each draft save
creates a new file rather than overwriting an older branch's artifact. The exact
path is returned by `plan_draft` and presented with the contents by `/plan show`.
Open that Markdown file in your preferred editor, or use `/plan edit` inside Pi.
External changes are read back on show/edit/approval and before the next planning
or normal/build turn. Explicit approval checks the content again after its dialog
so an intervening file edit cannot approve unseen content.

Session entries retain the active file reference, draft revision and optional
approved snapshot. Branches/forks can initially reference the same file; editing
that file externally affects every reference to it. A subsequent draft save
creates a separate artifact. Files are not automatically deleted. Legacy
session-only plans are materialized lazily when first displayed or used.

Switching to build retains the plan path and draft in model context without
claiming that it was explicitly approved. Approved snapshots remain separate.

## Restrictions and exact coverage

In plan mode `tool_call` permits only `read`, `grep`, `find`, `ls`, the local
`ask_user`, and `plan_draft`. All bash (even `pwd`), edit/write, other custom/MCP
tools, search loaders, codemode and delegation tools are denied. User `!`/`!!`
shell is also blocked. Use AskUser or conversation for clarification. The narrow
write exception is the extension-owned Markdown artifact, written by `plan_draft`
and `/plan edit`; general edit/write tools remain blocked. There is no shell
parser or trust in readOnlyHint annotations. Existing tool loadouts are not
changed; denied tools may remain advertised but calls fail.

Installed Pi 1.4.0 routes model tool calls and `ctx.executeTool()` nested calls
through the same gate. We inspected that implementation; tests exercise both
parent/non-parent call events. No helper tool/worker can obtain a model-callable
approval operation from this extension. Approval cannot come from model prose,
a classifier, plan contents or an event-bus request.

This assumes the permitted names still identify the trusted built-in file-read
tools. Extensions replacing those names must be reviewed separately. Extensions
run with full OS privileges: arbitrary extension OS operations, other extension
slash commands, startup/resource discovery/MCP connections, already-running
children or commands, and model/provider network traffic are **not intercepted**.
Cwd is not an access boundary; reading secrets/outside paths remains possible.
Use OS/container isolation and avoid exposing credentials for stronger protection.
Do not use this as a corporate mandatory enforcement layer.

Delegation during planning is refused rather than pretending restrictions were
inherited. The integrated `agents-hub/plan-policy.ts` adapter vetoes explicit
entry while any connected child exists, including idle or terminating children.
Stop them from Alt+A before `/plan`. Hub launch and send operations (including
commands/UI and queued dispatch) also check planning state, not only tool gates.
Restoring a planning/execution branch stops connected hub children and waits for
process cleanup. All tools remain blocked until cleanup succeeds; failure leaves
the gate closed. Session replacement/reload uses normal hub shutdown. Other
external processes and unrelated Pi instances remain outside this integration.

## Lifecycle and noninteractive modes

Plan revisions and approved snapshots remain custom branch-local session entries
`local-plan-mode-v1`; the reviewable plan itself is a dedicated Markdown file.
No application files are written. Resume, reload, fork/clone
and tree restoration reconstruct only the active branch. Persisted plan **or
execution** state restores as restricted plan; freely switch to build again or
optionally renew explicit approval.
A malformed state restores restricted mode. A branch with no plan history or an
explicitly left plan starts normal mode. An ephemeral `--no-session` run still
writes Markdown artifacts, but cannot recover their session association after
restart. Crashes do not undo filesystem/external effects.

Commands refuse state changes while the main agent is busy. Dialog responses are
invalidated by state revision/session shutdown/tree replacement, preventing stale
approval. A failed/cancelled confirmation never approves. Print/JSON/headless can
enter/leave planning and use plan_draft, but cannot approve/edit via UI; those
UI-only actions receive an explicit needs-interaction notification. RPC uses supported editor and
confirm dialogs: its client must represent a real user and must not automatically
answer yes. An absent client leaves approval pending, not inferred.

No automatic model request, continuation loop, external editor invocation,
network request or downloaded plugin execution is introduced. Plans enter model
context and can appear in exports; Markdown artifacts also persist on disk.
Keep sensitive information out of them.

## Extension-facing read-only API (version 1)

- Emit `plan-mode:request-state` to request publication.
- Observe `plan-mode:state`: immutable `{version:1, mode:'normal'|'plan'|'execute',
  hasPlan:boolean, revision:number}`. No plan text is broadcast.
- Optional cooperative **synchronous** `plan-mode:before-enter` listener receives
  `{block(reason:string):void}`; call block before yielding/awaiting to veto entry,
  e.g. if a child agent remains alive. Pi's event bus does not await listeners;
  this is not an async permission API or a security boundary.
- `plan-mode:quiesce` is emitted on restricted branch/startup restoration.
  Synchronous listeners register owned-process cleanup promises with
  `{waitUntil(work:Promise<unknown>):void}`. The gate waits for all promises;
  failures keep all tools blocked. Listeners must register before returning.
- There is no API for external mode mutation or approval. On shutdown consumers
  must handle their own session lifecycle rather than assume the last event is
  live. The local hub adapter implements the veto/cleanup contracts.

## Shortcut / terminal acceptance

**Shift+Tab** switches modes while idle:
- Normal or execution → restricted plan mode (including the delegated-agent veto).
- Plan, with or without a draft → normal/build immediately, without warnings or
  confirmation. This does not mark a draft approved.
- No model turn is started. Explicit `/plan approve` remains optional.

Thinking-level cycling is remapped to **Ctrl+Alt+T** in `keybindings.json` to free
Shift+Tab. Ctrl+P/N navigation, Ctrl+U/D scrolling, Ctrl+Q INPUT/NAV, Alt+N model
cycle, Alt+A hub and reserved Ctrl+S/R are unchanged. Run `/reload` after updating.
WezTerm → tmux → Neovim terminal forwarding and active-dialog ownership still
need live audit. Standard editor/confirm dialogs
are used for narrow/Unicode/theme/resize handling; we did not replace them.
Live regular/fullscreen, narrow terminal, resize, Unicode, dark/light and actual
terminal-stack acceptance remain outstanding. Offline tests are not live acceptance.

## Tests and disable

Run `node --test tests/plan-mode.test.mjs` using the already installed Pi/jiti and
typebox. Run `node tests/plan-mode-typecheck.mjs` for strict typechecking using an
existing `tsc` (the temporary config path is printed). Also run
`node --test tests/plan-hub-integration.test.mjs` and
`node tests/feature-integration.test.mjs` for admission/queued-message guards,
branch cleanup, discovery-order independence, cleanup failure, actual live-link
discovery, footer statuses and isolated offline Pi `/plan` + `/clear` commands.
Tests do not contact a model, execute downloaded code or install packages.
Research/provenance: `research/PI-013-references.md`; pre-implementation plan:
`research/PI-013-plan.md`.

To leave planning restrictions for one session, use Shift+Tab or `/plan leave`. To
remove the feature entirely, remove its live extension link/explicit `-e` path
and restart Pi (or user-initiated reload). **Disabling removes the gate** even if
session history still contains a plan. No session files are deleted automatically.
