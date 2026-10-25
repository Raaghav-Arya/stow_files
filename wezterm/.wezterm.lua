local wezterm = require("wezterm")
local config = {}

if wezterm.config_builder then
  config = wezterm.config_builder()
end

-- Keep default keybindings except Alt+Enter's fullscreen toggle.
config.keys = {
  { key = "Enter", mods = "ALT", action = wezterm.action.DisableDefaultAssignment },
}

-- Match Neovim's theme, including any unused space around the terminal grid.
config.color_scheme = "Catppuccin Mocha"
config.colors = {
  background = "#1e1e2e",
}

-- Hide the window title bar and WezTerm's tab bar.
config.window_decorations = "NONE"
config.enable_tab_bar = false

-- Keep the terminal flush with the window and resize in character-cell increments.
config.use_resize_increments = true
config.window_padding = {
  left = 0,
  right = 0,
  top = 0,
  bottom = 0,
}

return config
