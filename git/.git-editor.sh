#!/bin/bash

# Check if we are in a VS Code terminal
if [ "$TERM_PROGRAM" = "vscode" ]; then
    # Use VS Code as the editor
    code --wait "$@"
else
    # Use nvim as the editor
    nvim "$@"
fi
