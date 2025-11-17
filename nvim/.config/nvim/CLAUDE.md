# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a Neovim configuration based on LazyVim, a Neovim distribution that provides a curated set of plugins and sensible defaults. The configuration uses Lua and the lazy.nvim plugin manager.

## Core Architecture

### Configuration Loading Flow
1. `init.lua` loads `lua/config/lazy.lua`
2. `lazy.lua` bootstraps the lazy.nvim plugin manager and LazyVim
3. LazyVim loads configuration from:
   - `lua/config/options.lua` - Neovim settings
   - `lua/config/keymaps.lua` - Custom keybindings
   - `lua/config/autocmds.lua` - Autocommands
   - `lua/plugins/*.lua` - Plugin configurations

### Plugin System
- **Manager**: lazy.nvim with lazy-loading optimizations
- **Pattern**: Each file in `lua/plugins/` returns a table of plugin specs
- **Lock File**: `lazy-lock.json` tracks exact plugin versions
- **LazyVim Extras**: Modular feature sets enabled in `lazyvim.json`

## Common Development Commands

### Plugin Management
```bash
# Open lazy.nvim UI (inside Neovim)
:Lazy

# Update plugins
:Lazy update

# Sync plugins (update + clean)
:Lazy sync

# Check plugin health
:Lazy health
```

### Testing Configuration Changes
```bash
# Reload a specific plugin configuration
:Lazy reload {plugin-name}

# Source current file (when editing config)
:source %

# Restart Neovim with clean state
:qa!  # Then restart nvim
```

### LSP and Diagnostics
```bash
# Check LSP status
:LspInfo

# Install/update language servers
:Mason

# View diagnostics
:Trouble
```

## Key Customizations

### Non-Standard Keybindings
- **Delete without yanking**: `d`, `D`, `c`, `C`, `x`, `X` use blackhole register
- **Cut operations**: `yd`, `yD`, `yc`, `yC`, `yx`, `yX` for yank+delete
- **Window resizing**: `<Alt-h/j/k/l>` to resize splits
- **Buffer navigation**: `L`/`H` for next/previous buffer
- **Terminal toggle**: `<C-/>` to toggle terminal

### Custom Plugin Configurations
- **Neogit + Diffview**: Git workflow at `<leader>g` prefix
- **Toggleterm**: Terminal management at `<leader>t` prefix
- **Undotree**: Undo history visualization at `<leader>uu`
- **Sidekick**: Claude Code integration at `<leader>ac`
- **Rip-substitute**: Find/replace with ripgrep at `g/`

### Modified Defaults
- Tab size: 4 spaces (not 2)
- Autoformat: Disabled by default (`vim.g.autoformat = false`)
- Colorscheme: Catppuccin Mocha (not TokyoNight)

## Configuration Patterns

### Adding a New Plugin
Create a file in `lua/plugins/` that returns a plugin spec:
```lua
return {
  {
    "author/plugin-name",
    event = "VeryLazy",  -- or specific events/commands
    opts = {
      -- plugin options
    },
    keys = {
      { "<leader>xx", "<cmd>PluginCommand<cr>", desc = "Description" },
    },
  }
}
```

### Overriding LazyVim Defaults
To modify a LazyVim plugin's configuration:
```lua
return {
  {
    "existing/plugin",
    opts = {
      -- These merge with LazyVim's defaults
      new_option = true,
    },
  }
}
```

### Disabling LazyVim Plugins
```lua
return {
  { "unwanted/plugin", enabled = false }
}
```

## Important Files and Locations

- **Main config**: `/home/a0507112/.config/nvim/init.lua`
- **Plugin specs**: `/home/a0507112/.config/nvim/lua/plugins/*.lua`
- **Keymaps**: `/home/a0507112/.config/nvim/lua/config/keymaps.lua`
- **Options**: `/home/a0507112/.config/nvim/lua/config/options.lua`
- **LazyVim extras**: `/home/a0507112/.config/nvim/lazyvim.json`
- **Plugin versions**: `/home/a0507112/.config/nvim/lazy-lock.json`

## Dependencies

External tools required for full functionality:
- Git (plugin management, Neogit/Diffview)
- Ripgrep (rip-substitute plugin)
- Language servers (installed via Mason as needed)
- Node.js (for certain LSP servers and Copilot)

## LazyVim Extras Enabled

The following LazyVim extras are active (configured in `lazyvim.json`):
- AI: Copilot, Copilot Chat
- Coding: Mini-surround, Yanky
- Editor: Dial
- Lang: Clangd, Markdown
- UI: Treesitter Context
- Util: Dot files support
- VSCode: VSCode keybindings compatibility