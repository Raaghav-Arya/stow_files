#!/bin/bash
# Confluence MCP Server wrapper for Texas Instruments Confluence

# Source environment variables from bash_sensitive if available
if [ -f "$HOME/.bash_sensitive" ]; then
    source "$HOME/.bash_sensitive"
fi

# Bypass proxy for internal TI domains
export no_proxy=".ti.com,ti.com,localhost,127.0.0.1"
export NO_PROXY=".ti.com,ti.com,localhost,127.0.0.1"

# Set your Confluence configuration
export CONFLUENCE_BASE_URL="https://confluence.itg.ti.com"
export CONFLUENCE_USERNAME="a0507112"
export CONFLUENCE_PAT="$CONFLUENCE_TOKEN"

# Run the MCP server
exec mcp-confluence-server
