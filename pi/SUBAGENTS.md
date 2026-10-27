# Subagents — fork installation and migration

## Active implementation

- Fork: https://github.com/Raaghav-Arya/pi-subagents
- Upstream: https://github.com/tintinweb/pi-subagents
- Installed revision: `ca93a5247e72e7053fcd10bea7125d6c4205f949` (v0.22.0).
- Registration: `.pi/agent/settings.json`, package source
  `git:github.com/Raaghav-Arya/pi-subagents@ca93a5247e72e7053fcd10bea7125d6c4205f949`.
- Managed checkout: `~/.pi/agent/git/github.com/Raaghav-Arya/pi-subagents`.

Start a new Pi session and use `/agents` for management, settings and fleet
inspection. Model-facing tools include `Agent`, `get_subagent_result` and
`steer_subagent`; workflow orchestration is optional and requires explicit user
opt-in. Consult the installed fork's README and `docs/` for its actual controls,
definition format, nesting, inheritance, scheduling and session semantics.
Personal agent definitions under `~/.pi/agent/agents/` are preserved; compatibility
of their fields/policy must be checked rather than assumed. No fork tweaks have
been made as part of adoption/cleanup.

## Migration from the custom Agents Hub

The superseded local `extensions/agents-hub/`, dedicated tests, preview, transport,
plan-policy adapter and obsolete research/usage docs have been removed. Their
checkpoint is recoverable from stow-repository commit `aebf606`. The live Hub
symlink and obsolete resource exclusion were removed as well. This avoids duplicate
`/agents` ownership. Nothing automatically reloads the current Pi session.

Saved custom-Hub sessions/logs in `~/.pi/agent/agents-hub/`, if present, have **not**
been deleted or migrated. They are historical artifacts, not evidence of live
processes. Do not feed them into the fork as if their metadata/protocol were
compatible. Personal definitions and unrelated extension settings are retained.

The old `agents` tool, `/agent`, Alt+A Hub control, `message_parent`, durable
notification/result contracts, correlated input gates and task-budget semantics
are not local features anymore. Use the fork's APIs; do not infer equivalence.
Existing processes loaded before cleanup may still run old extension code until
user-initiated exit/restart. Cleanup does not terminate external processes.

## Policy and security limitations

Plan mode blocks non-allowlisted **main-session tool calls**, including `Agent`,
`SubagentWorkflow`, `steer_subagent` and `get_subagent_result`. It does not stop
already-running fork agents or intercept fork slash commands, mentions,
schedules/workflows or extension-internal API calls. The old Hub entry-veto and
branch-restoration cleanup guarantees no longer apply. Stop delegated work
explicitly before entering planning; use OS isolation for stronger enforcement.
Fork-specific policy integration remains an open PI-003 requirement.

The pinned source review was partial, not a security audit or certification.
Upstream is MIT-licensed and declares runtime dependencies `croner` and `nanoid`.
No third-party source is retained in the removed custom implementation; the fork
retains its own license. Dependency lifecycle scripts were disabled during
installation. npm's zero-known-vulnerabilities result does not prove safety.
Extensions execute with the user's privileges, and their tools are not OS sandboxes.

## Validation and updates

Offline startup verified `/agents` resolves to the fork's `src/index.ts` with no
model request. Run from `pi/`:

```sh
PI_OFFLINE=1 node tests/feature-integration.test.mjs
node --test tests/plan-mode.test.mjs
node tests/plan-mode-typecheck.mjs
```

The feature test uses the installed Pi RPC client and an isolated agent directory
to check fork command registration, local plan shell gating and `/clear`. It does
not prove fork lifecycle, provider resilience, policy inheritance or interactive
terminal acceptance. Those remain gap-review/acceptance work in `BACKLOG.md`.

The package is commit-pinned. Deliberately review/test a future fork revision and
update the settings pin when adopting changes; do not silently track upstream.
Make code changes in a normal fork checkout and publish only when explicitly
requested, rather than editing Pi's managed detached installation in place.
To uninstall, use `pi remove` with the exact configured package source, then start
a fresh session. Uninstalling does not delete historical custom-Hub sessions.
