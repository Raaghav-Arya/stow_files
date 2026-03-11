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

config.window_decorations = "NONE"

return config
