# PI-008 implementation plan (before implementation)

Scope: new ask-user extension only; parent integrates settings/live symlink/backlog.

1. Review installed Pi 1.4.0 extension/TUI/RPC contracts and official question,
   questionnaire and qna source; inspect local settings/keybindings. Review pinned
   online OpenCode question implementation as design reference, never install/run it.
2. Implement bounded strict typed schema and independent answer/session state.
   Stable question/option IDs; no default answer; single/multi/text; mandatory review.
3. Implement reusable themed custom screen using native Editor for text/IME;
   choice navigation, back, cancel, page scrolling, resize and preserved local drafts.
   Ctrl+Y accepts only choices/review, never intercepted in the text editor.
4. Thin ask_user model-only tool adapter: sequential plus explicit busy guard,
   cancellation/abort/shutdown, explicit needs-user-input in headless and unsupported
   RPC (no pretend custom dialog). No main editor mutation, network or persistence.
5. Offline validation/state/UI/lifecycle tests using installed Pi dependencies;
   usage/disable/provenance and honest remaining live-terminal validation limits.

Decisions: `ask_user` local schema, not Claude wire compatibility; inline custom
screen rather than fragile overlay sizing. No extra dependency or editor replacement.
All questions require answers; multi-select requires at least one explicit choice.
Cancellation returns no partial answers. Reusable UI results are data, not approval.

Orchestration: shared checkout file ownership agreed; no worktree/commits/install,
model calls, live reload or settings changes. Agent budget is 40 turns / 30 minutes;
research bounded to official API and one established implementation. Parent relays
clarifications; child cannot solicit user input directly in RPC.
