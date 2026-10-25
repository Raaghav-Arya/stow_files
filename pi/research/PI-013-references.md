# PI-013 source research and provenance

Reviewed online 2026-10-24 using HTTPS curl downloads into `/tmp/pi013-*`; nothing installed, imported or executed from downloads. Public implementation references are design references, not runtime dependencies. No copied implementation code; local code independently follows installed API contracts. Popularity is not a security guarantee and no numerical popularity ranking is claimed.

## Subsequent user policy clarification

The source review below records the original implementation decisions, not a ban
on code reuse. The user explicitly permits copying reviewed benign functionality
and code with required license notices/provenance. Popularity and broad adoption
are positive signals when selecting an implementation; evaluate established
plugins before reinventing them. The concern is blind adoption or malicious code
execution, not reuse. No comparative popularity ranking was performed here.

The original session-only, approval-gated UX has also been superseded: the user
requested dedicated Markdown plan files and immediate warning-free mode switching.
See `../PLAN-MODE.md` for current behavior; original source findings below remain
historical provenance rather than current acceptance requirements.

## Official Pi plan-mode extension (primary API reference)

Repository: https://github.com/earendil-works/pi
Pinned commit: `136b87e8a7f5a3e5186de0289523ba327dc592fc` (resolved GitHub main commit API).
License: MIT, Copyright (c) 2025 Mario Zechner, reviewed pinned root LICENSE.

Actual source downloaded/reviewed:
- https://github.com/earendil-works/pi/blob/136b87e8a7f5a3e5186de0289523ba327dc592fc/packages/coding-agent/examples/extensions/plan-mode/index.ts
- https://github.com/earendil-works/pi/blob/136b87e8a7f5a3e5186de0289523ba327dc592fc/packages/coding-agent/examples/extensions/plan-mode/utils.ts

Installed Pi 1.4.0 copies have byte-identical SHA256 values to pinned downloads:
- index.ts `bef2bf0712aea7b7d0f73d174e24ac5309679e6cc143f7bcbf1a9e0121222af8`
- utils.ts `12ea28d57cc55e68e8d52a2f1d16df8b2e7f2749cd694d41453028002a2bdad9`

Findings/security: useful command/status/custom-entry examples. Its allowlist uses prefix regexes and permits interpreters such as awk, network commands, and compound shell syntax; filtering known destructive words is not a shell safety proof. It preserves unknown active tools, which can mutate or delegate. Session restoration uses all entries rather than the active branch. Our design rejects shell altogether, denies unknown tools, uses branch state and requires renewed approval after restored execution. We do not copy its automatic execution prompt or completion markers. Official examples are actively maintained alongside Pi, not security guarantees.

## OpenCode built-in Plan and Agent plugins (well-known public alternative)

Repository: https://github.com/anomalyco/opencode
Pinned commit: `7d3dd861cc9f7d905b827f2646d40f7f547d0bfe` (resolved GitHub dev commit API).
License: MIT, Copyright (c) 2025 opencode; reviewed pinned root LICENSE.

Actual implementation source reviewed, not merely README:
- https://github.com/anomalyco/opencode/blob/7d3dd861cc9f7d905b827f2646d40f7f547d0bfe/packages/core/src/plugin/plan.ts
  SHA256 `1cc8d0c1ca73c588ece2d3655b2e31c025bc2a38db0e440bf42b85317828f907`
- https://github.com/anomalyco/opencode/blob/7d3dd861cc9f7d905b827f2646d40f7f547d0bfe/packages/core/src/plugin/agent.ts
  SHA256 `7581c231cf4d9436a348390daa9022b029ad3b5ab231a9c513a704fbd51c253a`

Paths were resolved from pinned GitHub tree after older `packages/opencode/src/...` URLs returned 404 (documented API/layout churn). Plan plugin updates the plan agent permissions (deny edits generally, allow a home plan directory), rewrites permission-block error text and reconciles reminders per context request because compaction/revert can strip them. Agent plugin supplies an Explore role with default-deny permissions but allows shell/web tools and prompts read-only use; prompts alone do not enforce shell semantics. We adopt explicit mode/reminder reconciliation, not its permission implementation or filesystem exception. No claim made that this two-file review audits the entire OpenCode permission pipeline or dependencies. OpenCode's Effect/plugin APIs are not Pi-compatible and are not loaded. This is a maintained built-in public plugin design reference, not an installed third-party package.

## Installed contracts reviewed

Read installed docs/extensions.md, security.md, containerization.md, tui.md, keybindings.md, configuration.md, sessions.md, rpc-extension-ui.md and official plan-mode README/source. Reviewed local transcript-navigation.ts and settings/keybindings. Verified exported types for isIdle, tool_call, session_tree, user_bash. Reviewed installed dist/core/agent-session.js `_beforeToolCall` and `_executeNestedToolCall`: model calls and `ctx.executeTool` nested calls share the tool gate. Reviewed event-bus.js: async handler errors are logged, emission does not await listeners. Hence before-enter is explicitly synchronous cooperative veto, not an asynchronous security gate. No secret/config credential files read.

## Security decisions and limits

Only exact trusted local read tool names are allowed; readOnlyHint is not trusted. Blocking shell avoids ambiguous pipelines, substitutions, git helpers and network fetches. Unknown/MCP/custom/delegation tools are denied. A trusted extension can override an allowed built-in name or invoke OS APIs directly; no in-process extension can establish an OS sandbox. Resource discovery, MCP startup, other slash commands/extensions, pre-existing child processes and model/provider traffic remain outside this plan tool gate. Entire-process OS isolation remains separate. Read tools can read outside cwd and reveal secrets if permitted by OS; plan mode is not a privacy boundary.

No downloaded plugin dependencies were installed or executed. Local runtime imports only existing Pi types and installed typebox. Plan text is session data and appears in subsequent model context; do not put secrets there. No automatic updater, network request, model call, process spawn or file-write exception is introduced by this extension.
