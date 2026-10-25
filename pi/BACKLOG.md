# Pi customization backlog

Local tickets for Claude Code-style workflows. PI-003 and PI-006/007/008/013/014
have local implementations; see individual integration/validation status below.
No third-party Pi packages have been installed.

## How to resume

Ask: “Implement PI-00N from pi/BACKLOG.md.” Before implementation, read this
file, the current installed Pi docs, relevant examples, and existing config.
Implement one ticket (or explicitly agreed slice), update its status and decisions,
and add tests and usage/disable instructions. Do not assume this session's context
will be available. Do not commit or push without a request.

Code/config lives under `pi/.pi/agent/` in the stow repository; the live user
config is `~/.pi/agent/`. Existing `extensions/transcript-navigation.ts` replaces
the main editor. Avoid a second competing editor replacement; compose features
or use extension shortcuts and the UI editor APIs where possible.

Statuses: proposed -> ready -> in-progress -> done (or blocked).
PI-003 is **in-progress** (first local implementation slice; see
`pi/AGENTS-HUB.md`). PI-006/007/008/013/014 are **done**: implemented,
parent-reviewed, linked for live discovery, and independently offline-tested.
Completion records implementation, not unperformed physical terminal acceptance;
those manual checks remain documented follow-ups. Existing sessions must
reload/restart. The plan/hub
safety adapter is integrated. See `pi/ORCHESTRATION-LIMITATIONS.md` and
`node pi/tests/feature-integration.test.mjs` for combined discovery/dispatch checks.
Other tickets remain **proposed** unless marked otherwise.

## Shared implementation policy

- First use built-in Pi capabilities, then small, auditable local extensions.
- **Using popular plugin code is acceptable and desirable** when it is
  **non-malicious, safe, functional, and satisfies the user's requirements**.
  Popular plugins are often well tested through broad real-world use and can
  provide a good starting point for our implementations. Reuse suitable code
  and functionality, not just design ideas; do not rewrite solely to avoid reuse.
  The user's concern is preventing malicious/untrusted code execution, not
  prohibiting reuse. Review source before running or integrating it; retain
  required license notices and provenance when copying. Popularity and broad
  real-world adoption are positive selection signals: mature, widely used plugins
  often provide better-tested functionality and UX than a fresh local rewrite.
  Prefer evaluating established popular implementations before reinventing them.
  The concern is **blind adoption**, not popularity or reuse; popularity alone
  does not replace source/dependency review, compatibility checks, or testing.
  Record repository URL, commit, license, maintenance/API compatibility, and a
  short security review. No popularity ranking has been researched yet; do not
  claim a reference is the most popular without evidence.
- Prefer official installed examples as initial API references. Examples are
  demonstrations, not production-ready guarantees.
- If copying code, retain required license notices and provenance. Otherwise
  implement a minimal local design from documented contracts.
- Do not execute unreviewed downloaded code, enable automatic plugin updates,
  or implicitly run npm install. Reviewed, suitable plugin code may be integrated
  and tested under the reuse policy above; downloading code is not itself a ban
  on using it.
- Review dependencies as well as the extension itself. Local/generated code also
  requires review and tests; it is not trustworthy merely because it is local.
- Respect project trust; importing Claude resources must not bypass it.
- Handle reload, session replacement, cancellation, crashes, and restart recovery.
- Specify interactive/RPC/headless behavior; never fabricate user approval.
- Test regular/fullscreen mode, narrow terminals, resizing, Unicode and keybinding
  conflicts. Keep credentials and private transcripts out of the repository.

## Suggested sequence

1. PI-007 (small alias), PI-006 (draft UX), PI-008 (reusable questions UI).
2. PI-001a (skills/commands discovery) and PI-003 (minimal subagents).
3. PI-005 (worktrees) and PI-002 (safe checkpoints/rewind).
4. PI-004 (secondary-LLM permission classifier); expand PI-001 compatibility
   incrementally against a versioned Claude Code compatibility matrix.

Sequence is a recommendation, not a user-approved priority list. Safety design
for checkpoints should precede autonomous write workflows.

Testing capabilities: validate existing image support (PI-011) first, then prefer
browser automation (PI-009) for websites; add desktop automation (PI-010) for
native apps and interactions not accessible through browser APIs. These tickets
serve future testing workflows for apps and websites we design, not merely
interactive browsing or desktop demos.

---

## PI-001 — Claude resource compatibility bridge

**Status:** proposed | **Size:** large; split into slices

**Request:** Maximum Claude Code compatibility for a corporate environment
entrenched in Claude Code, not just importing a few selected plugins. Existing
corporate resources should remain the source of truth, without Pi-specific forks.
Moving/symlinking a `.claude` directory into `.pi` should discover its resources
without installing public Pi plugins. Incremental delivery is acceptable as an
engineering strategy, not a reduction of the intended compatibility scope.

**Current Pi:** Supports Agent Skills `SKILL.md`, configured skill paths,
`~/.agents/skills`, project `.agents/skills`, and `CLAUDE.md` context files.
This is not a Claude Code plugin runtime. Merely nesting `.claude` under `.pi`
is not a documented whole-plugin import mechanism.

**Decisions needed:** Exact global/project layouts (e.g. `.pi/.claude` versus
`~/.pi/agent/.claude`); baseline Claude Code version; discovery and precedence
rules. Do not require the user to select specific plugins to justify scope.
Representative sanitized corporate fixtures can validate semantics later.

**Compatibility approach:**
- Research current official Claude Code resource/plugin specifications before
  implementation; maintain a versioned matrix of supported, partial, unsupported
  and intentionally restricted features, with reasons and conformance fixtures.
- Inventory instructions/rules, skills, commands and argument substitutions,
  agent definitions/tool names, manifests/namespaces/plugin resource resolution,
  settings/permissions, hooks and their payload/exit semantics, and MCP config.
  This is a research checklist, not a claim that every item is implementable.
- Preserve resource-relative paths and applicable environment substitutions.
  Treat plugin caches/registries and enabled-plugin state as discovery inputs
  only after verifying their actual formats and trust semantics.
- Keep compatibility parsing/mapping separate from Pi execution adapters.
- Never silently weaken an imported corporate permission or mandatory hook.
  Refuse operations/resources whose required enforcement cannot be reproduced;
  make limitations visible in a compatibility report.
- Corporate approval of Pi/provider usage remains separate from format support;
  do not assume Claude Code approval authorizes another harness or endpoint.

**Slices:**
- PI-001a: skills and Markdown commands, symlink-aware discovery and diagnostics.
- PI-001b: agent definitions mapped into PI-003, with explicit field conversion.
- PI-001c: plugin manifests/resource inventories and MCP configuration mapping.
- PI-001d: optional hook adapters only after a separate security/semantics review.

**Acceptance:**
- Fixture `.claude` directory works both directly and via symlink; resolve
  relative assets correctly; detect symlink cycles and duplicate resources.
- Namespaces/collisions and user/project precedence are documented and tested.
- List imported, skipped, unsupported and permission-sensitive resources.
- Unsupported Claude-only fields/tools/hooks are reported, not silently ignored
  or represented as enforcing permissions they do not enforce.
- No automatic execution of hooks, plugin installers or MCP servers merely from
  discovery. Explicit approval/configuration for executable capabilities.
- Do not move or alter the user's original `.claude` directory.

**References:** installed `docs/skills.md`, `docs/configuration.md`,
`docs/prompt-templates.md`, `docs/mcp.md`; `examples/extensions/claude-rules.ts`,
`examples/extensions/dynamic-resources/`.

## PI-002 — Unified conversation and code rewind (`/rewind`, Ctrl+R)

**Status:** proposed | **Size:** large

**Current Pi:** `/tree` provides non-destructive conversation branching; `/fork`
creates a separate session. Neither is a general filesystem rollback feature.
Official `git-checkpoint.ts` is illustrative: its in-memory refs, stash apply,
and coverage are not sufficient for durable exact restoration.

**Decisions needed:** Checkpoint granularity; agent-touched files versus whole
workspace restoration; ignored/untracked file coverage; non-Git repositories;
retention/storage limits; treatment of branch summaries on conversation rewind.

**Acceptance:**
- `/rewind` and Ctrl+R open the same checkpoint picker with conversation only,
  code only, and both choices. Preview affected files and conversation target.
- Conversation-only leaves files untouched; code-only leaves branch untouched.
- Persist checkpoint-to-session-entry mappings and snapshot data across restart.
- Preserve pre-existing dirty/index state and unrelated user edits; detect
  intervening edits and refuse or explicitly resolve conflicts.
- Support edits/deletions/renames and clearly state untracked/ignored coverage.
- Do not use blanket `reset --hard` or `clean`; retain a recovery snapshot before
  applying restoration. Test partial failure and recovery of combined rewind.
- Explain that shell/network/database effects are not generally reversible.
- Ctrl+R must not hijack session-picker rename or custom dialog input.

**Dependencies:** May reuse PI-008; coordinate filesystem ownership with PI-005
and PI-003. Conversation-only can ship before filesystem snapshots.

**References:** `docs/sessions.md`, `docs/session-format.md`, extension session
navigation contracts, `examples/extensions/git-checkpoint.ts`.

## PI-003 — Subagent plumbing, interactive Agents Hub and communication

**Status:** in-progress — initial plumbing and redesigned UI implemented; lifecycle/messaging completion and user validation remain | **Size:** large; sliceable

**Implementation:** `pi/.pi/agent/extensions/agents-hub/`, personal definitions
under `pi/.pi/agent/agents/`, usage/limits/provenance in `pi/AGENTS-HUB.md`.
Automated tests cover registry/messaging/lifecycle, role discovery/trust,
independent cwd/tool selection in non-Git directories, TUI widths/scrolling,
transport errors/framing and offline Pi RPC startup. Automated tests make no
model requests. User-authorized live adversarial and source-research agents were
launched using the pre-correction runtime; reports and follow-up messaging worked.
Source-review findings/provenance: `pi/research/PI-003-subagents.md`.

### Finished in the current implementation

- [x] Background, long-lived Pi RPC child processes; stable IDs and session-local
  registry, configurable connection/launch/turn/lifetime limits.
- [x] Independent working directory and built-in tool selection. Default cwd is
  the parent's existing directory; no Git requirement, copying, worktree lifecycle,
  automatic commits, merges or workspace cleanup.
- [x] Personal `~/.pi/agent/agents/*.md` and trusted project `.pi/agents/*.md`
  definitions; project precedence, diagnostics and sample scout/worker roles.
- [x] Launch/list/read/send/wait/stop model-facing tool, `/agent`, `/agents`, and
  Alt+A hub access, including the transcript editor's NAV mode.
- [x] User-to-child and main-to-child messages: steering at turn/tool boundaries
  or queued follow-ups. Idle connected agents accept another prompt in their
  existing conversation. Child-to-main progress/questions/results use
  `message_parent`; reports enter passive next-turn context.
- [x] Message IDs/provenance and explicit delivery states; serialized startup/
  messages, preservation of confirmed delivery after lost acknowledgements, and
  protection against late acknowledgements reviving stopped mail.
- [x] Bounded waiting, cancellation of a wait without stopping the child, and
  explicit process termination. Closing the hub leaves agents running.
- [x] Themed responsive overlay: roster/activity panes, highlighted selection,
  state badges, Markdown, collapsed tool previews, scrollable metadata, pinned
  action bar, and compact expandable transcript reports.
- [x] Private persisted child sessions/event logs, bounded presentation buffers,
  child token/cost estimates, failure reporting and observer isolation.
- [x] Owned-process cleanup on parent shutdown/reload/session replacement;
  terminating connections count against admission until cleanup finishes.
- [x] Automated manager/definitions/transport/navigation tests, installed-Pi
  offline smoke checks, real dark/light-theme responsive UI tests and typechecking.
  A no-model-cost UI preview script is available.

### Still required — foundational plumbing

- [ ] **Separate interrupt from close.** Add an interrupt/abort operation that
  stops current work but leaves the agent connected and idle, preserving context.
  Define queued-message handling explicitly. Keep close/terminate as a separate,
  deliberate operation; the existing `stop` currently terminates the process.
- [ ] **Resume and recovery.** Reopen persisted sessions for closed/stopped/failed
  agents where valid; preserve conversation and identity/lineage, validate cwd,
  model, tools and policy before restarting, and report missing/corrupt artifacts
  or ambiguous interrupted execution honestly. Define parent restart/reload and
  session-switch discovery/ownership. Reconnect only if transport supports it;
  persisted `running` state is not evidence of a live process.
- [ ] **Addressed inter-agent messaging.** Add caller-authorized sibling routing
  through the parent-owned transport, stable addressing, ownership checks and
  defined busy/idle/disconnected delivery. Include queue/rate/wakeup limits and
  loop protection, without prescribing which agents should communicate or why.
- [ ] **Configurable parent delivery/wakeup policy.** Keep passive next-turn
  delivery available; optionally allow child reports to trigger an idle parent's
  model turn. Specify batching, message/result consumption, cancellation/reload
  behavior, budgets and feedback-loop prevention. Do not make automatic wakeups
  an implicit default or silently drop reports after a cap without visibility.
- [ ] **Complete usage accounting.** Include compaction and delegated usage with
  clear ownership, integrate with PI-012, and prevent double counting. Distinguish
  estimated API cost from subscription quota consumption.
- [ ] **Explicit capability/configuration inheritance.** Define supported child
  extensions, skills and custom/MCP tools instead of always disabling them;
  preserve project trust and applicable parent permissions. PI-004 approval/auto
  policy and PI-013 planning restrictions must not be bypassed by delegation.
  Broader Claude definition mapping remains coordinated with PI-001.
- [ ] **Stable extension-facing control API.** Formalize validated lifecycle,
  addressing/message and observation contracts for optional orchestrators, with
  request correlation, ownership, errors and lifecycle cleanup; do not require
  consumers to create extra managers and bypass the registry/budgets.

### Remaining UX and validation

- [ ] User visual acceptance and live exercise of the latest implementation in
  WezTerm -> tmux -> Neovim terminal: Alt+A, draft preservation, dialogs, streaming,
  resize, interrupt/close/resume and simultaneous agents. Existing live review
  exercised an earlier runtime; automated rendering is not terminal acceptance.
- [ ] Inline composer in the hub, with focus/IME, multiline editing, draft and
  per-agent message-state handling. The current separate multiline dialog works;
  an inline composer is a UX enhancement, not a Pi restriction.
- [ ] Further hub settings/keybinding discoverability; optional mouse interaction.
- [ ] Regression tests for every new lifecycle/message policy, including failed
  startup/resume, queued messages, cancellation, shutdown and cross-agent loops.

### Pi constraints versus implementation choices

Resume, inline composition, sibling routing and parent wakeups are supported by
Pi's building blocks or can be built with its extension APIs; their absence here
is **not a fundamental Pi limitation**. Resume, clear interrupt/close semantics
and addressed communication are foundational ticket work, not a request to adopt
an orchestration framework. Normal steering does have a delivery boundary: after
the current assistant turn/tool execution, not injection into an already-running
model request or shell command. Interrupting that work is a separate operation.

**Out of scope for the core:** workflow interpreters, role hierarchies, schedulers,
automatic commits, worktree creation/integration/cleanup, and compulsory shared-
checkout serialization. Optional orchestration may consume the primitives later.
PI-003 is not complete merely because the first launch/hub slice is usable.

**Request:** Underlying primitives to launch subagents, inspect their work in an
Agents Hub opened with **Alt+A**, and interact with them. The main session and
subagents must be able to communicate bidirectionally. This is not a request
for an opinionated orchestration framework such as oh-my-openagent. Keep the
primitives configurable/composable so the user can build or configure that kind
of orchestration later without making it mandatory. Workspace setup is explicitly
a user/orchestrator choice: launch in a supplied existing cwd (default parent),
with tool capabilities selected independently. No built-in Git worktree management
or compulsory isolation for implementation agents.

**Current Pi:** Not a default built-in workflow. Official subagent example uses
separate Pi processes with isolated conversation contexts, streaming and aborts.
Separate context is not an OS/filesystem security boundary. Assess whether its
one-shot delegation model is sufficient for interactive messaging; do not assume
streaming output alone provides an interactive agent session.

**Architecture direction:** Separate agent lifecycle/session registry, message
transport, and streaming event APIs from hub rendering and optional orchestration
policies. Expose documented tools/commands or local extension APIs so user-defined
roles, chains, schedulers or coordination policies can be added without replacing
core plumbing. Do not ship automatic planning/delegation/review loops as defaults.

**Resolved:** RPC subprocess runtime; existing cwd defaulting to parent;
independent tools; named Markdown roles; background execution; steering versus
follow-up delivery; Alt+A hub with a separate message dialog. Closing the hub does
not stop agents. Current shutdown/reload closes children and retains artifacts.

**Decisions still needed:** Interrupt queue semantics; resume identity/ownership
and recovery guarantees; allowed sibling-message scope; explicit parent-wakeup
settings; capability/policy inheritance; control API shape; optional foreground
execution; further UI/keybinding preferences. These decisions must not reintroduce
workspace policy or a mandatory workflow engine.

**Slices / progress:**
- PI-003a — **partial:** launch/registry/limits/termination done; interrupt versus
  close, persisted-session resume and recovery remain.
- PI-003b — **partial:** main/user-child messaging and passive child-parent reports
  done; sibling addressing, configurable wakeups and durable delivery policy remain.
- PI-003c — **partial:** themed Alt+A hub and dialog-based interaction done;
  user/live terminal validation, inline composer and optional mouse UX remain.
- PI-003d — **partial:** configuration/docs and observable manager primitives done;
  stable validated external controls, inheritance and complete accounting remain.

**Acceptance:**
- Launch agents from the main session and user-facing controls; explicit
  role/tool/model/thinking/workspace selection and bounded concurrency,
  recursion, time and output. No mandatory role topology or workflow engine.
- Alt+A opens the Agents Hub. Show agent identity, task, lifecycle/busy/waiting/
  failure state, model, workspace and usage; select an agent to view streaming
  transcript/tool activity, inspect full retained output and send it a message.
- Support user interaction without losing the main-session draft or killing
  background work when the hub closes. Provide deliberate cancellation/stop
  controls; distinguish viewing an agent from transferring input focus to it.
- Main session can message a running agent and receive its progress, questions,
  blockers and results; an agent can message/request help from the main session.
  Do not limit communication to a final tool-result summary after child exit.
- Messages have stable sender/recipient IDs and explicit queued/delivered/failed
  states; document ordering, busy/idle delivery, whether a message triggers a
  model turn, and what acknowledgement does (not imply an agent acted on it).
- Preserve provenance of user/main/agent messages. Bound queues, context growth,
  wakeups and costs; prevent accidental ping-pong and recursive agent spawning.
  Define routing when the main session is busy or waiting on the child.
- Expose reusable lifecycle/message/event primitives independently of the TUI;
  future user-configured orchestration should be a consumer of those APIs, not
  hard-coded into the hub. Define headless/RPC behavior explicitly.
- Distinguish cancelling a wait, interrupting current work, and closing an agent.
  Interrupt preserves the session for more messages; close terminates its process.
  Resume valid persisted conversations without silently resetting their context.
- Route addressed main/child/sibling messages with explicit ownership and delivery
  semantics. Make parent wakeups a configurable, bounded policy, not a fixed
  implementation restriction or an automatic orchestration loop.
- Propagate cancellation and terminate owned processes reliably; define behavior
  on hub close, reload, parent exit, crash and restart. Report orphaned/disconnected
  agents honestly; do not promise reconnection without a supported transport.
- Report errors, token usage/cost and output truncation; retain inspectable logs
  outside the tracked configuration repository.
- User agents supported; project agents require trust. Optional Claude agent
  import uses PI-001 mapping and reports unsupported fields.
- Permit callers to choose shared checkout, non-Git directory or an externally
  prepared worktree. Tool grants must not imply workspace creation or relocation.
  Coordination/serialization/isolation belong to the user or optional orchestrator,
  not a mandatory framework in the launch primitive. Do not claim cwd or tool
  allowlists sandbox bash.
- Child extension loading and permission inheritance (PI-004) are explicit;
  delegation must not silently bypass parent policy or enable recursive tooling.
- Audit Alt+A across Pi dialogs, shell/editor, WezTerm, tmux and Neovim; coordinate
  with PI-012 and avoid intercepting input owned by another interaction.
- Test lifecycle, message routing and cancellation independently from the UI,
  including parallel agents, blocked parent/child interactions and failures.

**Dependencies:** PI-008 reusable interaction UI where useful, PI-012 keybinding/
status integration and PI-004 permission policy. PI-005 may supply optional
worktree UX later; it is not a dependency for launching implementation agents.

**References:** `examples/extensions/subagent/README.md`, `index.ts`, `agents.ts`;
read `docs/sdk.md`, RPC/CLI and TUI docs before choosing transport/runtime.
Research public agent-hub implementations as design references without installing
an orchestration framework. Pinned source-review references and findings are in
`pi/research/PI-003-subagents.md`.

## PI-004 — Auto mode: configurable secondary-LLM permission classifier

**Status:** proposed; core meaning confirmed by user | **Size:** medium/large

**Request:** A configurable secondary LLM classifies proposed actions for
permission decisions, like the requested Claude Code auto-mode workflow. This
is not a task-continuation loop or plan mode. User identified `pi-automode` as a
public reference; resolve its exact repository and review a pinned commit and
license before using it as a design reference. It has not yet been inspected.

**Current Pi:** Normally executes tools without per-call approval. This feature
adds a permission gate; it must not be presented as enabling execution that Pi
otherwise forbids.

**Decisions needed:** Classifier provider/model and corporate-approved endpoint;
policy schema; context supplied; deterministic allow/deny rules; when to ask the
user; manual approval behavior when auto classification is disabled; inheritance
by subagents; timeouts, budgets and audit retention.

**Proposed architecture:** Deterministic policy checks -> classifier for eligible
unresolved calls -> allow / deny / ask-user decision. Explicit deny rules and
mandatory approvals cannot be overridden by the classifier. User approval is
scoped to the exact action, not an unrestricted bypass.

**Acceptance:**
- Configure classifier separately from the coding model (provider, model,
  supported thinking/options, timeout and bounded retry/cost behavior).
- Explicit mode/status controls; define off/manual behavior rather than silently
  falling back to Pi's unrestricted defaults after an error or reload.
- Validate structured classifier output; timeout, unavailable provider, malformed
  output or uncertainty never implicitly approves. Ask the user or block where
  UI is unavailable; avoid retry loops.
- Classify the exact pending tool name/arguments/cwd and bounded relevant user
  intent/context before execution. Invalidate decisions if arguments change;
  verify hook ordering and argument mutation against other extensions.
- Treat tool arguments, repository content and outputs as untrusted data in the
  classifier prompt; test prompt-injection attempts and compound shell commands.
- Never send secrets or corporate content to an unapproved external classifier;
  minimize/redact context and keep audit data outside tracked configuration.
- Cover built-in/custom/MCP tools, nested calls, user bash and delegated agents
  through verified integration paths; expose bypasses/limitations explicitly.
  Do not claim this intercepts arbitrary extension-side OS operations.
- PI-008 supplies ask-user UI; cancellation, parallel pending approvals, shutdown
  and reload must not execute unapproved actions or leak queued calls.
- Record decision/reason/model/policy version with appropriate redaction;
  cache only when scoped safely, never as blanket future authorization.
- Classifier decisions are a best-effort permission layer, not a security sandbox.
  OS/container isolation and corporate policy enforcement remain separate.

**References:** user-specified `pi-automode` (repository/review pending);
`docs/security.md`, tool-call contracts in `docs/extensions.md`,
`examples/extensions/permission-gate.ts`; provider/model runtime contracts.

## PI-005 — Git worktree lifecycle and session support

**Status:** proposed | **Size:** medium/large

**Current Pi:** The agent can invoke `git worktree` through bash; the checked
built-in command list does not provide a dedicated worktree UX.

**Decisions needed:** Worktree root, branch naming, dirty-tree policy, session
launch/switch UX, dependency/bootstrap commands, merge/cherry-pick preference.

**Acceptance:**
- Create/list/open worktrees with explicit branch/path ownership metadata.
- Launch a Pi session in the selected worktree with correct resource discovery;
  do not merely change a tool cwd and pretend the session has moved.
- Keep source checkout and existing dirty changes untouched by default.
- Integrate optional isolated subagent writers; provide diff/review and explicit
  merge/cherry-pick actions, with conflict reporting.
- Cleanup only owned worktrees after checking jobs, dirty files and unmerged
  commits; never force-delete user work automatically.
- Worktrees are Git isolation, not a credential/network/process sandbox.

**References:** Git worktree documentation; Pi session and SDK/CLI cwd contracts.

## PI-006 — Prompt stashing (Ctrl+S)

**Status:** done — implemented, reviewed, integrated; offline checks pass. Follow-up: reload/manual terminal acceptance | **Size:** small/medium

**Implementation:** `extensions/prompt-stash/index.ts`, live link installed;
usage/limits in `PROMPT-STASH.md`. Single memory slot, session-local;
restore into empty input; nonempty input replaces the previous stash and clears
the editor, as explicitly requested by the user. Submitting an ordinary interactive
message automatically restores/consumes the stash into the empty editor without
sending it; a newer nonempty draft is never overwritten by automatic restore.
Expanded text preserved; cursor/undo/attachment bytes and restart recovery are
not provided. Actual live discovery and registered Ctrl+S dispatch tested.

**Current Pi:** Editor undo/history and queued message restore exist, but no
prompt-stash action is listed in the installed keybinding reference.

**Implemented semantics:** Single-slot text stash, no persistence across session
replacement/reload/restart. Ctrl+S on a new nonempty draft overwrites any prior
stash (user-approved), with no swapping/combining; empty input restores/consumes
the stash. User-requested automatic restoration occurs after interactive message
submission, not assistant completion, and excludes RPC/extension input and
slash/shell commands. Text paths only for attachments and no cursor restoration.

**Acceptance:**
- Ctrl+S stashes an unsent draft and clears the editor; an empty editor restores
  the stash. Sending an interactive message auto-restores the stash into empty
  input without submitting it; retain stash if a newer draft is already present.
- Ctrl+S on nonempty input explicitly replaces the previous stash; notify when
  replacing. Preserve multiline/pasted content and define attachment handling
  without promising unsupported editor state restoration.
- Show stash availability; do not submit or leak it into model context.
- Compose with transcript-navigation editor; do not replace it independently.
- Preserve Ctrl+S inside model/thinking/settings/session dialogs; test terminal
  flow-control (XON/XOFF), Neovim terminal and tmux forwarding.

**References:** `docs/keybindings.md`, `docs/extensions.md`, editor access API.

## PI-007 — `/clear` alias for `/new`

**Status:** done — implemented, reviewed, integrated; 5 tests and actual offline RPC replacement pass. Follow-up: reload/manual terminal acceptance | **Size:** small

**Implementation:** `.pi/agent/extensions/clear-alias/index.ts`; usage in
`CLEAR-ALIAS.md`, plan/source review in `research/PI-007-*.md`.

**Current Pi:** `/new` exists; `/clear` is not in the installed built-in list.
Ctrl+C clearing editor text is unrelated.

**Acceptance:**
- `/clear` starts a fresh session using supported command-context session APIs.
- Match `/new` session replacement, shutdown/startup and veto/trust behavior;
  do not implement a cosmetic transcript wipe or delete saved sessions.
- Define behavior while streaming and with an unsent draft; match `/new` where
  possible and document any unavoidable difference.
- Add command discovery/help and tests for old-session preservation and reload.

**References:** command context `newSession` contract, `docs/sessions.md`,
`examples/extensions/commands.ts`.

## PI-008 — AskUser tool and polished question TUI

**Status:** done — implemented, regression-tested and user-accepted after reload, including final note placement and review colors | **Size:** medium

**Implementation:** `extensions/ask-user/{index,model,ui}.ts`, live link installed.
`ask_user` is model-callable, with a local stable-ID schema (not Claude wire
compatibility), inline custom screen and mandatory review. RPC/headless return
needs-user-input. Allowed for clarification in plan mode; usage in `ASK-USER.md`.

**Current Pi:** Built-in extension APIs supply select/confirm/input/editor/custom
UI. Official `question.ts` and `questionnaire.ts` demonstrate model-callable
questions, but are not automatically enabled as a Claude-style AskUser tool.

**Implemented defaults:** `ask_user`, local non-Claude schema, themed inline
custom screen with single/multi/text questions and explicit final review.
User verified submission, choices/text, multiline notes, discussion and cancellation.
Feedback fixes permit explicit partial or all-skipped submission (`answers` plus
`skippedQuestionIds`), keep notes separate,
omit unsaved drafts, enter text editing automatically, improve review layout, and
render cancellation status only. User reloaded, exercised the revised controls,
and confirmed that everything looks fine. The revision retains:
- Tab/Shift+Tab next/previous question (including inside editors); never selection
  or submission, and never global plan-mode switching while AskUser owns focus.
- `n` for optional per-question multiline notes, returned separately from answers.
- `d` to discuss any question (or highlighted question on review), returning
  `discussion-requested` with clearly partial selections, text drafts and notes.
  Discuss in conversation, then generate a fresh set of still-relevant questions;
  no automatic reopening or stale-question replay.
- Dedicated labelled descriptive-answer/note editors, not the main prompt line;
  preserved drafts, multiple-choice checkboxes, and no stale-answer submission.
- Numbered review blocks with bullet selections, unanswered/draft distinctions,
  multiline notes, no visible internal IDs, and cancellation rendering without recap.
- Follow-up: saved `Note:` blocks sit below choices and are scrolled into view
  after saving; no duplicate preview while editing. All review headings are
  accent-colored, answers use normal text, and notes use a distinct theme role.
  Tests cover note visibility with long choices/resize and actual dark/light colors;
  user accepted the final placement/color changes after reload.

The feedback revision is covered by 33 focused AskUser tests and typecheck;
Luna high implemented the fixes, and parent review added regression coverage for
legacy results, mixed partial submission, preview duplication and themed review
scrolling. Full-suite checks are recorded in the implementation report.

**Acceptance:**
- Structured single choice, multi-select and free text with option descriptions;
  Tab/Shift+Tab navigation, optional notes, automatic multiline text entry and a
  final explicit review/submit step allowing unanswered questions. Always offer
  discussion without submitting the questionnaire; reassess before a fresh request.
- Keyboard-first controls, visible help, cancellation, and no default/fabricated
  answer when cancelled. Preserve current prompt draft.
- Typed validated answer results with stable IDs; concise transcript rendering.
- Handle abort/reload/exit, concurrent question requests, resize, scrolling,
  narrow width, Unicode, themes and proper editor focus/IME propagation.
- TUI uses custom components; RPC uses supported dialogs or reports unsupported
  interaction. Headless mode returns an explicit needs-user-input result.
- Keep UI logic separate from the tool so rewind/auto/worktree commands can reuse
  components without treating a tool answer as blanket authorization.

**References:** `docs/tui.md`, `docs/rpc-extension-ui.md`,
`examples/extensions/question.ts`, `questionnaire.ts`, `qna.ts`.

## PI-009 — Browser use for website/app testing

**Status:** proposed | **Size:** medium/large

**Goal:** Let Pi interact with and test websites/web apps we build: exercise user
journeys, inspect failures, and collect evidence. Research existing solutions as
references without installing third-party Pi plugins automatically.

**Decisions needed:** Browser backend (e.g. Playwright/CDP versus an MCP adapter);
headless/headed use; local versus remote browser; supported browsers; persistent
session policy; test runner integration versus exploratory agent operation.

**Acceptance:**
- Navigate, inspect DOM/accessibility information, locate elements, click, type,
  scroll, wait for explicit conditions, and capture screenshots.
- Prefer semantic locators and browser APIs over screenshot-coordinate clicking
  when possible. Handle tabs, frames, dialogs, uploads/downloads and timeouts
  with explicit scope and documented limitations.
- Capture console errors, failed requests and useful artifacts (screenshots,
  traces, optional video) with retention/redaction controls.
- Demonstrate a repeatable local-app flow: start/connect to the test server,
  exercise a user journey, assert expected behavior, report pass/fail with
  evidence, and clean up. Distinguish exploratory observations from assertions.
- Use dedicated test profiles/accounts/data; do not attach to the user's personal
  authenticated browser by default. Explicit approval for sensitive submissions,
  external side effects and connecting to an existing browser profile.
- Treat page content as untrusted, bound navigation/download access, document
  network limits, and integrate actions with PI-004 where enabled.
- Cancel reliably and clean up owned browser processes; do not kill unrelated
  sessions. Keep deterministic test scripts/artifacts reusable outside Pi.

**Dependencies:** PI-011 for model-visible screenshots and user inspection;
PI-004/PI-008 for permission decisions. Worktrees/test servers need explicit
ports, profiles and ownership when agents run in parallel.

**Reference candidates (not reviewed):** Playwright and Playwright MCP,
Chrome DevTools MCP, browser-use, existing Pi browser extensions. Research
current repositories, licenses, APIs and tradeoffs before selecting a backend.

## PI-010 — Computer use for desktop/native-app testing

**Status:** proposed | **Size:** large; platform-dependent

**Goal:** Let Pi test native apps and GUI workflows that browser automation
cannot reach, with screenshots, pointer/keyboard actions and inspectable results.
Existing computer-use implementations may be reviewed as design references.

**Decisions needed:** Target OS and display stack (Linux X11/Wayland, macOS,
Windows); local versus isolated/remote desktop; accessibility versus coordinate
backend; supported multi-monitor/DPI behavior; permission prerequisites.

**Acceptance:**
- Capture screenshots; click, drag, scroll, type and send key combinations;
  inspect accessibility/UI automation state where available.
- Correctly map screenshot pixels to display coordinates across scaling,
  resizing and supported monitor setups; reject stale/invalid targets.
- Prefer an isolated test desktop/VM with test accounts. Never silently take over
  the user's active desktop; require explicit opt-in to local desktop control.
- Provide visible activity, bounded action loops, immediate emergency stop,
  cancellation and cleanup. No input actions after cancellation.
- Gate destructive/system/credential-sensitive actions, document OS permissions
  and avoid broad hidden screenshot capture. Integrate with PI-004 as applicable.
- Treat on-screen instructions as untrusted input. Document that model-based
  approval is not isolation and coordinate control is inherently fragile.
- Demonstrate an app-testing scenario with assertions/evidence and failure
  diagnostics; do not report success solely because input commands executed.
- State unsupported environments explicitly and keep artifacts/private desktop
  content out of tracked config and unapproved model endpoints.

**Dependencies:** PI-011; may reuse PI-009 artifact/reporting conventions and
PI-008 approval UI. Browser use should remain the default for web testing.

**Reference candidates (not reviewed):** Anthropic computer-use reference demos,
OS accessibility/UI automation APIs, existing Pi computer-use extensions and
isolated desktop automation projects. Verify actual platform support and license.

## PI-011 — Image prompting and display: validate and fill gaps

**Status:** proposed | **Size:** small audit initially; follow-up scope TBD

**Goal:** Attach design references/screenshots to prompts, let the model inspect
testing screenshots, and let the user view captured images in the workflow.
This is image input/display, not a request for image generation.

**Current Pi (documented, not verified end-to-end in this setup):**
- Interactive file/image attachment via `@`, paste or drag in a compatible
  terminal; default image clipboard shortcut is Ctrl+V.
- Built-in `read` supports images; extensions can supply image content.
- Inline image display is supported when the full terminal path supports it.
  Settings include `terminal.showImages`, `terminal.images` (auto/kitty/iterm2/
  false), `terminal.imageWidthCells`, `images.autoResize`, `images.blockImages`.
- Model/provider must support image input; display capability and model vision
  capability are independent.

**Acceptance:**
- Audit existing support before adding any extension. Test a known image through
  file attachment, clipboard and tool-result/read paths with a vision model.
- Verify model receives the image, not merely its filename/text placeholder;
  report non-vision models or blocked images clearly.
- Test user-visible rendering directly in WezTerm and through the actual
  tmux/Neovim terminal stack, both regular/fullscreen modes. Do not force an
  image protocol unsupported by any intermediate terminal layer.
- Provide a usable artifact-path/external-viewer fallback where inline display
  is unavailable; do not claim all terminal paths can render images.
- Verify resizing/format/size limits and preserve original screenshot metadata
  for PI-009/PI-010 coordinate mapping; do not act on resized pixels as if they
  were original desktop coordinates.
- Document supported workflows/settings and only implement confirmed gaps;
  include clipboard dependencies, SSH/headless limitations and privacy behavior.
- Keep screenshot capture, sending to a model, and user display separate so
  privacy controls and headless automation work independently.

**References:** installed `docs/usage.md`, `docs/keybindings.md`,
`docs/settings.md`, `docs/terminal-setup.md`, `docs/tmux.md`, `docs/tui.md`;
inspect image tool/content contracts and terminal implementations when needed.

## PI-012 — Organized prompt status bar and workflow-compatible shortcuts

**Status:** proposed | **Size:** medium

**Goal:** A clean, organized status area near the prompt with auto-mode state,
active coding model and thinking level always identifiable, plus sensible
shortcuts compatible with the user's terminal/editor workflow. Show billing-aware
usage metrics: subscription quota consumption for OpenAI subscription models,
and direct monetary cost for API-billed models, so the user can pace usage.

**Current setup:** Pi already exposes model/thinking controls and extension
footer/editor/status APIs. Local `absolute-context-footer.ts` customizes the
footer and `transcript-navigation.ts` customizes the editor. Inspect both before
designing a consolidated layout; do not stack competing replacements.

**Decisions needed:** Footer versus editor-border placement; one/two-row layout;
information hierarchy at narrow widths; whether to show classifier model inline
or in expanded details; preferred auto-mode shortcut and transition semantics.
Agree on a layout/keybinding proposal before implementation.

**Usage requirements confirmed by user:** Currently uses OpenAI models through a
subscription and wants consumption of the applicable 5-hour and weekly limits
visible in the statusline. For future API-billed models (e.g. the user's
DeepSeek Flash example), show monetary cost instead of irrelevant subscription
quotas. Verify actual provider/model IDs and available pricing at implementation.

**Usage research/design:** Determine whether Pi/provider adapters already expose
subscription usage via response metadata or an authorized account-usage API.
Review existing implementations as references. Do not assume an official endpoint
exists or that local token totals can reconstruct account-wide subscription
limits. Any reliance on undocumented interfaces must be disclosed and agreed.

**Acceptance:**
- Clearly labeled, grouped state: coding provider/model, thinking level and
  permission mode (including auto/manual/off as actually defined by PI-004).
  Distinguish classifier model from coding model when displayed.
- For supported OpenAI subscription accounts, show clearly labeled **5h used %**
  and **weekly used %**, with reset countdowns/times where available. These are
  account/provider quota metrics, not context-window usage or local token totals.
  Verify the meaning of each upstream window, including model-specific/shared
  quotas; never label remaining percentage as used or assume every account has
  the same limits.
- For API-billed sessions, show session monetary cost with currency and scope.
  Prefer authoritative returned cost where available; otherwise calculate from
  verified model pricing and reported usage, including cached input/output and
  applicable charges, and label it as an estimate. Missing pricing is unknown,
  not zero. Do not present local cost as the account's invoice/balance.
- Choose quota versus cost using the actual provider/authentication/billing mode,
  not model name alone; update immediately on provider/account/model switches.
  Mixed-billing sessions should distinguish active-account quotas from accumulated
  API cost; define inclusion of classifier/subagent usage without double counting.
- Keep these metrics visible in the default layout (not only a details dialog).
  Compact labels such as `5h: 42% used | week: 61% used` or `API: ~$0.18 session`
  are illustrative, not real readings or a final layout decision.
- Fetch asynchronously with bounded polling, cache/backoff and clear freshness
  semantics. Mark stale/unavailable/unsupported data honestly; never fabricate
  quota values or display stale values from a different account. Do not expose
  credentials, scrape login sessions, or send usage data to unrelated services.
- Test reset boundaries, used/remaining conversions, missing/changed response
  schemas, auth failures, account switches, rate limits and cost aggregation.
- Never imply auto protection is active when the classifier is unavailable,
  policy is not loaded, or the gate is disabled; distinguish checking, waiting
  for approval and failure from ordinary enabled state.
- Keep useful context usage/token budget information from the existing footer;
  prioritize essentials, with responsive abbreviation or an intentional second
  row rather than unreadable clutter. Preserve INPUT/NAV visibility.
- Read live state rather than duplicate settings; update on model/thinking/mode
  changes, session replacement and reload. Work before PI-004 exists without
  presenting a nonfunctional auto-mode control.
- Audit existing `keybindings.json`, extension shortcuts, WezTerm/tmux/Neovim
  mappings and contextual Pi dialog bindings before proposing changes.
- Provide discoverable select/cycle-model, cycle-thinking and permission-mode
  controls. Prefer named built-in actions where available; make extension
  shortcuts configurable and show a concise help/keymap reference.
- Preserve Ctrl+P/Ctrl+N navigation, Ctrl+U/Ctrl+D transcript scrolling,
  Ctrl+Q INPUT/NAV toggle and existing Alt+N model cycling unless explicitly
  agreed otherwise. Coordinate planned Ctrl+R rewind and Ctrl+S prompt stash.
- Do not take keys from active dialogs, text input, Neovim terminal escape or
  tmux prefixes. Verify forwarding and conflicts in the actual terminal stack;
  do not rely on ambiguous terminal key combinations.
- Changing permission modes must be deliberate and visibly acknowledged;
  document whether cycling can enter unrestricted mode and require confirmation
  for weakening policy where appropriate.
- Test regular/fullscreen, narrow widths, resize, Unicode, themes and missing
  status providers. Include enable/disable instructions and regression tests.

**Dependencies:** Coordinate PI-004 (permission state), PI-006/PI-002 (shortcuts)
and existing footer/navigation extensions. Layout/keymap work can begin before
those features are implemented.

**References:** installed `docs/keybindings.md`, `docs/extensions.md`,
`docs/tui.md`, `docs/terminal-setup.md`; `examples/extensions/custom-footer.ts`,
`border-status-editor.ts`, `model-status.ts`; local footer/editor implementations.

## PI-013 — Plan mode: explore, propose, review, then execute

**Status:** done — free-switch/file-artifact workflow implemented; 16 unit + 5 hub tests, typecheck and offline RPC checks pass. Follow-up: reload/manual terminal acceptance | **Size:** medium

**Implementation:** `extensions/plan-mode/`, live link installed. `/plan`
enter/show/edit/approve/cancel/leave; Shift+Tab freely switches plan/normal.
Restricted read tools plus local AskUser and a dedicated Markdown plan artifact;
revision-specific approval remains an optional review action, not an exit gate.
Markdown files live at `~/.pi/agent/plans/<session-id>/<revision-uuid>.md` (agent-dir
override honored); `/plan show` presents the path and current content. Draft saves
use new files to preserve older branch artifacts; external edits are read back.
Existing footer displays mode status. `agents-hub/plan-policy.ts` vetoes entry with live
children, guards launches/messages and waits for child cleanup on restricted
branch restore. Usage/limitations in `PLAN-MODE.md`.

**Request:** Add an explicit plan mode for investigating a task and preparing a
reviewable implementation plan before making changes. This is distinct from
PI-004's secondary-LLM permission classifier and is not a mandatory orchestration
framework.

**Current Pi:** Plan mode is not a default built-in workflow. An official
`examples/extensions/plan-mode/` example exists as an implementation reference;
review its current source/contracts and public alternatives before implementation.
The official example and OpenCode Plan/Agent implementations were reviewed as
references; pinned provenance is in `research/PI-013-references.md`. No third-party
plugin was installed. Reviewed code reuse is allowed under the shared policy.

**User decisions (supersede the original approval-gated/session-only design):**
- Shift+Tab switches freely between planning and normal/build mode. Leaving plan
  mode must not warn, request confirmation, or require plan approval. Explicit
  mode switching is sufficient user intent; it does not claim plan approval or
  start work automatically. Other permission gates remain independent.
- Store plans as dedicated Markdown files, present their paths and contents for
  user review, and support revisions. Session history can retain branch-local
  snapshots/metadata but is not the sole plan artifact.
- Shift+Tab replaces thinking-level cycling with user agreement; thinking-level
  cycling is now Ctrl+Alt+T. Busy/child admission checks remain operational guards.

**Acceptance:**
- Explicit plan/execute state with clear command controls and PI-012 statusline
  visibility. Propose keybindings after auditing existing controls; do not take
  Shift+Tab from thinking-level cycling without user agreement.
- In plan mode, inspect code and gather requirements without modifying the
  application or triggering mutating/external actions. Define permitted tools
  and any narrowly scoped plan-artifact write exception explicitly.
- Enforce restrictions through verified tool gates/loadouts, not only a system
  prompt. Address shell, custom/MCP tools, nested calls and delegated agents;
  block unknown capabilities or report unsupported coverage rather than imply
  they are read-only. Tool restrictions are not an OS sandbox.
- Produce a concrete, editable plan with scope, affected components, ordered
  steps, risks/open questions, dependencies and validation criteria.
- Support clarification, revision, approval and cancellation. Approval must be
  an explicit user action, not inferred from model text or a classifier verdict.
- Transition to normal/build on explicit user mode switching without warnings
  or approval dialogs. Keep optional explicit plan approval distinct from mode
  selection and preserve the plan and relevant findings. Neither action grants
  blanket permission for future tool calls; PI-004 and other policies still apply.
- Keep a lightweight task-progress view optional; no automatic role hierarchy,
  delegation loop or worktree creation. User/orchestrator chooses workspaces.
- If subagents are used during planning, explicitly propagate compatible planning
  restrictions or refuse delegation that could bypass them.
- Handle restart/reload/session replacement and failed/cancelled transitions
  without silently entering an unrestricted execution mode. Define RPC/headless
  behavior without fabricating approval when no user is present.
- Test mode transitions, gate coverage, plan preservation, cancellation,
  subagent interactions, keybindings and status updates. Include disable/usage
  documentation and disclose any enforcement limitations.

**Dependencies:** Coordinate PI-003 (optional delegation and capability policy),
PI-004 (independent permission decisions), PI-008 (review/clarification UI),
PI-012 (visible mode and shortcuts). Basic plan mode should not require a full
orchestration framework or automatic worktree management.

**References:** installed `examples/extensions/plan-mode/`, `docs/extensions.md`,
`docs/security.md`, `docs/tui.md`; public implementations to research read-only
and pin before adopting design details.

## PI-014 — Ctrl+Y to accept picker options

**Status:** done — implemented, integrated; offline tests pass. Follow-up: reload/manual terminal validation | **Size:** small

**Implementation:** `extensions/picker-accept/input.ts` composed into the existing
transcript editor; `keybindings.json` adds Ctrl+Y to `tui.select.confirm` alongside
Enter. Usage/coverage/disable notes: `PICKER-ACCEPT.md`.

**User decision:** Losing yank in favor of acceptance is explicitly approved,
including confirmation/submission in text dialogs. Main-editor completion still
uses Tab's no-submit path. Custom dialogs must honor the confirm action or opt in.

**Request:** Allow Ctrl+Y to accept the highlighted picker/completion option,
like Neovim completion acceptance and similar to the existing Tab behavior.
Keep Tab available; Ctrl+Y is an additional binding, not a replacement.

**Acceptance:**
- Ctrl+Y accepts the highlighted option in supported pickers/completion menus;
  match the existing acceptance behavior for that UI rather than submitting the
  main prompt accidentally.
- Audit built-in and extension pickers; document coverage and any unsupported
  surfaces instead of claiming a global binding works everywhere.
- Bind Ctrl+Y to confirmation, including text-dialog submission as explicitly
  approved by the user. Preserve Tab and prevent accidental main-prompt submission
  while accepting autocomplete; document custom-dialog coverage.
- Compose with the existing transcript-navigation editor and PI-012 keybindings;
  do not add a competing editor replacement.
- Test Ctrl+Y and unchanged Tab behavior, filtering/navigation, cancellation,
  empty/no-selection states, and forwarding through WezTerm/tmux/Neovim terminal.
- Include usage and disable/rebinding instructions.

**Dependencies:** Coordinate PI-012 (shortcut audit) and PI-008 (reusable pickers).

## PI-015 — Context-aware shortcut conflict diagnostics

**Status:** proposed | **Size:** small/medium for targeted core fix; medium for general scope support

**Request:** Do not report a conflict when the same key belongs to mutually
exclusive UI contexts. Keep Ctrl+S for prompt stashing in the main editor and
model/thinking save or session sort in their respective dialogs. User prefers
context-aware detection over moving those bindings.

**Current Pi:** Installed 1.4.0 `core/extensions/runner.js` builds a flat key-to-
action map in `buildBuiltinKeybindings()` and compares every extension shortcut
against it in `getShortcuts()`. It distinguishes reserved overrides, but does not
represent focus scopes. Consequently the editor-owned stash shortcut generates
an `app.models.save` startup warning even though picker focus prevents dispatch
to the editor. Actual stash registration/focus tests confirm the intended routing.

**Effort / approach:** A narrowly audited distinction between editor actions and
known picker-only actions is a small core change plus regression tests. General
scope metadata, overlapping contexts and custom-dialog support require broader
API/design work. The supported local extension API does not expose a diagnostic
filter or scoped shortcut registration; prefer a maintained upstream Pi change.
Do not patch installed `node_modules`, monkey-patch the runner, suppress all
shortcut warnings, or change user bindings merely to hide this warning.

**Acceptance:**
- Audit actual dispatch/focus ownership before assigning action scopes; do not
  assume every non-reserved action is picker-only.
- Suppress diagnostics only for provably disjoint contexts. Preserve warnings
  for overlapping editor actions and competing extension shortcuts, and retain
  reserved-key rejection/precedence behavior.
- Test Ctrl+S main-editor stashing versus model/scoped-model/thinking save and
  session sort; no stash changes while a dialog owns focus. Include INPUT/NAV.
- Test genuine conflicts, remapped keys, multiple actions sharing one key,
  custom/unknown contexts (conservative handling), reload and `/hotkeys` output.
- Verify the stash startup warning is absent without losing either contextual
  binding. Keep runtime dispatch unchanged unless separately designed/tested.
- If upstream API/version changes are required, record compatibility and upgrade
  instructions; retain documented behavior on unsupported versions.

**Dependencies:** PI-006 (stash), PI-012 (keybinding audit).
**References:** Installed `docs/keybindings.md`, `docs/extensions.md`;
`dist/core/extensions/runner.js` (`buildBuiltinKeybindings`, `getShortcuts`),
interactive shortcut setup and focused picker dispatch; local
`tests/prompt-stash.test.mjs` and `tests/feature-integration.test.mjs`.

---

## PI-016 — TODO list extension and visible task progress

**Status:** proposed | **Size:** medium

**Request:** Add a TODO/task-list extension for tracking work during planning and
implementation, with a clear view of pending, in-progress, and completed tasks.
Keep it lightweight and compatible with the existing editor, footer, plan mode,
and optional Agents Hub; it must not introduce an automatic orchestration loop.

**Mandatory implementation approach (user requirement):**
- **MUST research and refer to established, popular existing implementations
  before designing or implementing this feature.** Broad adoption is a positive
  signal for useful UX and tested functionality; do not default to a fresh rewrite.
- **Reuse suitable existing functionality and code wherever practical**, after
  source/dependency review finds it non-malicious and it fits Pi's current APIs
  and local workflow. Copying reviewed code is explicitly permitted; preserve
  licenses, attribution, and pinned provenance. If reuse is unsuitable, document
  concrete compatibility, maintenance, security, or scope reasons—not a blanket
  prohibition on third-party code. Do not adopt or execute code blindly.
- Compare the installed official Pi `examples/extensions/todo.ts` with popular
  public Pi task-list extensions and OpenCode/Claude Code task-list behavior.
  Verify actual repositories and adoption/maintenance evidence rather than
  claiming a popularity ranking without research. Review source, not just READMEs.
- Record repository URLs, pinned revisions, licenses, adoption/maintenance
  evidence, security/dependency findings, and the reuse decision in
  `research/PI-016-references.md` before integration. No implicit package install,
  downloaded-code execution, or automatic updater.

**Acceptance:**
- Model-callable task updates and user-facing list/show/edit controls; stable
  task IDs and pending/in-progress/completed states. Decide deletion, ordering,
  cancellation and dependency behavior after evaluating existing implementations.
- Show concise current progress with an expandable full list; compose with the
  existing UI instead of installing a competing main editor/footer replacement.
- Persist task state across reload/resume and reconstruct the active session
  branch correctly. Define fork, tree navigation, clear/new-session, compaction,
  and failed-write behavior; avoid leaking tasks between unrelated sessions.
- Let the user inspect and correct tasks. Model updates are task bookkeeping,
  not user approval, tool authorization, proof of validation, or permission to
  start execution. Do not mark tasks complete solely from an optimistic claim.
- Define a narrow plan-mode allowance for task bookkeeping if needed; it must
  not bypass application-write restrictions or delegation policy. Plan Markdown
  remains the reviewable plan artifact; document synchronization rather than
  silently making two competing sources of truth.
- Subagent integration is optional; if included, attribute ownership and handle
  concurrent updates without losing tasks. Never auto-launch workers.
- Test task CRUD/transitions, persistence/branch restoration, concurrent updates,
  plan-mode interaction, cancellation, and UI composition. Cover interactive,
  RPC/headless, narrow/Unicode/resize behavior; document usage and disable steps.

**Dependencies:** PI-013 (plan artifact/workflow), PI-012 (status/UI composition),
PI-003 (optional subagent task attribution).
**Initial references to investigate:** installed `examples/extensions/todo.ts`,
Pi extension/package ecosystem and OpenCode task tools. These are starting points,
not an asserted popularity ranking or a preapproved implementation choice.

---

## PI-017 — Named model categories and workflow/subagent routing

**Status:** proposed | **Size:** medium

**Request:** Let the user assign configurable labels such as `small`, `build`,
`general`, and `intensive` to model configurations and refer to those labels
throughout Pi. Use higher-capability models where needed and cheaper models for
routine work, without repeatedly selecting concrete models manually.

**User examples (illustrative mappings, not hard-coded defaults):**
- `intensive` → `sol-high` for investigating/planning a task.
- `build` → `luna-high` for implementing the reviewed plan at lower cost.
- `small` → `luna-low` for lightweight tasks such as preparing commits.
- `general` → a user-selected everyday/default model configuration.

**Research and reuse requirement:**
- Before implementation, inspect prevalent model-tier, task-category, and
  role-based routing patterns to decide which category labels are useful.
  Starting points include Claude Code's model aliases and subagent model
  selection, OpenCode's build/plan agent model configuration, and popular
  OpenCode/Pi plugins with category-based model routing. Distinguish capability
  tiers (`small`, `intensive`) from task roles (`plan`, `build`, `review`, `commit`)
  rather than assuming one universal taxonomy.
- Follow the shared policy: prefer suitable, reviewed existing code/functionality
  over unnecessary reinvention. Record pinned source URLs, licensing,
  adoption/maintenance evidence, compatibility/security findings, and reuse
  decisions in `research/PI-017-references.md`. Do not claim a popularity ranking
  or supported behavior without checking current implementations.
- Recommend a small initial label set based on that research, but allow arbitrary
  user-defined labels and mappings. Labels should not be vendor-specific.

**Acceptance:**
- Define each label as a concrete provider/model plus thinking/reasoning level
  and any supported relevant settings. A label is a model configuration alias,
  not merely a model ID; `high`/`low` reasoning variants may share a base model.
- Provide user-level defaults and explicit project/workflow/agent overrides,
  with documented precedence and validation. Explain where mappings are stored
  and how the user lists, changes, and inspects effective resolutions.
- Agents Hub/subagent definitions and launch requests can select a label; resolve
  it consistently and report the actual provider/model/reasoning configuration.
  Explicit concrete-model overrides remain available; define their precedence.
- Plan mode can use `intensive` while planning, then switch to `build` for
  implementation when the user leaves planning. Configure this routing rather
  than hard-coding it. Merely selecting a model or switching modes must not
  start a turn, grant tool permissions, or mark a plan approved.
- Lightweight workflows such as commit preparation can explicitly select
  `small`. Model routing does not authorize a commit/push or any other side
  effect; existing user instructions and permission policies still apply.
- Show both the active label and resolved model in suitable UI/status and
  subagent inspection surfaces. Label names do not guarantee model capability,
  actual price, or safety; mappings and cost assumptions remain user-controlled.
- Specify what happens on manual model changes, mode changes, busy turns,
  reload/resume, branching, and unavailable models. Avoid mid-turn switching,
  silent expensive fallback, or overwriting an explicit user choice unexpectedly.
  Missing/invalid labels must give an actionable error or use an explicitly
  configured fallback whose resolution is visible.
- Test label resolution and override precedence, provider/model/reasoning
  validation, plan/build handoff, subagent routing, manual overrides, persistence,
  unavailable-model behavior, and interactive/RPC/headless compatibility.
- Document example mappings for the user's `sol-high`/`luna-high`/`luna-low`
  workflow, usage, limitations, and how to disable automatic workflow routing.

**Dependencies:** PI-003 (subagent model selection), PI-013 (plan/build modes),
PI-012 (visible active label/model). Coordinate with existing model configuration
and selection controls; do not introduce a competing provider registry.

---

## PI-018 — Drive external coding harnesses, especially Antigravity CLI

**Status:** proposed | **Size:** medium; discovery first

**Request:** Add a skill and/or extension that lets Pi delegate work to and drive
other coding harnesses, prioritizing **Antigravity CLI**. The user has a Google
Pro subscription they want to use through Antigravity's own supported workflow,
not by connecting that subscription directly to Pi. The user reports that direct
Pi use is not permitted by the applicable terms of service.

**Compliance and discovery requirements:**
- Verify the current official product/CLI name, availability, supported automation
  interfaces, subscription eligibility, and applicable terms before implementation.
  Do not assume that an interactive subscription also permits unattended CLI
  automation or orchestration by another harness. Record dated official sources
  and unresolved restrictions; if no permitted interface exists, mark that part
  blocked rather than inventing a workaround or claiming compliance.
- Keep authentication and model access inside the external harness's official
  supported flow. Do not extract/reuse subscription tokens, impersonate its client,
  proxy private endpoints, or expose a subscription-backed provider through Pi.
  A CLI wrapper is not automatically exempt from service terms.
- Research established integrations for driving external coding CLIs and reuse
  suitable, reviewed code where practical under the shared implementation policy.
  Record pinned provenance, licenses, maintenance/adoption evidence, dependency
  review and compatibility in `research/PI-018-references.md`.

**Acceptance:**
- Choose the smallest supported integration: a skill documenting explicit CLI
  usage when sufficient, or an extension/adapter for structured lifecycle and
  results. Prefer documented noninteractive/structured interfaces; disclose
  limitations if only interactive operation is supported. No implicit install.
- Allow explicit task submission with cwd, bounded context, expected output,
  timeout and cancellation. Return useful progress, final results, errors and
  changed-file information without treating external output as trusted commands.
- Make the selected external harness and workspace visible. Clarify whether work
  shares the parent cwd or uses an explicitly chosen isolated workspace; never
  silently create worktrees or allow concurrent conflicting file mutations.
- Preserve the external harness's own permission, trust, confirmation and login
  controls. Never auto-answer approval prompts or disable safeguards to make
  automation work. Define interactive, RPC/headless and needs-user-input behavior.
- Treat external execution as delegation, not a read-only tool. Integrate with
  plan-mode restrictions and applicable Agents Hub policy; do not let another
  harness bypass tool gates or user approval requirements.
- Manage subprocess cleanup, output limits, cancellation, shutdown/reload,
  session ownership and failure reporting. Do not imply that aborting the parent
  automatically undoes filesystem changes or stops all descendants.
- Avoid passing credentials or unnecessary private conversation/context to the
  external tool. Explain account, billing/quota, telemetry and data-sharing
  boundaries; distinguish external subscription usage from Pi model usage.
- Design an adapter boundary for additional harnesses without claiming identical
  capabilities. Antigravity is the first target, subject to verified support and
  terms; other harnesses can be added independently.
- Test with mocked/local fixtures first, then opt-in live acceptance using an
  authorized installation/account. Cover submission, results, permission prompts,
  cancellation, timeouts, cleanup and plan-mode refusal. Document setup, usage,
  supported versions, limitations, compliance findings and disable instructions.

**Dependencies:** PI-003 (delegation/lifecycle policy), PI-013 (planning gate),
PI-017 (optional routing to a harness-backed task executor, not a subscription
provider bridge). Availability and permitted automation must be established before
committing to an implementation.
