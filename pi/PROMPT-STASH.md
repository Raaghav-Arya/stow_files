# Prompt stash — PI-006

A small local Ctrl+S shortcut for **unsent prompt text**, composed with the existing transcript-navigation editor. No additional editor, package, persistence store, model tool or raw terminal listener.

## Use

| Editor | Stash | Ctrl+S result |
|---|---|---|
| Nonempty | Empty | Save exact expanded text, then clear editor |
| Empty | Full | Restore text and consume stash |
| Nonempty | Full | Replace previous stash with current text, then clear editor |
| Empty | Empty | Notify that no stash exists |

Multiline, trailing newlines, whitespace-only drafts, Unicode and expanded pasted text are preserved. No trimming, swapping, merging or submitting. Explicit Ctrl+S on nonempty input overwrites any previous stash, as requested by the user. While occupied, footer status reads `Stash: 1 | restores after send · Ctrl+S restore`; narrow terminals may truncate the hint. Notifications never include draft contents.

Example: type a long prompt → Ctrl+S → type and send a short question → the long prompt automatically returns to the editor. It is **not sent** with the question; you still choose whether to edit or submit it. Manual Ctrl+S restoration into empty input remains available. Works in fullscreen **INPUT and NAV**, and in regular mode. NAV stays NAV; use `i` to edit restored text.

If a stash already exists, Ctrl+S on a new draft discards that older stash in favor of the new one. Restore or copy the old stash first if you want to keep it. There is no separate stash-clear command. A failed editor write retains the stash for recovery; inspect the editor before retrying (a partially failing custom setter could leave duplicate copies).

## Automatic restore after sending

Ordinary interactive message submission (including queued steering/follow-up
input) restores and consumes the stash immediately after Pi clears the submitted
editor. It does not wait for the assistant's response or submit the restored
text. The input event's message is unchanged. RPC and extension-generated input,
empty submissions, built-in/extension slash commands and shell commands do not
trigger this restore. Session-replacing commands still clear the stash.

If a newer nonempty draft is already present when Pi processes input, automatic
restore leaves it untouched and retains the stash for manual restoration. Failed
restoration also retains the stash. A send accepted by Pi's input processing can
restore even if a later model/provider step fails; no provider-success guarantee
is implied. Changes require a restart/reload; restore/copy any current stash
before reload because the memory slot does not survive it.

## Lifetime, privacy and limitations

- **One session-local memory slot.** This proposed conservative default is not a stack/picker. Restore before `/new`, `/clear`, `/resume`, `/fork`, reload or exit: session shutdown/start clears the stash. Crash/restart recovery is **not provided**. No automatic session persistence, transcript entry or context injection.
- The extension itself does not send drafts to the model, write files, access the clipboard or network, execute shell commands, or delegate to agents. Restoring only fills the editor. If you later submit, normal Pi command/shell/model behavior applies (including leading `/` or `!`).
- This is text-only, not an editor-state snapshot. Cursor position, selection, undo history, autocomplete state and collapsed paste presentation are not restored. Restored text follows Pi's `setText` behavior.
- Installed Pi 1.4.0 inserts clipboard images/files as **path text**; those paths survive. Stashing does not copy/retain file bytes, verify paths, extend temporary-file lifetime, or guarantee an image will still load later. No general hidden attachment-state API is assumed. Recheck attachment files before submitting.
- Loaded extensions share the Pi process and its permissions. Memory-only does not protect a draft from malicious extensions, OS process inspection or terminal capture. No multi-agent/orchestration feature or shared-checkout isolation is added.
- TUI only: RPC, print and JSON handlers do nothing. No fabricated RPC dialog or remote-editor behavior.

## Enable, disable, rebind

The new entry point is `.pi/agent/extensions/prompt-stash/index.ts`. In this stow layout its deployed location is `~/.pi/agent/extensions/prompt-stash/index.ts`; Pi auto-discovers extension directories containing `index.ts`. Apply via a fresh Pi launch or a **user-initiated** reload after preserving drafts. Do not load the same extension explicitly and automatically twice.

To disable, move the deployed `prompt-stash` directory **outside** auto-discovered extension directories, or remove its entry point, then restart/reload after restoring the stash. Renaming only the directory while leaving `index.ts` inside the discovery root does not disable it. No settings/keybindings file changes are necessary. To rebind, edit the `registerShortcut("ctrl+s", ...)` literal and update its help/status wording; extension shortcuts here are not named built-in keybinding actions configurable through `keybindings.json`.

## Dialog and terminal ownership

Pi's shortcut registry emits an expected warning about overlap with
`app.models.save` and chooses the extension for the main editor. This is not a
reserved-shortcut rejection. Live discovery/dispatch and existing dialog-focus
tests cover this overlap; do not disable the dialog save/sort bindings to silence
it.

Ctrl+S still belongs to model/thinking/settings/session dialogs while they have focus: model/thinking save and session sort remain contextual actions. This extension uses editor-owned `registerShortcut`, **not** `onTerminalInput`. The existing transcript editor already forwards extension shortcuts in NAV; no shared editor patch is required. Ctrl+Q INPUT/NAV, Ctrl+P/N and Ctrl+U/D are unchanged.

Ctrl+S is also the terminal's historical XOFF byte. Pi's raw input normally disables IXON, but an outer terminal/PTY layer can consume it. If output freezes, try Ctrl+Q; check `stty -a` in the affected outer shell. For an affected shell you may deliberately use `stty -ixon` (restore with `stty ixon`), but this extension never changes terminal settings. Do not blindly remap Ctrl+Q, which this setup uses for NAV too.

Manual acceptance still required in **WezTerm → tmux → LazyVim/Neovim terminal**:

1. Confirm terminal-input mode (`i` from Neovim terminal-normal mode) and inspect custom terminal/save mappings for Ctrl+S/Ctrl+Q. They must reach Pi rather than save a Neovim buffer or invoke an outer mapping.
2. Test multiline stash/restore in INPUT, NAV and regular mode; verify no prompt submission or hidden concatenation.
3. Open model, thinking, settings and session dialogs; verify their Ctrl+S behavior and unchanged main draft/stash on closing.
4. Test narrow/wide resize, light/dark themes, Unicode and attachment-path survival. Check fullscreen scroll position and busy/streaming draft editing.
5. If keys fail, compare direct WezTerm, tmux and Neovim paths. Pi's installed `docs/terminal-setup.md` and `docs/tmux.md` describe extended-key forwarding. Do not restart/kill an active tmux server just to test this feature.

## Offline validation

From `pi/`:

```sh
node tests/prompt-stash.test.mjs
node tests/prompt-stash-flow-control.mjs
node tests/prompt-stash-typecheck.mjs
node tests/transcript-navigation.test.mjs
```

All passed against installed Pi **1.4.0**. Tests require installed Pi; typecheck requires existing `tsc`; isolated PTY test requires Python 3 on POSIX (Windows skips). No install, model requests, downloaded plugin execution or live reload. Tests cover automatic/manual restore, submitted-message isolation, RPC/extension
input exclusion, newer-draft preservation, state/occupied-slot replacement, multiline/Unicode/large expanded paste, failures, lifecycle, regular/fullscreen INPUT/NAV, renderer focus, actual thinking/session dialogs, dark/light themes, narrow editor borders, legacy/CSI-u Ctrl+S and isolated XON/XOFF. They are not a claim of physical WezTerm/tmux/Neovim forwarding, full model/settings-dialog integration, live resize/IME, or vision attachment validation.

Provenance/security review: [research/PI-006-references.md](research/PI-006-references.md). Pre-code plan: [research/PI-006-plan.md](research/PI-006-plan.md).
