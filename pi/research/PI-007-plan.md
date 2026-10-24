# PI-007 plan (before implementation)

Scope: only a new `extensions/clear-alias/` command, offline tests, usage and research documents. Parent integrates live discovery and backlog; no existing config/editor changes.

1. Read installed Pi lifecycle/command/session documentation, declarations and official commands example; inspect actual interactive `/new` and command-context replacement source, including streaming, veto, trust, editor and reload paths.
2. Research an established public Claude-compatible command plugin using online pinned implementation source and license, without installing or executing downloaded code. Record provenance, compatibility and security; use as a design reference, not a dependency.
3. Implement the smallest stateless `/clear` command delegating to supported `ctx.newSession()`, without session deletion, synthetic prompt/model invocation, input interception or editor replacement. Avoid accessing old context after successful runtime replacement.
4. Add offline registration/delegation/cancellation/error/reload tests and, where installed SDK permits, real no-model session-lifecycle tests with temporary fixtures. Document verified differences from built-in `/new`, especially streaming and drafts.
5. Run tests; report precise files and integration needs. No live reload, installs, secret access, model calls, commits or pushes.

Open risks to resolve in source review: command-context newSession may wait for idle while built-in `/new` aborts; editor draft ownership differs between command submission and direct API invocation; replacement invalidates context. Terminal-stack acceptance cannot be proven in a subagent/offline harness and will be documented honestly.
