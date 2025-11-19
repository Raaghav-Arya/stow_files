#!/bin/bash
# Bitbucket MCP Server wrapper for Texas Instruments Bitbucket

# Source environment variables from bash_sensitive if available
if [ -f "$HOME/.bash_sensitive" ]; then
    source "$HOME/.bash_sensitive"
fi

# Bypass proxy for internal TI domains
export no_proxy=".ti.com,ti.com,localhost,127.0.0.1"
export NO_PROXY=".ti.com,ti.com,localhost,127.0.0.1"

# Set your Bitbucket configuration
export BITBUCKET_URL="https://bitbucket.itg.ti.com"
export BITBUCKET_USERNAME="a0507112"
export BITBUCKET_TOKEN="$BITBUCKET_TOKEN"

# Run the MCP server
exec mcp-bitbucket-server
