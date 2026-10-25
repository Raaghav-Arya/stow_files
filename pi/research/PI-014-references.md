# PI-014 source research and coverage audit

## Online provenance (read-only downloads)

GitHub API resolved commits; raw source and LICENSE fetched with `curl -fLsS` into `/tmp/pi014-research`. No plugin installation, downloaded code execution or dependency change. These are design references, not imported dependencies; no plugin code copied. Popularity not used as a security guarantee or a measured ranking.

- **nvim-cmp**: https://github.com/hrsh7th/nvim-cmp/tree/2ffe79f1f021def8dd1fcd81deb16f1bb0d989f3
  - MIT, copyright 2021 hrsh7th (LICENSE inspected).
  - Actual source: `lua/cmp/config/mapping.lua` (full), `lua/cmp/init.lua` acceptance branch.
  - Insert and command-line presets bind `<C-y>` to `mapping.confirm({select=false})`. The mapping calls fallback if `cmp.confirm` returns false. `cmp.confirm` checks visible view and selected entry; first-entry fallback requires explicit select=true. Lesson: context and fallback matter; do not globally synthesize Enter.
  - API response commit date 2026-07-09; current HEAD was resolved at research time. This establishes a snapshot, not a maintenance promise. Neovim Lua APIs are not Pi-compatible.
  - Security review scope: inspected mapping/acceptance code only, not full transitive plugin audit. Completion sources and confirmation callbacks can perform edits/execute plugin behavior; installing the plugin would introduce substantially more code than needed. No dependency is adopted.
- **blink.cmp**: https://github.com/Saghen/blink.cmp/tree/f50d952de478b554d89bcca058691a69cb5681dd
  - MIT, copyright 2024 Liam Dyer (LICENSE inspected).
  - Actual source: `lua/blink/cmp/keymap/presets.lua` (full), `lua/blink/cmp/init.lua` public acceptance implementations.
  - Default/cmdline Ctrl+Y invokes `select_and_accept`, then `fallback`. `accept` checks visible state and non-nil item; `select_and_accept` may choose first item. `accept_and_enter` is a distinct behavior. Lesson: acceptance and execution/submission must remain distinct.
  - API response commit date 2026-10-23; snapshot only, no maintenance promise. Neovim API, not a Pi extension API.
  - Security scope: only relevant source inspected; no Rust/native fuzzy matcher or transitive dependency audit. Not selected as runtime dependency. Visibility checks do not make completion providers trustworthy.
- **Pi**: https://github.com/earendil-works/pi/tree/4a080252f06caf63a525d7873c5d94d3c23887e0 (GitHub tag `v1.4.0` resolves directly to this commit).
  - Installed `@earendil-works/pi-coding-agent` and pi-tui: 1.4.0, package declares MIT. Upstream LICENSE fetched; implementation inspected in installed `dist` (not only README), plus online pinned `packages/tui/src/components/editor.ts` acceptance/visibility branches.
  - Source SHA256 online editor.ts: `48c6a498527df4f645f66574904bdc82c1a4021b29ff81674132219043d4d016`.
  - Existing runtime dependencies only: pi-tui key parser, keybinding manager and stock editor. Local implementation has no filesystem/network/process/model access, no timers, hooks, persistence or global monkeypatching. Extension code still executes with Pi's OS permissions; tests/review are not a sandbox.

## Installed contract/docs review

Read complete `docs/keybindings.md`, `extensions.md`, `tui.md`, and relevant linked `configuration.md`, `security.md`, `themes.md`, `terminal-setup.md`, `tmux.md`, `rpc-extension-ui.md`; read official `examples/extensions/modal-editor.ts` and `preset.ts`. Read current personal settings/keybindings and transcript-navigation editor. Public `Editor.isShowingAutocomplete()` and `getKeybindings()` suffice for safe completion composition. No second editor factory or global terminal listener is needed.

## Actual Pi paths (installed dist)

- `pi-tui/components/editor.js`, autocomplete branch: `tui.input.tab` applies selected completion and returns. `tui.select.confirm` applies completion but **slash prefix falls through to prompt submit**. Thus global Ctrl+Y confirm is unsafe even before text-dialog concerns.
- `custom-editor.js`: extension shortcuts/application actions precede stock Editor; existing main editor must own integration. No shortcut is registered by this helper.
- `pi-tui/components/select-list.js`: accepts `tui.select.confirm`; no-match guards exist, Tab is not a default accept key.
- `extension-selector.js` (`ctx.ui.select`/confirm selection): named confirm; Ctrl+Y remains unsupported without broad config or upstream/custom scoped handling.
- `extension-input.js`: the SAME named confirm submits arbitrary free-text dialogs. Regression test demonstrates Ctrl+Y submits after global config. Therefore that configuration is rejected.
- `extension-editor.js`: forwards to stock Editor; its hint uses select.confirm, but actual no-autocomplete Ctrl+Y still follows editor yank. No claim that all confirm hints imply identical dispatch.
- `model-selector.js`, `session-selector.js`, `tree-selector.js`, `thinking-selector.js`, `scoped-models-selector.js`, `config-selector.js`, `settings-submenu.js`: named-confirm call sites audited. Tabs can change scope rather than accept. Tree/session embedded text editing also uses confirm, so one global confirm binding cannot distinguish selection from text editing.
- Official `preset.ts` delegates to SelectList; arbitrary `ctx.ui.custom` owns its own handleInput and may hardcode Enter or implement unrelated semantics. There is no documented global active-picker predicate for arbitrary custom UIs.

## Decision and limits

Implement safe completion slice and a reusable explicit custom-picker predicate; keep PI-014 partial until built-in selectors can be scoped safely. Do NOT change keybindings.json globally. Proposed parent integration transforms input only in existing INPUT dispatch, not NAV. Tab remains unchanged; Ctrl+Y without visible completion stays yank. Ctrl+Y in bracketed paste stays literal through stock paste handling. If Tab is removed from `tui.input.tab`, active-menu Ctrl+Y fails inert (no submit), rather than pretending arbitrary rebound keys can be encoded safely.

No terminal-stack test was performed: automated tests pass legacy Ctrl+Y and CSI-u press/release input to installed Pi components but cannot prove WezTerm/tmux/Neovim forwarding. No global built-in-picker support is claimed. RPC/headless have no terminal editor; RPC client's shortcuts remain client-owned. Parent integrates shared editor/config/ticket changes because this agent owns only its new files in the shared checkout.
