# Claude Code Configuration

## MCP Servers
See [MCP_SETUP_SESSION.md](MCP_SETUP_SESSION.md) for complete setup, configuration, and usage.

**Status**:  All servers connected (JIRA, Bitbucket, Confluence)

## Global Permissions

Global permissions configured in `settings.json` to control file access:

### Allow List
- **Files containing "claude"**: Full read/write/edit access to any file or directory with "claude" in the path
- **Bash operations on "claude" paths**: find, grep, echo, ls commands allowed on directories containing "claude"

### Deny List
- **Files containing "secret"**: No read/write/edit access to any file or directory with "secret" in the path
- **Files containing "sensitive"**: No read/write/edit access to any file or directory with "sensitive" in the path
- **Bash operations blocked**: find, grep, echo, ls commands denied on directories containing "secret" or "sensitive"

These permissions ensure Claude Code can freely work with configuration and documentation files while protecting sensitive data.
