# MCP Servers Configuration for Claude Code

This directory contains MCP (Model Context Protocol) server configurations for accessing TI's internal systems.

## Configured Services

### 1. Confluence
- **Base URL**: https://confluence.itg.ti.com
- **Wrapper Script**: `confluence-wrapper.sh`
- **Authentication**: Uses `CONFLUENCE_PAT` from `~/.bash_sensitive`

### 2. JIRA
- **Base URL**: https://jira.itg.ti.com
- **Wrapper Script**: `jira-wrapper.sh`
- **Authentication**: Uses `JIRA_TOKEN` from `~/.bash_sensitive`
- **Package**: `mcp-jira-server`

### 3. Bitbucket
- **Base URL**: https://bitbucket.itg.ti.com
- **Wrapper Script**: `bitbucket-wrapper.sh`
- **Authentication**: Uses `BITBUCKET_TOKEN` from `~/.bash_sensitive`
- **Package**: `mcp-bitbucket-server`

## How It Works

1. Environment variables are sourced from `~/.bash_sensitive` (loaded via `.bashrc`)
2. Wrapper scripts configure the appropriate base URLs and credentials
3. Claude Code loads the MCP servers via the configuration at `~/.claude/config/mcp-config.json`
4. The config is symlinked to `~/.config/claude-code/config.json`

## Usage

Once configured, you can provide Claude with:
- **JIRA ticket IDs** (e.g., "PROJ-1234") to view, update, or comment on issues
- **Bitbucket repository URLs** or PR numbers to review code, comment, or get diffs
- **Confluence page URLs** to read or search documentation

## Troubleshooting

If MCP servers are not working:

1. Restart Claude Code to reload MCP servers
2. Verify environment variables are set:
   ```bash
   echo $JIRA_TOKEN
   echo $BITBUCKET_TOKEN
   ```
3. Check wrapper script permissions:
   ```bash
   ls -la ~/.claude/mcp-servers/
   ```
4. Test MCP server manually:
   ```bash
   ~/.claude/mcp-servers/jira-wrapper.sh
   ```

## Directory Structure

```
~/.claude/
├── config/
│   └── mcp-config.json          # Main MCP configuration
└── mcp-servers/
    ├── confluence-wrapper.sh    # Confluence MCP wrapper
    ├── jira-wrapper.sh          # JIRA MCP wrapper
    └── bitbucket-wrapper.sh     # Bitbucket MCP wrapper

~/.config/claude-code/
└── config.json -> ~/.claude/config/mcp-config.json  # Symlink
```
