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

### Accessing Plugin Documentation
- **IMPORTANT**: Anthropic's servers cannot access GitHub directly. To access plugin documentation, check where Neovim stores plugins locally, as this is where the GitHub directory of the plugin is cloned.
- **Plugin location**: Plugins are typically stored in `~/.local/share/nvim/lazy/` (check lazy.nvim's data directory)
- **If plugin not found**: Create a minimal plugin spec file in `lua/plugins/` with just the plugin name (e.g., `return { { "author/plugin-name" } }`). After restarting LazyVim, the plugin will be cloned and accessible locally.

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
- **Centered scrolling**: `<C-d>`, `<C-u>`, `<C-f>`, `<C-b>` center cursor after movement
- **Smart word motions**: `w`, `e`, `b` are CamelCase/snake_case aware (nvim-spider)
- **Buffer operations**: `L`/`H` for next/previous buffer, `<leader>by` yank buffer path to clipboard
- **Terminal toggle**: `<C-/>`, `<M-/>` to toggle terminal
- **Navigation**: `<C-h/j/k/l>` for tmux-aware window navigation

### Custom Plugin Configurations

#### File Navigation & Search
- **Snacks Picker**: Custom horizontal layout (85% width, 80% height), follows symlinks, custom excluded patterns
- **Snacks Explorer**: Sidebar layout on left, `<Esc>` disabled to prevent accidental close
- **Project.nvim**: Project management at `<leader>fp`
- **Rip-substitute**: Find/replace with ripgrep at `g/`

#### Git Integration
- **Neogit**: Git client at `<leader>gn` with floating layout
- **Diffview**: Enhanced diff viewer at `<leader>ga` (open), `<leader>gc` (close)
- **Gitsigns**: Hunk operations at `<leader>h*` prefix (stage, reset, blame, diff)
- **Lazygit**: Integration via `<leader>gg`

#### AI & Completion
- **Sidekick**: Claude Code integration at `<leader>a*` prefix (tmux backend)
- **Blink-cmp**: Completion engine with Copilot integration, prioritized sources
- **Copilot**: AI code suggestions (via LazyVim extras)

##### Sidekick Multi-Session Design (`lua/plugins/sidekick.lua`)
Sessions are named `claude_1`..`claude_5`. Dynamic tool configs are registered at runtime in `require("sidekick.config").cli.tools` — they are NOT in the static `opts`. This is intentional because:
- Only the default `claude` tool has `is_proc`, avoiding tmux process-discovery conflicts with multiple sessions
- `claude_N` tools are created on demand via `ensure_claude_slot(n)`

Key keybinds:
| Key | Action |
|-----|--------|
| `<leader>a1`-`<leader>a5` | Open/toggle session N (exclusive visibility) |
| `<leader>an` | New session in next available slot |
| `<leader>aa` | Picker — lists all `claude_N` sessions (attached or registered) |
| `<leader>as` | Toggle all Claude sessions on/off |
| `<leader>ak` | Kill all Claude sessions (detach + `tmux kill-session`) |
| `<leader>ad` | Detach current session |
| `<leader>at` | Send current context to active Claude session |
| `<leader>av` | Send visual selection to Claude |
| `<leader>af` | Send current file to Claude |
| `<leader>ap` | Send clipboard to Claude |
| `<leader>ac` | Toggle CopilotChat |

##### Sidekick Session Restore (`lua/config/autocmds.lua`)
On `SessionLoadPost`, the autocmd scans all tmux-discovered sessions and re-registers `claude_N` tools for any with matching cwd. Key design points:
- After restart, sidekick's `is_proc` discovery assigns ALL Claude processes to the bare `claude` tool — `tool.name` is never `"claude_N"`. The original tool name is preserved in the tmux session name (`mux_session`), format: `"<tool_name> <sha256_prefix>"`.
- The autocmd parses `mux_session` to recover the tool name and registers it in config — **no terminal windows are opened** on restore.
- The picker (`<leader>aa`) uses `State.get({})` (not `attached = true`) so it lists registered-but-not-opened sessions.
- When the user opens a session via picker or `<leader>aN`, sidekick uses `tmux new -A -s <sid>` which reconnects to the existing tmux session.
- `<leader>ak` uses `State.get({})` and kills by `mux_session` (attached sessions) or by computed `Session.sid()` (registered-only tools), then removes them from config.

#### Note-taking
- **Obsidian**: Full note-taking integration at `<leader>o*` prefix
  - Workspaces: `~/vaults/personal`, `~/vaults/work`
  - Daily notes, backlinks, tags, templates, calendar
  - Smart actions on `<CR>`, link navigation with `]o`/`[o`

#### Terminal & Navigation
- **Toggleterm**: Terminal management at `<M-/>` (toggle), `<M-t>` (new), `<M-s>` (picker), `<M-q>` (close)
- **nvim-tmux-navigation**: Seamless navigation between nvim and tmux with `<C-h/j/k/l>`

#### Editing Enhancements
- **nvim-spider**: Smart word motions (`w`, `e`, `b`) for CamelCase/snake_case
- **Comment folding**: Toggle comment visibility at `zh`
- **Undotree**: Undo history visualization at `<leader>uu`

#### Utilities
- **CodeSnap**: Code screenshots at `<leader>cs` (visual mode)
- **vim-eunuch**: Unix commands (`:Remove`, `:Delete`, `:Move`, `:Rename`, `:Chmod`, `:Mkdir`, `:SudoWrite`)

### Modified Defaults
- Tab size: 4 spaces (not 2)
- Autoformat: Disabled by default (`vim.g.autoformat = false`)
- Diagnostics: Disabled by default (`vim.diagnostic.enable = false`)
- Swap files: Disabled (`vim.opt.swapfile = false`)
- Colorscheme: Catppuccin Mocha (not TokyoNight)
- Root detection: lsp → .git → lua → cwd

### Key Prefix Reference

Quick reference for common key prefixes:

| Prefix | Group | Description |
|--------|-------|-------------|
| `<leader>a` | AI | Sidekick/Claude Code integration |
| `<leader>b` | Buffer | Buffer operations |
| `<leader>c` | Code | Code operations (CodeSnap, LSP) |
| `<leader>f` | Find | File/project finding, fuzzy search |
| `<leader>g` | Git | Git operations (Neogit, Diffview, pickers) |
| `<leader>h` | Hunks | Gitsigns hunk operations |
| `<leader>o` | Obsidian | Note-taking and knowledge management |
| `<leader>s` | Search | Search in files, symbols, diagnostics |
| `<leader>u` | UI | UI toggles (Undotree, colorschemes) |
| `<M-...>` | Terminal | Terminal management (Alt key) |
| `g/` | - | Rip-substitute find/replace |
| `zh` | - | Comment folding toggle |

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
- **Git**: Plugin management, Neogit, Diffview
- **Ripgrep**: Snacks picker, rip-substitute plugin
- **tmux**: Sidekick backend, nvim-tmux-navigation
- **Obsidian app** (optional): For `<leader>oO` to open notes in Obsidian
- **Language servers**: Installed via Mason as needed
- **Node.js**: For certain LSP servers and Copilot

## LazyVim Extras Enabled

The following LazyVim extras are active (configured in `lazyvim.json`):
- AI: Copilot, Copilot Chat
- Coding: Mini-surround, Yanky
- Editor: Dial, Inc-rename
- Formatting: Prettier
- Lang: Clangd, JSON, Markdown, YAML
- UI: Treesitter Context
- Util: Dot files support
- VSCode: VSCode keybindings compatibility