local wezterm = require("wezterm")
local config = {}

if wezterm.config_builder then
	config = wezterm.config_builder()
end

-- Helper function to check if the current pane is running Neovim
local function is_vim(pane)
  -- This checks for the IS_NVIM variable, which is set by smart-splits.nvim
  -- or falls back to checking the foreground process name
  local is_nvim = pane:get_user_vars().IS_NVIM == 'true'
  if is_nvim == nil then
    return pane:get_foreground_process_name():find('n?vim') ~= nil
  end
  return is_nvim
end

local direction_keys = {
  h = "Left",
  j = "Down",
  k = "Up",
  l = "Right",
}

local function split_nav(resize_or_move, key)
  return {
    key = key,
    mods = resize_or_move == "resize" and "META" or "CTRL",
    action = wezterm.action_callback(function(win, pane)
      if is_vim(pane) then
        -- pass the keys through to vim/nvim
        win:perform_action({
          SendKey = { key = key, mods = resize_or_move == "resize" and "META" or "CTRL" },
        }, pane)
      else
        if resize_or_move == "resize" then
          win:perform_action({ AdjustPaneSize = { direction_keys[key], 3 } }, pane)
        else
          win:perform_action({ ActivatePaneDirection = direction_keys[key] }, pane)
        end
      end
    end),
  }
end

-- Set Tmux-style Leader Key (CTRL-b)
config.leader = { key = "b", mods = "CTRL", timeout_milliseconds = 1000 }

config.keys = {
	-- Send "CTRL-b" to the terminal when pressing CTRL-b twice
	{ key = "b", mods = "LEADER|CTRL", action = wezterm.action.SendKey({ key = "b", mods = "CTRL" }) },

	-- Pane splitting
	-- Tmux: `prefix + "` -> Horizontal split (top/bottom)
	{ key = '"', mods = "LEADER|SHIFT", action = wezterm.action.SplitVertical({ domain = "CurrentPaneDomain" }) },
	-- Tmux: `prefix + %` -> Vertical split (left/right)
	{ key = "%", mods = "LEADER|SHIFT", action = wezterm.action.SplitHorizontal({ domain = "CurrentPaneDomain" }) },

	-- Pane navigation (Arrow keys)
	{ key = "LeftArrow", mods = "LEADER", action = wezterm.action.ActivatePaneDirection("Left") },
	{ key = "RightArrow", mods = "LEADER", action = wezterm.action.ActivatePaneDirection("Right") },
	{ key = "UpArrow", mods = "LEADER", action = wezterm.action.ActivatePaneDirection("Up") },
	{ key = "DownArrow", mods = "LEADER", action = wezterm.action.ActivatePaneDirection("Down") },

	-- Close pane (Tmux: `prefix + x`)
	{ key = "x", mods = "LEADER", action = wezterm.action.CloseCurrentPane({ confirm = true }) },

	-- Zoom pane (Tmux: `prefix + z`)
	{ key = "z", mods = "LEADER", action = wezterm.action.TogglePaneZoomState },

	-- Tab management (Tmux: Windows)
	-- Create new tab (Tmux: `prefix + c`)
	{ key = "c", mods = "LEADER", action = wezterm.action.SpawnTab("CurrentPaneDomain") },
	-- Go to next tab (Tmux: `prefix + n`)
	{ key = "n", mods = "LEADER", action = wezterm.action.ActivateTabRelative(1) },
	-- Go to previous tab (Tmux: `prefix + p`)
	{ key = "p", mods = "LEADER", action = wezterm.action.ActivateTabRelative(-1) },
	-- Go to last active tab (Tmux: `prefix + l`)
	{ key = "l", mods = "LEADER", action = wezterm.action.ActivateLastTab },

	-- Copy mode (Tmux: `prefix + [`)
	{ key = "[", mods = "LEADER", action = wezterm.action.ActivateCopyMode },

	-- Seamless Neovim / WezTerm pane navigation
	split_nav("move", "h"),
	split_nav("move", "j"),
	split_nav("move", "k"),
	split_nav("move", "l"),

	-- Existing custom mapping
	{ key = "Enter", mods = "SHIFT", action = wezterm.action.SendString("\x1b[13;2u") },
}

-- Add number based tab navigation (Leader + 1, 2, 3...)
for i = 1, 9 do
  table.insert(config.keys, {
    key = tostring(i),
    mods = "LEADER",
    action = wezterm.action.ActivateTab(i - 1),
  })
end

config.window_decorations = "NONE"

-- Tmux-style Tab Bar configuration
config.use_fancy_tab_bar = false
config.tab_bar_at_bottom = true
config.status_update_interval = 1000 -- Update clock/status every second

-- Remove black bar gap between Neovim and the tab bar
config.window_padding = {
  left = 0,
  right = 0,
  top = 0,
  bottom = 0,
}

-- Catppuccin Mocha colors
local colors = {
  crust = "#11111b",
  mantle = "#181825",
  base = "#1e1e2e",
  surface0 = "#313244",
  text = "#cdd6f4",
  mauve = "#cba6f7",
  green = "#a6e3a1",
  peach = "#fab387",
  blue = "#89b4fa",
}

config.colors = {
  background = colors.base, -- Set background to match Catppuccin Base to hide the resize void/black gap
  tab_bar = {
    background = colors.base,
    active_tab = {
      bg_color = colors.mauve,
      fg_color = colors.crust,
    },
    inactive_tab = {
      bg_color = colors.mantle,
      fg_color = colors.text,
    },
    inactive_tab_hover = {
      bg_color = colors.surface0,
      fg_color = colors.text,
    },
    new_tab = {
      bg_color = colors.base,
      fg_color = colors.text,
    },
    new_tab_hover = {
      bg_color = colors.surface0,
      fg_color = colors.text,
    },
  },
}

-- Powerline rounded characters
local SOLID_LEFT = utf8.char(0xe0b6)
local SOLID_RIGHT = utf8.char(0xe0b4)

wezterm.on("update-status", function(window, pane)
  -- 1. Left Status: Leader Indicator & Workspace
  local workspace = window:active_workspace()
  local left_bg = colors.blue
  local left_text = "  " .. workspace .. " "

  if window:leader_is_active() then
    left_bg = colors.peach
    left_text = "  LEADER "
  end

  window:set_left_status(wezterm.format({
    { Background = { Color = left_bg } },
    { Foreground = { Color = colors.crust } },
    { Attribute = { Intensity = "Bold" } },
    { Text = left_text },
    { Background = { Color = colors.base } },
    { Foreground = { Color = left_bg } },
    { Text = SOLID_RIGHT },
    { Background = { Color = colors.base } },
    { Text = " " }, -- Small gap before tabs
  }))

  -- 2. Right Status: Clock
  local date = wezterm.strftime("%H:%M")
  
  window:set_right_status(wezterm.format({
    { Background = { Color = colors.base } },
    { Foreground = { Color = colors.surface0 } },
    { Text = SOLID_LEFT },
    { Background = { Color = colors.surface0 } },
    { Foreground = { Color = colors.text } },
    { Text = " " .. date .. "  " },
  }))
end)

wezterm.on("format-tab-title", function(tab, tabs, panes, config, hover, max_width)
  local index = tab.tab_index + 1
  local title = tab.active_pane.title
  
  if tab.is_active then
    return {
      { Background = { Color = colors.base } },
      { Foreground = { Color = colors.mauve } },
      { Text = SOLID_LEFT },
      { Background = { Color = colors.mauve } },
      { Foreground = { Color = colors.crust } },
      { Attribute = { Intensity = "Bold" } },
      { Text = " " .. index .. " " },
      { Background = { Color = colors.surface0 } },
      { Foreground = { Color = colors.text } },
      { Attribute = { Intensity = "Normal" } },
      { Text = " " .. title .. " " },
      { Background = { Color = colors.base } },
      { Foreground = { Color = colors.surface0 } },
      { Text = SOLID_RIGHT },
      { Background = { Color = colors.base } },
      { Text = " " },
    }
  end

  local bg = colors.mantle
  local fg = colors.text
  if hover then
    bg = colors.surface0
  end

  return {
    { Background = { Color = colors.base } },
    { Foreground = { Color = bg } },
    { Text = SOLID_LEFT },
    { Background = { Color = bg } },
    { Foreground = { Color = fg } },
    { Text = " " .. index .. " " .. title .. " " },
    { Background = { Color = colors.base } },
    { Foreground = { Color = bg } },
    { Text = SOLID_RIGHT },
    { Background = { Color = colors.base } },
    { Text = " " },
  }
end)

return config
