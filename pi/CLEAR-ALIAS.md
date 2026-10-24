# `/clear` — fresh Pi session

PI-007 adds a small stateless command at `.pi/agent/extensions/clear-alias/index.ts` for installed Pi 1.4.0.

## Use and discovery

Run `/clear` to start a fresh conversation, like `/new`. The command description appears in slash completion and `pi.getCommands()` (and the official `/commands` example if separately enabled). No shortcut, editor replacement, setting or npm dependency is added. Arguments are ignored; use the bare command.

This is **not** a cosmetic terminal clear, session deletion, filesystem rollback, credential reset, or a prompt sent to the model. Existing saved sessions remain resumable through `/resume`; ephemeral `--no-session` conversations remain ephemeral.

## Lifecycle and caveats

- Uses supported command-context `ctx.newSession()` with no options; normal session-before-switch veto, abort/settlement, shutdown, replacement, trust/resource loading and startup apply. A veto keeps the old session and does not abort its work.
- While streaming, Pi dispatches extension commands immediately. The shared runtime aborts/settles active work before shutdown, like `/new`; the alias neither queues a new prompt nor waits for natural idle. Actual model/tool cancellation limits remain Pi's limits.
- Submitting `/clear` consumes its editor input as an ordinary command. It does not stash a pre-existing unsent draft or restore text/attachments. Copy any wanted draft somewhere durable **before replacing it with the command**. The local prompt stash is session-local and is also cleared by `/clear`; it is not a way to preserve drafts across session replacement. Like `/new`, a veto does not promise restoration of submitted editor text. The extension itself never reads or writes the editor.
- Old command context is invalid after replacement; the alias deliberately performs no post-replacement UI or session operations.
- Cosmetic difference: built-in `/new` appends “New session started”; the alias does not duplicate that checkmark. Extension-command input/history dispatch also differs from the built-in route. Session replacement itself is shared.
- If runtime creation fails after teardown, Pi may no longer have a usable old runtime; this alias does not promise rollback. Saved old conversation files are not deleted.
- Shutdown hooks from other extensions still run, including any cleanup of owned subagents. Starting a new session does not promise to keep background agents alive or resume them. Workspace ownership/orchestration remains a user/parent responsibility.

Interactive regular/fullscreen modes use the same command and introduce no custom layout, keybinding, Unicode or resizing code. Actual terminal-stack acceptance is still pending. In RPC, registered extension commands can be dispatched as prompts by a client; direct RPC `new_session` remains the native protocol operation. Print/JSON dispatch depends on the host's command context and does not provide interactive editor feedback; the alias itself has no UI requirement and never fabricates approval. Custom SDK hosts must bind replacement actions normally.

## Enable / disable

The repository is a stow source, not the live config. The directory is linked at `~/.pi/agent/extensions/clear-alias/` in this setup; for another installation, expose it there or pass its `index.ts` using `--extension`. Pi auto-discovers an extension subdirectory with `index.ts`. Enable it on a **new process** or user-requested `/reload`; no live reload was performed during implementation. Do not load a second extension registering `/clear`.

Disable by removing only its live discovery symlink/path, or excluding its configured extension path, then restarting/reloading. `--no-extensions` disables all extensions, not just this alias. Built-in `/new` remains available; no session migration/cleanup is necessary.

## Offline checks

```sh
node --test tests/clear-alias.test.mjs
```

Five tests cover discovery, one-call API delegation without stale-context access, cancellation/errors, fresh reload registration, and installed runtime lifecycle with real persisted-session byte preservation. Lifecycle services are fakes; no credentials or model calls are used. Reload test is registration simulation, not a live Pi reload. Research, pinned online source and security review: `research/PI-007-references.md`; pre-code plan: `research/PI-007-plan.md`.
