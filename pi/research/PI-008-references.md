# PI-008 source/provenance review

## Online established reference (2026-03-25 research session)

Repository: https://github.com/anomalyco/opencode (established OpenCode agent;
not a popularity ranking or security endorsement).
Pinned commit: `7d3dd861cc9f7d905b827f2646d40f7f547d0bfe`, resolved using GitHub
`/repos/anomalyco/opencode/commits/dev`; recursive tree queried because older
`packages/opencode/...` paths no longer exist. Actual raw source fetched to a
`/tmp/pi008-reference.*` directory, read completely, never installed or executed:

- https://github.com/anomalyco/opencode/blob/7d3dd861cc9f7d905b827f2646d40f7f547d0bfe/packages/core/src/tool/plugin/question.ts
- https://github.com/anomalyco/opencode/blob/7d3dd861cc9f7d905b827f2646d40f7f547d0bfe/packages/schema/src/question.ts
- https://github.com/anomalyco/opencode/blob/7d3dd861cc9f7d905b827f2646d40f7f547d0bfe/packages/app/src/session/requests/session-question-dock.tsx
- https://github.com/anomalyco/opencode/blob/7d3dd861cc9f7d905b827f2646d40f7f547d0bfe/LICENSE

License: MIT, copyright (c) 2025 opencode. Design review only: no source copied.
Maintenance/compatibility: active dev ref resolved successfully, but its current
Effect/Form/Solid service APIs are not Pi APIs. Moving source layout reinforces
why importing it or assuming historical paths would be unsafe.

Actual implementation findings: tool delegates questions through a Form service,
checks question permission and distinguishes cancellation with/without a message.
Schema returns arrays of option label strings rather than stable option IDs. Web
UI keeps per-request tab/answers/custom drafts, has separate multi toggle versus
single pick, sends only on explicit next/submit, tracks pending mutations, and
restores focus/scroll sizing. Cleanup caches unfinished drafts and removes event
listeners/animation frames. Escape cancels at root but exits the inline custom
editor first. No final review page is required by that UI; this implementation
adds one for every request.

Security review: inspected files render through framework text nodes, not raw
HTML; question replies/cancellation use server SDK mutations. They are not a
sandbox or generic action-approval mechanism. Module-scope draft cache can retain
sensitive answers in memory; server transport expands privacy scope. Dependencies
include Effect, Solid, TanStack and OpenCode service/UI packages: not audited
transitively and deliberately not imported. No third-party runtime dependencies
or network/installer execution are added to this local implementation. Question
prompts/options are untrusted and terminal control bytes are stripped for display.
User answers still enter ordinary Pi tool-result/session history after submit.

## Installed official contracts

Installed package is Pi 1.4.0; host dependencies only (TypeBox 1.3.27 and pi-tui).
Read completely: README; docs/extensions.md, tui.md, rpc-extension-ui.md,
keybindings.md, configuration.md, security.md, themes.md, settings.md, packages.md,
json.md; official examples/extensions/question.ts, questionnaire.ts, qna.ts.
Followed relevant TUI/theme/configuration/RPC cross-links; checked installed
extension declarations, Editor declarations and source for focus, abort/custom
completion, paste expansion and viewport behavior. No transport/runtime replacement
is implemented, so RPC request dispatch is delegated to Pi rather than re-created.

Official questionnaire source supplies useful flow concepts but has no multi-select
support, uses a fabricated `(no response)` placeholder, does not wire tool abort,
and resets custom drafts. Official question source hardcodes navigation and lacks
IME focus propagation. Local implementation deliberately fixes those contracts
rather than installing either example unchanged. qna's nested model extraction
and prompt editor replacement are intentionally not used (no model call and no
main draft mutation).

## Interaction revision — navigation, notes and conversational handoff

Revisited the installed official `examples/extensions/questionnaire.ts` and the
OpenCode source findings above before extending the existing implementation.
The official example is a useful starting point for Tab/Shift+Tab question tabs,
a separate native Editor, and an explicit submission page. We continue reusing
Pi's installed Editor and custom-component runtime directly, plus the existing
local state/UI/tool implementation. No new third-party implementation code was
copied or executed; no dependency was installed. OpenCode's Effect/Solid service
and web dock cannot be dropped into this terminal extension without substantial
adaptation. Popular plugin reuse remains encouraged when suitable, not prohibited.

The revised interaction adopts question-only Tab navigation, adds independent
optional notes, and returns a distinct discussion result containing partial
context. Unlike the official example, navigation also works inside editors,
drafts survive navigation, empty text is not fabricated into an answer, key
releases are ignored, multi-select is supported, and the abort lifecycle is owned.
Discussion is an explicit exit to normal conversation, not questionnaire replay
or implicit submission. Submitted notes and discussion drafts enter tool-result
history; cancellation/abort still return no partial data.

Checked installed `interactive-mode.js` `setupExtensionShortcuts` and
`showExtensionCustom`: extension shortcuts belong to the default editor, while
the custom interaction owns focus. Tests exercise actual TuiMainScreen and
TuiAltScreen input routing with an instrumented main CustomEditor, proving that
AskUser consumes Shift+Tab without calling that editor's shortcut handler. This
is an offline focus-routing check, not physical-terminal forwarding acceptance.

Luna high produced the initial revision; parent review corrected navigation/test
sequences, strict result discrimination, stale-answer handling, bounded draft
preservation, help text and documentation, and expanded the regression tests.

## Live-test follow-up fixes

User live-tested submission, single/multi/text input, multiline notes, discussion
and cancellation, then requested automatic text entry, no duplicate note preview,
and readable question/answer/note blocks on review. They also clarified that
questions may be left unanswered, whereas cancellation must expose no answer
context. A Luna high worker implemented the focused follow-up against the same
installed APIs and existing local code, without new dependencies or external-code
execution. Parent review checked newline indentation, old persisted-result
rendering, absence of duplicate editor previews, optional/skipped submission,
cancellation/abort status-only rendering and theme/scroll behavior.

Explicit submission now returns only saved answers plus `skippedQuestionIds` and
separate notes; unsaved descriptive drafts are omitted. This is distinct from
intentional discussion context and from context-free cancellation/abort. These
changes supersede the original all-questions-required behavior described above.
Model instructions forbid cancellation recaps; this is not erasure of original
tool arguments or earlier session history. Revised controls require reload and
live acceptance; the prior live test does not validate the final visual layout.

### Saved-note placement and review color follow-up

Live feedback confirmed direct text entry and duplicate-preview removal, but found
saved-note visibility and review contrast insufficient. The local renderer now
places saved notes after the choices and scrolls that block into view when its
editor closes. Review applies existing Pi theme roles on every wrapped line:
`accent` for all question headings, `text` for saved answers, `mdHeading` for notes,
and `muted` for unanswered/draft content. These roles were checked against the
installed theme docs and actual dark/light palettes; no hard-coded white text
or new theme definition is introduced. Regression tests exercise overflowing
choices, multiline notes, resize, preview hiding and distinct actual theme colors.
This is a focused revision of the existing implementation, not new external code.
After reload and a further live questionnaire, the user confirmed that everything
looks fine, accepting the final saved-note placement and review colors in their
current setup. This supersedes the pending live-acceptance notes above without
claiming exhaustive theme, terminal-stack or IME coverage.

## Local review/test limits

Schema/state, UI and tool are separate modules. Sequential declaration plus a
busy guard prevents this extension's duplicate custom UIs. Abort and session
shutdown resolve via the actual custom completion callback, not an orphaning
Promise.race. No timers/processes/files/state survive restart; unfinished answers
are discarded, never recovered as approval. Other extensions opening unrelated
custom UIs concurrently remain a host-level orchestration concern. No central
cross-extension modal broker exists here.

Offline tests exercise validation, explicit review, single/multi/text, local draft
back-navigation, contextual Ctrl+Y versus yank, narrow Unicode layout, cancel,
headless/RPC and abort/shutdown/busy adapters. Typecheck uses installed declarations.
Manual WezTerm → tmux → Neovim forwarding, IME candidate positioning, regular and
fullscreen appearance/theme switching require user acceptance; automated rendering
is not evidence of those live-terminal properties. Tiny terminal heights may need
resizing because the native Editor has a five-content-line minimum viewport.
