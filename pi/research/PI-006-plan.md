# PI-006 implementation plan (before coding)

1. Read ticket, local editor/config/keybindings, installed Pi extension/TUI/keybinding/terminal docs and relevant examples/contracts. Review upstream prompt-stash source online at a pinned commit; no downloaded code execution or installation.
2. Implement a small standalone extension using `registerShortcut("ctrl+s")`, editor text access and status only. Do not replace the editor or intercept raw terminal input. Existing transcript-navigation already forwards extension shortcuts in INPUT and NAV, so no editor patch is expected.
3. Proposed conservative semantics: one session-local in-memory slot; nonempty editor + empty slot saves exact expanded text and clears editor; empty editor + full slot restores and consumes; both full refuses without modification (no implicit swap/concatenate). Whitespace counts as content. No persistence or automatic model input. Cursor/undo/paste folding are not restored; attachment path text survives but files are not retained.
4. Lifecycle: only interactive TUI; clear slot at session shutdown/start/reload, document crash/restart loss and no recovery guarantee. No filesystem/network/process/model operations.
5. Add offline tests using installed Pi runtime: transitions, multiline/Unicode/large paste expansion, occupied-slot refusal, setter failures, status, lifecycle/non-TUI, existing editor INPUT/NAV forwarding, dialog focus ownership, narrow rendering. Test XON/XOFF with local PTY if practical; real WezTerm/tmux/LazyVim forwarding requires user terminal acceptance and must not be claimed as automated coverage.
6. Write usage, disable/rebind instructions, source/security/provenance findings, exact test commands and limitations. Run tests without live reload or model calls. Parent alone updates shared backlog/settings/editor if necessary.

## Subsequent user-approved changes

The numbered plan above records the original pre-code proposal. The user later
requested replacing an occupied stash on Ctrl+S and automatically restoring it
after interactive message submission. Both are implemented and regression-tested;
auto-restore never overwrites a newer draft or alters the submitted message.
The success notification is simply `Prompt stashed!`. See `PROMPT-STASH.md` for
current behavior.

No essential semantic question blocked the initial conservative proposed default; parent/user revised it during integration. Shared checkout ownership is limited to prompt-stash files/tests/docs/research; no orchestration or workspace changes.
