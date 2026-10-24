# PI-007 source review and provenance

## Official Pi (implementation authority)

Installed package: `@earendil-works/pi-coding-agent` **1.4.0**. Online GitHub tag `v1.4.0` resolves directly to commit `4a080252f06caf63a525d7873c5d94d3c23887e0`.

Pinned sources:
- https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/src/core/agent-session-runtime.ts
- https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/src/modes/interactive/interactive-mode.ts
- https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/src/core/extensions/runner.ts
- https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/LICENSE — MIT, copyright Mario Zechner.

Fetched actual TypeScript runtime and license online into `/tmp/pi007-*`, read implementation (not only README). Inspected installed executable JS for interactive submit, `bindCurrentSessionExtensions`, `handleClearCommand`, runner command-context and stale-context guards. Installed docs read: README, extensions, sessions, configuration, session-format, security, SDK; official `examples/extensions/commands.ts` read completely. Existing settings/keybindings and extension inventory inspected; no editor replacement or shortcut is needed.

Verified path: built-in `/new` clears editor then `handleClearCommand()` calls `runtimeHost.newSession()`. Supported command `ctx.newSession()` directly calls that same runtime through interactive binding; it does **not** wait for idle. Runtime emits `session_before_switch` with reason `new`; cancellation returns before abort/shutdown. Otherwise it creates a fresh persisted/in-memory manager, aborts old work (settling/persisting outgoing results), emits `session_shutdown`, disposes old session, recreates cwd-bound runtime, and rebinds extensions with `session_start` reason `new`. Saved old sessions are not removed. Project resource trust stays delegated to normal runtime creation; alias sets no approval/trust override and does not change cwd. There is no claim that every new session must prompt for trust again.

Failure caveat: runtime tears down before creating the next session; creation failure is not a transactional rollback to a usable old runtime. Persisted old files remain available. Alias preserves Pi's error handling instead of claiming recovery it cannot provide.

## Established Claude-compatible command reference (not a dependency)

Repository: https://github.com/anthropics/claude-plugins-official

Pinned commit: `58267944f92187b7d6a1c822165c96c81c864806` (resolved online via GitHub API). API snapshot: 44,173 stars, not archived; `pushed_at` returned `2026-10-23T18:21:27Z`. This is evidence of an established maintained reference, **not** a security certification or a popularity ranking.

Actual command implementation inspected:
https://github.com/anthropics/claude-plugins-official/blob/58267944f92187b7d6a1c822165c96c81c864806/plugins/commit-commands/commands/commit.md

Plugin-specific license inspected in full:
https://github.com/anthropics/claude-plugins-official/blob/58267944f92187b7d6a1c822165c96c81c864806/plugins/commit-commands/LICENSE — Apache-2.0.

Source is executable command Markdown: `allowed-tools` frontmatter, `description`, shell-context interpolation, and model instructions to stage/commit. Inspected the actual body, not only its marketplace README. It is relevant to discoverable Claude-style slash commands, **not** an implementation of Pi session replacement. Claude shell interpolation and allowed-tools semantics cannot safely be imported as a Pi `/clear` prompt. A reset must be a harness operation, not an LLM instruction. Therefore only the discoverable short-command idea informs this independent minimal implementation; no plugin code/content is copied.

Security: downloaded files stayed in temporary storage and were read as text only. No downloaded plugin installed or executed; no shell-context expressions run, Git writes performed, plugin dependencies loaded, installers invoked, or hooks imported. The reviewed command can mutate Git when used in its native runtime; that behavior is deliberately absent here. Public repository popularity does not authorize corporate use or grant trust to project resources. Local alias has one type-only API import and no runtime dependency, network, filesystem access, persistence, hooks, model invocation or subprocess of its own.

## Validation boundary

Offline tests exercise local command registration/delegation, error and veto forwarding, independent registration after simulated reload, and installed production `AgentSessionRuntime`/`SessionManager` with fake session services. They prove replacement ordering and byte-preservation of a real old session file, not actual provider streaming abort, project-trust UI, or terminal rendering. Streaming behavior above is source-verified. No model calls, live reload or secret reads were used. Real WezTerm/tmux/Neovim regular/fullscreen acceptance remains user validation.
