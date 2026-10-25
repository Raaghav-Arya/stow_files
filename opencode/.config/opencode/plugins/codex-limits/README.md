# Codex limits for OpenCode

Adds the `/codex-limits` command, available in any session. It refreshes and opens a colored dialog with separate
five-hour and weekly usage rows, showing only windows reported by Codex (300 and 10,080 minutes respectively).

The TUI plugin asks the local `codex app-server` for `account/rateLimits/read`; it does not read OpenCode auth files or
make its own HTTP request. The app-server handles Codex authentication and the backend request. The `codex` executable
must be on PATH and signed in. No limits are inferred when Codex omits a window. Failed refreshes leave the previous
value visible as stale.

This plugin is discovered from the global OpenCode `plugins/` directory. It does not change `cli.json` or
`opencode.json`.
