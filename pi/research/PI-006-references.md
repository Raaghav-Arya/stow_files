# PI-006 source review and integration findings

## Online reference (actual implementation, not README)

Repository: https://github.com/anomalyco/opencode

Pinned commit: `7d3dd861cc9f7d905b827f2646d40f7f547d0bfe` (resolved from GitHub's `commits/dev` API during this implementation). License: root `LICENSE`, MIT, copyright (c) 2025 opencode. This is OpenCode's **first-party** implementation, not a Pi-compatible plugin. GitHub repository API returned 220713 stars and `archived: false` at review time. This observation establishes relevance, not a ranking, endorsement, security guarantee, or reproducible permanent star count. The reviewed TUI package declares version 2.1.4. Its Solid/OpenTUI/internal workspace APIs are not compatible with Pi's extension runtime.

Sources fetched over HTTPS into `/tmp/pi006-review.hrVRQ8` only; nothing installed or executed. For any path below, the immutable source URL is `https://github.com/anomalyco/opencode/blob/7d3dd861cc9f7d905b827f2646d40f7f547d0bfe/<path>`.

Reviewed source paths:

- `packages/tui/src/prompt/stash.tsx`: JSONL persistence, validation, clone on push, 50-entry limit, push/pop/remove. Writes catch and suppress failures; in-memory mutation precedes persistence. Startup asynchronously loads and rewrites entries. This is not a transactional durable-store guarantee; startup/write concurrency and simultaneous writers deserve separate testing before adopting persistence.
- `packages/tui/src/component/prompt/index.tsx`, stash handlers at lines 880–944, draft remount handling 713–735 and input focus near 738: stash captures structured prompt then resets composer; pop/list restore prompt parts/extmarks and put cursor at end. The pop/list blocks inspected do not themselves refuse a nonempty draft. We do **not** copy this overwrite policy.
- `packages/tui/src/component/dialog-stash.tsx`: picker preview renders first line plus timestamp, delete requires a second activation. Prompt previews can expose unsent sensitive text on screen; this local extension shows only stash availability.
- `packages/tui/src/component/prompt/draft-stash.ts`: separate session/tab keyed in-memory remount draft store; take consumes. It is not the user's persistent stack. Useful consume-on-restore design, but not evidence Pi can restore equivalent structured state.
- `packages/tui/src/prompt/history.tsx`: `PromptInfo` includes text, files, agents, skills, pasted text and optional shell mode. `parsePromptInfo` only checks string text and array pasted before casting; deeper untrusted file/mention validation would need separate review.
- `packages/tui/src/util/persistence.ts`: stash uses ordinary append/write helpers (not its separate atomic JSON helper), no explicit restrictive mode in these helpers. Plaintext persistence depends on directory/umask; do not treat stored drafts as encrypted.
- `packages/tui/test/prompt/draft-stash.test.ts`: tab isolation, consume once, latest replacement; downloaded tests were read but **not run**.
- `packages/tui/package.json` and root `LICENSE`: dependency/license review. Solid, OpenTUI, Effect and internal workspace dependencies are substantial; this was a bounded stash-path review, **not** a transitive audit of all OpenCode code. None are added locally.

Security outcome: use design inspiration only; independently written local implementation adds no dependencies, disk writes, downloaded code, subprocesses, network or model calls. No copied source or upstream license notice is needed for this independent small implementation. Memory-only state avoids a new plaintext draft store but deliberately provides no crash/restart recovery and is not secret isolation from other loaded in-process extensions.

## Installed Pi contracts and local composition

Installed `@earendil-works/pi-coding-agent` version: **1.4.0**. Read installed README and complete `docs/extensions.md`, `docs/tui.md`, `docs/keybindings.md`, `docs/configuration.md`, `docs/terminal-setup.md`, `docs/tmux.md`; relevant official `examples/extensions/modal-editor.ts` and installed declarations/runtime were inspected. Related links followed for editor/focus/config/key handling; no plugin installation instructions executed.

Exact installed paths under the package root:

- `dist/core/extensions/types.d.ts`: `registerShortcut`, `ExtensionContext.mode`, UI editor/status/notify contracts.
- `dist/modes/interactive/interactive-mode.js`: shortcut callback wired on default editor (~1755), editor UI uses `getExpandedText() ?? getText()` and `setText()` (~2074), callback forwarding to custom editor (~2247), clipboard attachments represented as file paths (~2437–2501).
- `dist/modes/interactive/components/custom-editor.js`: extension shortcuts dispatched **from the editor**, before application/editor actions. Not a global raw terminal interception.
- `dist/modes/interactive/components/thinking-selector.js`: Ctrl+S saves selected thinking level.
- `dist/modes/interactive/components/{model-selector,session-selector,settings-selector}.d.ts` and keybinding reference: model save and session sort are contextual owners. Actual thinking/session components tested without model/provider runtime. Model/settings focus uses the same renderer boundary; not claimed as full interactive acceptance.

Read local `.pi/agent/extensions/transcript-navigation.ts`, `.pi/agent/extensions/absolute-context-footer.ts`, settings and keybindings. INPUT delegates to stock editor; NAV explicitly calls `onExtensionShortcut` before consuming other keys. **No editor patch needed.** Footer already renders `getExtensionStatuses()` with truncation, so `setStatus` composes without a competing footer. No keybindings/settings edits needed. Ctrl+Q INPUT/NAV and Ctrl+U/D scrolling remain untouched.

## Validation boundaries

`tests/prompt-stash.test.mjs` exercises the actual installed Pi editor/TUI focus routing, expanded bracketed paste, regular/fullscreen INPUT/NAV, legacy and CSI-u Ctrl+S, dark/light thinking-save and session-sort dialogs, fake dialog boundary, user-approved slot replacement, automatic restore after interactive input,
submitted-message isolation, newer-draft preservation, lifecycle, setter failure,
whitespace/Unicode/large text and narrow editor borders. No model calls.

`tests/prompt-stash-flow-control.mjs` uses an isolated POSIX PTY: raw mode delivers Ctrl+S, IXON consumes it, Ctrl+Q resumes. This does not prove end-to-end forwarding through WezTerm → tmux → Neovim terminal. No user's terminal mode was changed. Model/settings dialogs and real terminal resize/IME/attachment round trips still need manual acceptance. Typecheck uses installed declarations and existing `tsc`, without install. Parent coordinates shared changes; this feature provides no orchestration, workspace serialization, process isolation or approval bypass.
