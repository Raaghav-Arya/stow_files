#!/bin/bash
# JIRA MCP Server wrapper for Texas Instruments JIRA

# Source environment variables from bash_sensitive if available
if [ -f "$HOME/.bash_sensitive" ]; then
    source "$HOME/.bash_sensitive"
fi

# Bypass proxy for internal TI domains
export no_proxy=".ti.com,ti.com,localhost,127.0.0.1"
export NO_PROXY=".ti.com,ti.com,localhost,127.0.0.1"

# Set your JIRA configuration
export JIRA_BASE_URL="https://jira.itg.ti.com"
export JIRA_USERNAME="a0507112"
export JIRA_PAT="$JIRA_TOKEN"

# Run the MCP server
exec mcp-jira-server
