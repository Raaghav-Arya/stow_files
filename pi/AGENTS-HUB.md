# Local Agents Hub — PI-003 plumbing

Local agent lifecycle, messaging and observation primitives, not an orchestration
framework. No public Pi plugin is installed. The main editor/footer are not
replaced. Workspace management is deliberately **outside** this extension.

## Quick start

Run `/reload` after updating the linked extension. Changes to the tool schema and
loaded extension code take effect only after reload, not in an in-flight request.

- **Alt+A** or `/agents`: open the live hub, including while the main agent works.
  Alt+A also works in the local transcript editor's NAV mode.
- `/agent <task>`: launch with default reading/search tools in the parent's cwd.
- `/agent @scout <task>`: launch a named definition in the parent's cwd.
- `/agent @worker <task>`: launch with the worker definition's edit/shell tools
  **in the parent's cwd**, without making a checkout or requiring Git.

## Hub layout

The hub is a themed overlay, not a diagnostic dump:

- Full-screen in Pi fullscreen mode; centered at 95% width / 80% height in regular
  mode. Wide terminals (100+ columns) get a roster/activity split; narrower
  terminals use a compact stacked layout.
- Highlighted selection and semantic state colors: accent for running, warning
  for starting, success for idle, error for failed, muted for stopped. Labels and
  icons also identify states without depending on color.
- Agent cards show task, tokens, turns and short ID. The inspector shows model,
  thinking, task, cwd and recent activity; full metadata is behind Tab.
- Assistant messages render as Markdown; tool calls show human-readable targets,
  not serialized JSON. Tool results are collapsed unless expanded or failed.
- The bottom action bar stays visible and drops secondary hints at small widths.
  Closing never stops an agent; stopped/failed agents do not offer send controls.

Hub controls:

| Key | Action |
| --- | --- |
| n | Choose an agent definition, existing working directory, and task |
| Up/Down, Ctrl+P/Ctrl+N, j/k | Select agent (uses configured selection keys) |
| Enter or m | Compose message; steer at the next turn boundary |
| f | Compose follow-up for after the current run |
| x | Stop/disconnect selected agent, after confirmation |
| PageUp/PageDown | Scroll a paused snapshot of retained output; bounded at top |
| End / Ctrl+End | Resume live activity, or jump to end of metadata |
| Tab | Toggle activity / scrollable metadata (IDs, tools, paths, task) |
| o | Expand/collapse bounded tool-result previews |
| Alt+A, Escape, Ctrl+C | Close hub, **not** the agent |

Pi's multi-line editor dialogs preserve the main prompt draft. Closing the hub
leaves children alive. Idle agents accept new prompts in the same conversation.
Stopped/failed agents cannot be resumed in this slice; launch another agent.
The old separate `w`/worktree launch action has been removed.

## Workspace and capabilities are independent

`cwd` names an **existing directory**, defaulting to the parent's working
directory. It can be a shared checkout, a directory without Git, or a worktree
prepared by the user or an optional orchestrator. Relative paths in the tool are
resolved against parent cwd; the manager uses the canonical existing path.

Tool selection does not create or change a workspace. For example:

```json
{
  "action": "launch",
  "name": "implementation",
  "task": "Implement the assigned change and run focused tests.",
  "cwd": "/path/chosen/by/user",
  "tools": ["read", "grep", "find", "ls", "bash", "edit", "write"]
}
```

The extension never creates/copies/removes worktrees, snapshots files, commits,
merges, prunes, or cleans a working directory. There is no workspace fallback or
role-to-isolation inference. Shared-cwd agents see current staged, dirty and
untracked files; callers own file coordination and collision handling. Launching
writers in the same cwd is allowed, not automatically serialized or made safe.

For this config repository, callers may explicitly use
`/home/raaghav/.stow_files`; `/home/raaghav/.pi` is not itself a Git checkout,
which is no longer a restriction on launching agents.

Tool allowlists and cwd are **not security sandboxes**. Even file-reading tools
can reach other readable paths; bash/edit/write can affect unrelated resources.

## Agent definitions

- Personal: **`~/.pi/agent/agents/*.md`**.
- Project: **`.pi/agents/*.md`** under parent session cwd, gated by project trust.

```markdown
---
name: reviewer
description: Review code for correctness and return concrete findings.
tools: read, grep, find, ls
# Optional: inherit parent model/thinking when omitted.
# model: openai-codex/<exact-model-id>
# provider: openai-codex
# thinking: high
---
Inspect relevant code. Report findings with paths and line references.
Use message_parent for questions or blockers. Do not modify files.
```

Supported fields: `name`, `description`, `tools`, `model`, `provider`, `thinking`.
The body supplies agent instructions. Tools may be a YAML list or CSV. Supported
built-ins: read/grep/find/ls/bash/powershell/edit/write; omitted tools default to
read/grep/find/ls, and `tools: []` grants no built-ins. `message_parent` is always
added. There is no `mode` field; remove `mode: research`/`mode: worktree` from old
definitions. Unknown fields/tools are rejected with diagnostics, not silently
ignored. This is a local schema, **not complete Claude frontmatter compatibility**.

A selected definition's model/thinking/tools override launch-tool options. An
explicit launch display `name` overrides the definition's name for that instance.
Definitions do not choose or override cwd. Personal scout/worker examples differ
only in instructions and tools, not in workspace behavior.

Trusted project definitions override personal same-named definitions. Untrusted
project definitions are skipped. Pi does not currently list `.pi/agents` alone
as a resource triggering its trust prompt; use Pi's `/trust` workflow/restart as
needed. No automatic trust grant is added. Discovery refreshes on each launch;
diagnostics are shown during hub selection and by `agents` action `definitions`.
Portable role-relative assets and Claude-only field mapping remain PI-001 work.

## Model-facing API and communication

One `agents` tool provides:

- `definitions`: available roles and diagnostics.
- `launch`: `task`, optional definition `agent`, display `name`, `provider`,
  `model`, `thinking`, `cwd`, and `tools`. Returns stable ID and artifact paths.
- `list`: current session registry/status/usage.
- `read`: `id`; output tail and message states with full log path.
- `send`: `id`, `message`, optional `delivery: steer | followUp`.
- `wait`: `id`; up to 30 seconds for idle/failure/stop or a **new** child message.
  Timeout is not completion; cancelling wait does not stop the child.
- `stop`: `id`; terminate the owned child process group, leaving cwd untouched.

Children call `message_parent({ message })` for progress, questions and results.
The main session can reply using `send`; users can reply from the hub. No direct
sibling routing, automatic delegation, scheduler or workflow topology is added.

Child reports notify the user and enter the parent's passive **next-turn**
context; they do not wake an idle parent or force another model call. The first
24 reports per extension runtime enter parent context (up to 4,000 characters
each); further reports remain in agent logs/hub. Settlement reports use the latest
assistant result, not a raw tool-event tail. Transcript reports render as compact,
themed cards; Ctrl+O expands them. Presentation changes do not change model-facing
content or delivery policy. Use `read`/`wait` rather than assuming all output was
copied into the parent.

Outgoing messages are serialized; the initial task reserves its position before
startup is published, so messages sent during initialization cannot overtake it.
`queued` means RPC acceptance; `delivered`
means observation of the child's user-message entry, **not** that the model read
or acted on it. Child-to-parent `delivered` means the parent transport received
the report, not model acknowledgement. Failure/stop leaves unconfirmed delivery
`unknown`; late acknowledgements cannot revive stopped messages, and losing an
RPC acknowledgement cannot erase transcript-proven delivery. No automatic
retry is made for possibly accepted prompts. Stable sender/recipient/message IDs
preserve provenance.

Local extensions can observe `pi.events` **`agents-hub:update`** (agent summaries).
The transport-independent `AgentManager` exposes launch/send/get/summary/wait/
stop/subscribe/shutdown primitives. These can support a future orchestrator, but
no event-bus spawn/control protocol or orchestrator is bundled. Observer failures
are isolated from child execution. Do not instantiate extra unmanaged managers
to bypass resource budgets.

## Plan-mode integration

`plan-policy.ts` cooperates with the local `/plan` extension. Explicit planning
entry is vetoed until **all connected agents**, including idle agents, are
stopped. Planning blocks hub launches and messages through tools, commands and
the UI, with another check at queued message dispatch. Viewing/stopping agents
remains possible from the hub. Restoring a restricted branch stops connected
children and waits for process cleanup; plan-mode tools stay blocked if cleanup
fails. Session replacement/reload retains the normal owned-process shutdown.
This does not propagate a sandbox/policy into children: planning delegation is
refused, not silently run unrestricted. Other Pi instances/external processes
remain outside this adapter.

Tests: `node --test tests/plan-hub-integration.test.mjs` and
`node tests/feature-integration.test.mjs`.

## Runtime trust, limits and lifecycle

Children use the installed Pi CLI in long-lived RPC processes. Only our messaging
bridge loads: discovered/configured extensions, MCP, skills and prompt templates
are disabled; target project settings are not approved. Choosing cwd does **not**
authorize that directory's executable project configuration. Normal context files
may still load. Corporate mandatory hooks/permission extensions are **not yet
inherited**; PI-001/PI-004 must explicitly implement and verify those semantics.
Credentials/model definitions use normal Pi storage, not command-line secrets.

Optional `~/.pi/agent/agents-hub.json`:

```json
{
  "maxConcurrent": 4,
  "maxAgents": 12,
  "maxTurns": 40,
  "timeoutMinutes": 30
}
```

`maxConcurrent` counts starting, running, idle and still-terminating connections.
Stop idle agents to free slots; a slot is released only after transport cleanup.
`maxAgents` is cumulative for the runtime, including failed allocated launches.
Turns/lifetime are cumulative across messages. Bounds: connections/agents 1..32,
turns 1..200, lifetime 1..240 minutes. These are resource limits, not money limits.

Reload/session replacement/shutdown stop owned agents; the hub cannot reopen old
UI after session shutdown. There is no reconnect or automatic resume after
restart. An abrupt host crash may leave processes: inspect before cleanup and do
not treat persisted `running` metadata as proof of a live connection. POSIX group
cleanup targets the current Linux setup; Windows descendant cleanup is not yet
implemented/tested. CLI resolution targets npm Pi's `dist/cli.js`, not standalone.

## Artifacts, usage and rollout

Owner-only artifacts, outside the tracked config repository:

```text
~/.pi/agent/agents-hub/<parent-session-id>/<agent-id>/
  agent.json       # identity, state, message records, cwd, tools, usage
  events.jsonl     # event stream, bounded at 10 MiB
  sessions/        # persisted Pi child conversation
```

There is **no managed workspace directory**. Artifact cleanup never cleans cwd.
The raw output buffer retains a 65,536-code-unit tail; `read` returns its last
12,000 characters. The hub displays the last 80 activity entries (16,000 characters
per entry, up to 2,000 characters per tool-result preview). Expanded results show
at most six wrapped lines; full results remain in event logs. Logs/sessions
provide retained full records and may contain sensitive prompts/code/results. Retention is manual.
ANSI/OSC sequences are stripped before terminal display; multiline metadata is
flattened to respect terminal row budgets. Scrolling freezes a bounded snapshot;
End returns to live output.

Child-reported tokens/estimated model cost are separate from the parent footer.
Compaction usage is not yet aggregated; subscription quotas are not measured.
PI-012 must reconcile these totals without double counting.

```sh
node pi/tests/agents-hub.test.mjs
node pi/tests/agents-hub-ui.test.mjs
node pi/tests/transcript-navigation.test.mjs
node pi/tests/typecheck-agents-hub.mjs  # existing tsc; no dependency installation
```

Automated tests make **no model requests**. They cover independent cwd/tools in
non-Git directories, preserved existing files, definitions/trust, messaging,
cancellation/startup/shutdown, terminating-connection budgets, observer isolation,
late/lost acknowledgements, startup message ordering, stale UI, snapshot scrolling,
metadata/width safety, RPC framing/timeouts/exits, bridge registration and offline
installed-Pi startup. UI tests use real dark/light Pi themes across fullscreen/
regular layouts, narrow/short terminals, empty/populated rosters, structured
activity, compact reports, metadata scrolling, result expansion and key releases.
Tests assert actual ANSI styling, not just no-op theme mocks.

Preview the design without starting agents or making model requests:

```sh
node pi/tests/preview-agents-hub.mjs
node pi/tests/preview-agents-hub.mjs --width=80 --rows=24
# --light / --empty / --plain are also available.
```

The visual design is inspired by the reference plugin's fleet list and live
conversation inspector: separated roster/content, semantic badges, highlighted
selection, compact usage and pinned controls. No third-party rendering code was
copied. This remains keyboard-first; mouse controls and an inline composer are
not implemented.

Live exercise: after reload, the parent successfully launched a read-only
adversarial reviewer and a separate source-research agent, received child reports,
and sent the reviewer a follow-up. These used the already-loaded pre-correction
runtime; automated tests exercise the revised implementation. Manual full-stack
Alt+A/dialog/IME validation and live execution with the corrected schema remain
pending until the next reload.

Disable only the live symlink, then `/reload`:

```sh
unlink ~/.pi/agent/extensions/agents-hub
```

Source and artifacts remain. Recreate the symlink to re-enable. Renaming a folder
inside `extensions/` to `.disabled` is not reliable if it still has `index.ts`.

## References and remaining scope

Original local implementation; no third-party plugin code copied or executed.
Pi's installed extension/TUI/SDK/RPC docs and official examples are API references.
Read-only public references:

- [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents/tree/1a80e24ecb13b291f035379082208404dba5aba5):
  initial README-level design review only.
- [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents/tree/ca93a5247e72e7053fcd10bea7125d6c4205f949):
  pinned checkout and actual source review; see `pi/research/PI-003-subagents.md`
  for inspected files, lessons and deliberate non-adoptions. MIT-licensed;
  source inspection is not a dependency/security endorsement.

PI-003 remains in progress: richer hub configuration/UX, reconnect/resume,
optional sibling routing, full usage aggregation, explicit inherited permissions,
and Claude definition compatibility. Worktree UX belongs to separate PI-005 and
must remain optional to these plumbing primitives.
