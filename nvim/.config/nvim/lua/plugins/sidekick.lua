-- CLI tool to use for AI sessions (change to "claude", "copilot", etc.)
local CLI_TOOL = "agy"

vim.g.sidekick_cli_tool = CLI_TOOL -- expose for autocmds.lua
local CLI_PREFIX = CLI_TOOL .. "_"
local CLI_PATTERN = "^" .. CLI_TOOL .. "_%d+$"
local CLI_NUM_PATTERN = "^" .. CLI_TOOL .. "_(%d+)$"
local CLI_DISPLAY = CLI_TOOL:sub(1, 1):upper() .. CLI_TOOL:sub(2)

-- Module-level state for dynamic session management
local _active_by_tab = {} -- tabpage -> name of the session visible in that tab
local _prev_by_tab = {} -- tabpage -> name of the previously visible session in that tab (for <leader>al)
local _kill_counter = 0 -- incremented per killed session; ensures unique renamed names

local function current_tab()
    return vim.api.nvim_get_current_tabpage()
end

-- Returns the tabpage a session's terminal window is currently showing in,
-- or nil if it isn't open anywhere. Sidekick terminals track a single window
-- id regardless of tab, so this is the only way to tell which tab (if any)
-- a session is actually visible in.
local function terminal_tab(terminal)
    if not terminal or not terminal.win or not vim.api.nvim_win_is_valid(terminal.win) then
        return nil
    end
    return vim.api.nvim_win_get_tabpage(terminal.win)
end

-- Drop tracked state for tabpages that no longer exist
local function prune_tab_state()
    for tab in pairs(_active_by_tab) do
        if not vim.api.nvim_tabpage_is_valid(tab) then
            _active_by_tab[tab] = nil
        end
    end
    for tab in pairs(_prev_by_tab) do
        if not vim.api.nvim_tabpage_is_valid(tab) then
            _prev_by_tab[tab] = nil
        end
    end
end

local function ensure_extra_slot(tool_name, n)
    local name = tool_name .. "_" .. n
    local tools = require("sidekick.config").cli.tools
    if not tools[name] then
        local ok, ToolMod = pcall(require, "sidekick.cli.tool")
        local base_tool = ok and ToolMod.get(tool_name) or nil
        if base_tool and base_tool.cmd then
            -- Deepcopy preserves cmd, env, keys, format, etc.
            -- Strip is_proc to avoid tmux process-discovery conflicts (same as make_tool())
            local cfg = vim.deepcopy(base_tool.config)
            cfg.is_proc = nil
            tools[name] = cfg
        else
            -- Fallback for unknown tools not in sidekick's built-in config
            tools[name] = { cmd = { tool_name } }
        end
    end
    return name
end


local function ensure_slot(n)
    return ensure_extra_slot(CLI_TOOL, n)
end

local function next_global_slot()
    local tools = require("sidekick.config").cli.tools
    local max_n = 0
    for name in pairs(tools) do
        if name:match("^[%a_]+_%d+$") then
            local n = tonumber(name:match("(%d+)$"))
            if n and n > max_n then
                max_n = n
            end
        end
    end
    return max_n + 1
end

local function is_cli_name(name)
    return name:match(CLI_PATTERN) ~= nil
end

-- True for primary_tool_N (pattern only) or any other tool_N registered in cfg_tools
local function is_our_session(name)
    if is_cli_name(name) then
        return true
    end
    local tools = require("sidekick.config").cli.tools
    return tools[name] ~= nil and name:match("^[%a_]+_%d+$") ~= nil
end

-- Rename the tmux session to a unique _killed_N name, send /exit, then kill after delay.
-- Renaming frees the original slot name immediately so a new session can reuse it.
local function kill_tmux_session(mux_name)
    _kill_counter = _kill_counter + 1
    local killed_name = mux_name .. "_killed_" .. _kill_counter
    vim.fn.system({ "tmux", "rename-session", "-t", mux_name, killed_name })
    vim.fn.system({ "tmux", "send-keys", "-t", killed_name, "/exit", "Enter" })
    vim.defer_fn(function()
        vim.fn.system({ "tmux", "kill-session", "-t", killed_name })
    end, 5000)
end

-- Return the cfg_tools name for global slot i (e.g. "gemini_2"), or nil if none exists
local function find_slot(i)
    local tools = require("sidekick.config").cli.tools
    local pattern = "^[%a_]+_" .. i .. "$"
    for name in pairs(tools) do
        if name:match(pattern) and is_our_session(name) then
            return name
        end
    end
    return nil
end

-- Enforce exclusive visibility *within the current tab*: hide other terminals
-- visible in this tab, show target. If the target is visible in a different
-- tab, move it here — sidekick terminals only support one window each, so a
-- session can't be visible in two tabs simultaneously.
local function toggle_session(name)
    local ok, State = pcall(require, "sidekick.cli.state")
    if not ok then
        require("sidekick.cli").toggle({ name = name, focus = true })
        return
    end

    local cur_tab = current_tab()
    local states = State.get({ attached = true })

    -- Find where (if anywhere) the target session is currently visible
    local target_state, target_tab
    for _, s in ipairs(states) do
        if s.tool.name == name then
            target_state = s
            target_tab = terminal_tab(s.terminal)
            break
        end
    end

    if target_tab == cur_tab then
        -- Visible right here — toggle will hide it
        _active_by_tab[cur_tab] = nil
        require("sidekick.cli").toggle({ name = name, focus = true })
        return
    end

    if target_tab and target_state and target_state.terminal then
        -- Visible in a different tab — move it here
        target_state.terminal:hide()
    end

    -- Track the outgoing session (this tab's) as prev before switching
    local outgoing = _active_by_tab[cur_tab]
    if outgoing and outgoing ~= name then
        _prev_by_tab[cur_tab] = outgoing
    end

    -- Hide only sessions currently visible in THIS tab first (synchronous)
    for _, s in ipairs(states) do
        if s.tool.name ~= name and is_our_session(s.tool.name) and terminal_tab(s.terminal) == cur_tab then
            s.terminal:hide()
        end
    end

    -- Show the target (async via State.with, runs after hides complete)
    _active_by_tab[cur_tab] = name
    require("sidekick.cli").toggle({ name = name, focus = true })
end

-- Toggle all sessions visible in the current tab: hide if any visible here,
-- show this tab's last active session if none
local function toggle_all_sessions()
    local ok, State = pcall(require, "sidekick.cli.state")
    if not ok then
        require("sidekick.cli").toggle({ name = CLI_TOOL, focus = true })
        return
    end

    local cur_tab = current_tab()
    local states = State.get({ attached = true })
    local any_visible = false

    for _, s in ipairs(states) do
        if is_our_session(s.tool.name) and terminal_tab(s.terminal) == cur_tab then
            any_visible = true
            s.terminal:hide()
        end
    end

    if any_visible then
        -- Keep _active_by_tab[cur_tab] so the next toggle restores the same session
    else
        -- Show the last active session for this tab, default to primary
        local name = _active_by_tab[cur_tab] or ensure_slot(1)
        _active_by_tab[cur_tab] = name
        require("sidekick.cli").toggle({ name = name, focus = true })
    end
end

-- Return all registered session names sorted by slot number
local function get_all_session_names()
    local tools = require("sidekick.config").cli.tools
    local names = {}
    for name in pairs(tools) do
        if is_our_session(name) then
            names[#names + 1] = name
        end
    end
    table.sort(names, function(a, b)
        local na = tonumber(a:match("(%d+)$")) or 0
        local nb = tonumber(b:match("(%d+)$")) or 0
        return na < nb
    end)
    return names
end

local function navigate_session(direction)
    local cur_tab = current_tab()
    local names = get_all_session_names()
    if #names == 0 then
        local name = ensure_slot(1)
        toggle_session(name)
        return
    end
    local idx = 0
    local active = _active_by_tab[cur_tab]
    for i, name in ipairs(names) do
        if name == active then
            idx = i
            break
        end
    end
    if idx == 0 then
        idx = direction == 1 and #names or 1
    end
    local new_idx = ((idx - 1 + direction) % #names) + 1
    local name = names[new_idx]
    local n = tonumber(name:match(CLI_NUM_PATTERN))
    if n then ensure_slot(n) end
    toggle_session(name)
end

-- Returns the name of the session visible in the current tab, for send routing
local function get_active_session_name()
    local cur_tab = current_tab()
    if _active_by_tab[cur_tab] then
        return _active_by_tab[cur_tab]
    end
    -- Fallback: scan for any terminal visible in this tab
    local ok, State = pcall(require, "sidekick.cli.state")
    if not ok then
        return nil
    end
    for _, s in ipairs(State.get({ attached = true })) do
        if is_our_session(s.tool.name) and terminal_tab(s.terminal) == cur_tab then
            _active_by_tab[cur_tab] = s.tool.name
            return s.tool.name
        end
    end
    -- Default: register slot 1 so send uses a tracked session, not bare CLI_TOOL
    return ensure_slot(1)
end

local keys = {
    {
        "<leader>aa",
        function()
            local ok, State = pcall(require, "sidekick.cli.state")
            if not ok then
                return
            end
            local states = State.get({})
            local items = {}
            for _, s in ipairs(states) do
                if is_our_session(s.tool.name) then
                    items[#items + 1] = s
                end
            end
            if #items == 0 then
                vim.notify("No " .. CLI_DISPLAY .. " sessions", vim.log.levels.INFO)
                return
            end
            vim.ui.select(items, {
                prompt = CLI_DISPLAY .. " Sessions",
                format_item = function(s)
                    local status
                    if s.terminal and s.terminal:is_open() then
                        local tab = terminal_tab(s.terminal)
                        status = tab and (" [visible: tab " .. vim.api.nvim_tabpage_get_number(tab) .. "]") or " [visible]"
                    elseif s.session ~= nil then
                        status = " [attached]"
                    else
                        status = ""
                    end
                    return s.tool.name .. status
                end,
            }, function(choice)
                if choice then
                    local n = tonumber(choice.tool.name:match(CLI_NUM_PATTERN))
                    if n then
                        ensure_slot(n)
                    end
                    toggle_session(choice.tool.name)
                end
            end)
        end,
        desc = "Pick " .. CLI_DISPLAY .. " Session",
    },
    {
        "<leader>ao",
        function()
            local ok, State = pcall(require, "sidekick.cli.state")
            if not ok then
                return
            end

            local states = State.get({ installed = true })
            local items = {}
            for _, s in ipairs(states) do
                local name = s.tool.name
                -- Only bare tool names (no _N suffix)
                if not name:match("^[%a_]+_%d+$") then
                    items[#items + 1] = s
                end
            end

            if #items == 0 then
                vim.notify("No installed CLI tools found", vim.log.levels.INFO)
                return
            end

            local ok_sel, SelectMod = pcall(require, "sidekick.cli.ui.select")
            local snacks_fmt = ok_sel and SelectMod.format or nil

            vim.ui.select(items, {
                prompt = "Open CLI Tool",
                kind = "sidekick_cli",
                format_item = function(s)
                    local status = (s.terminal and s.terminal:is_open()) and " [visible]"
                        or s.attached and " [attached]"
                        or ""
                    return s.tool.name .. status
                end,
                snacks = snacks_fmt and { format = snacks_fmt } or nil,
            }, function(choice)
                if choice then
                    local n = next_global_slot()
                    local name = ensure_extra_slot(choice.tool.name, n)
                    toggle_session(name)
                end
            end)
        end,
        desc = "Open Other CLI Tool",
    },
    {
        "<leader>an",
        function()
            local n = next_global_slot()
            local name = ensure_slot(n)
            toggle_session(name)
        end,
        desc = "New " .. CLI_DISPLAY .. " Session",
    },
    {
        "<leader>as",
        function()
            toggle_all_sessions()
        end,
        desc = "Toggle " .. CLI_DISPLAY .. " (Sidekick)",
        mode = { "n", "x" },
    },
    {
        "<leader>ad",
        function()
            require("sidekick.cli").close()
            _active_by_tab[current_tab()] = nil
        end,
        desc = "Detach CLI Session",
    },
    {
        "<leader>ar",
        function()
            local count = require("config.sidekick_restore").restore()
            if count > 0 then
                vim.notify("Relinked " .. count .. " " .. CLI_DISPLAY .. " session(s)", vim.log.levels.INFO)
            else
                vim.notify("No matching " .. CLI_DISPLAY .. " sessions for this cwd", vim.log.levels.INFO)
            end
        end,
        desc = "Relink " .. CLI_DISPLAY .. " Sessions (no buffer restore)",
    },
    {
        "<leader>al",
        function()
            local name = _prev_by_tab[current_tab()]
            if not name then
                vim.notify("No previous " .. CLI_DISPLAY .. " session", vim.log.levels.INFO)
                return
            end
            local n = tonumber(name:match(CLI_NUM_PATTERN))
            if n then
                ensure_slot(n)
            end
            toggle_session(name)
        end,
        desc = "Last " .. CLI_DISPLAY .. " Session",
    },
    {
        "<leader>ak",
        function()
            local ok, State = pcall(require, "sidekick.cli.state")
            if not ok then
                return
            end
            local states = State.get({})
            local count = 0
            local tmux_sessions = {}
            local cfg_tools = require("sidekick.config").cli.tools
            local Session = require("sidekick.cli.session")
            for _, s in ipairs(states) do
                if is_our_session(s.tool.name) then
                    if s.session and s.session.mux_session then
                        -- Attached or discovered session: use stored tmux session name
                        tmux_sessions[#tmux_sessions + 1] = s.session.mux_session
                    else
                        -- Registered tool with no session: compute tmux session name from sid
                        tmux_sessions[#tmux_sessions + 1] = Session.sid({ tool = s.tool.name })
                    end
                    if s.attached then
                        State.detach(s)
                    end
                    cfg_tools[s.tool.name] = nil
                    count = count + 1
                end
            end
            _active_by_tab = {}
            _prev_by_tab = {}
            -- Rename each session before killing so the slot name is freed immediately
            for _, mux_name in ipairs(tmux_sessions) do
                kill_tmux_session(mux_name)
            end
            if count > 0 then
                vim.notify("Killed " .. count .. " AI session(s)", vim.log.levels.INFO)
            else
                vim.notify("No AI sessions to kill", vim.log.levels.INFO)
            end
        end,
        desc = "Kill All " .. CLI_DISPLAY .. " Sessions",
    },
    {
        "<leader>ax",
        function()
            local name = _active_by_tab[current_tab()]
            if not name then
                vim.notify("No active " .. CLI_DISPLAY .. " session", vim.log.levels.INFO)
                return
            end
            local ok, State = pcall(require, "sidekick.cli.state")
            if not ok then
                return
            end
            local states = State.get({})
            local cfg_tools = require("sidekick.config").cli.tools
            local Session = require("sidekick.cli.session")
            for _, s in ipairs(states) do
                if s.tool.name == name then
                    local mux_name = (s.session and s.session.mux_session) or Session.sid({ tool = s.tool.name })
                    if s.attached then
                        State.detach(s)
                    end
                    cfg_tools[s.tool.name] = nil
                    -- Purge this session from every tab's tracked state
                    for tab, n in pairs(_active_by_tab) do
                        if n == name then _active_by_tab[tab] = nil end
                    end
                    for tab, n in pairs(_prev_by_tab) do
                        if n == name then _prev_by_tab[tab] = nil end
                    end
                    kill_tmux_session(mux_name)
                    vim.notify("Killed " .. CLI_DISPLAY .. " session: " .. name, vim.log.levels.INFO)
                    return
                end
            end
            vim.notify("Session not found: " .. name, vim.log.levels.WARN)
        end,
        desc = "Kill Active " .. CLI_DISPLAY .. " Session",
    },
    {
        "<leader>af",
        function()
            require("sidekick.cli").send({ msg = "{file}", name = get_active_session_name() })
        end,
        desc = "Send Current File to AI",
    },
    {
        "<leader>at",
        function()
            require("sidekick.cli").send({ msg = "{this}", name = get_active_session_name() })
        end,
        mode = { "x", "n" },
        desc = "Send This (context) to AI",
    },
    {
        "<leader>av",
        function()
            require("sidekick.cli").send({ msg = "{selection}", name = get_active_session_name() })
        end,
        mode = { "x" },
        desc = "Send Visual Selection to AI",
    },
    {
        "<leader>ay",
        function()
            -- Copy current selection to system clipboard, then send to AI
            vim.cmd('normal! "+y')
            require("sidekick.cli").send({ msg = "{selection}", name = get_active_session_name() })
        end,
        mode = { "x" },
        desc = "Copy to Clipboard + Send to AI",
    },
    {
        "<leader>ap",
        function()
            -- Send clipboard contents to AI
            local clipboard = vim.fn.getreg("+")
            if clipboard and clipboard ~= "" then
                require("sidekick.cli").send({ msg = clipboard, name = get_active_session_name() })
            else
                vim.notify("Clipboard is empty", vim.log.levels.WARN)
            end
        end,
        mode = { "n" },
        desc = "Send Clipboard to AI",
    },
    {
        "<Tab>",
        function()
            -- if there is a next edit, jump to it, otherwise apply it if any
            if not require("sidekick").nes_jump_or_apply() then
                return "<Tab>" -- fallback to normal tab
            end
        end,
        expr = true,
        desc = "Goto/Apply Next Edit Suggestion",
    },
    {
        "<leader>a]",
        function() navigate_session(1) end,
        desc = "Next " .. CLI_DISPLAY .. " Session",
    },
    {
        "<leader>a[",
        function() navigate_session(-1) end,
        desc = "Prev " .. CLI_DISPLAY .. " Session",
    },
}

for i = 1, 5 do
    keys[#keys + 1] = {
        "<leader>a" .. i,
        function()
            local name = find_slot(i) or ensure_slot(i)
            toggle_session(name)
        end,
        desc = CLI_DISPLAY .. " Session " .. i,
    }
end

return {
  {
    "folke/sidekick.nvim",
    event = "VeryLazy",
    keys = keys,
    opts = {
      -- CLI configuration for AI tools
      cli = {
        mux = {
          backend = "tmux", -- Using tmux as requested
          enabled = true,
        },
        tools = {
            agy = {
                cmd = { vim.fn.expand("~/.local/bin/agy") },
            },
        },
        win = {
          keys = {
            prompt = false, -- pass <C-p> through to Claude Code for navigation
            buffers = { "<c-t>", "buffers", mode = "nt", desc = "open buffer picker" },
          },
        },
      },
      -- UI configuration
      ui = {
        border = "rounded",
      },
    },
        -- Override the vim.ui.select configuration for sidekick_cli picker
        dependencies = {
            {
                "folke/snacks.nvim",
                opts = function(_, opts)
    opts.picker = opts.picker or {}
    opts.picker.ui_select = opts.picker.ui_select or {}
    opts.picker.ui_select.sidekick_cli = {
        mappings = {
            d = {
                mode = "n",
                action = function(picker)
                    local item = picker:current()
                    if item and item.session then
                        -- Send exit command to the selected session
                        local cli = require("sidekick.cli")

                        -- First close the picker
                        picker:close()

                        -- Send exit to the specific session
                        vim.schedule(function()
                            cli.send({
                                msg = "exit",
                                filter = { session = item.session.id },
                            })
                            vim.notify("Deleting session: " .. item.tool.name, vim.log.levels.INFO)
                        end)
                    else
                        vim.notify("No active session to delete", vim.log.levels.WARN)
                    end
                end,
                desc = "Delete session",
            },
        },
    }
    return opts
                end,
            },
        },
        config = function(_, opts)
    require("sidekick").setup(opts)
    vim.api.nvim_create_autocmd("TabClosed", { callback = prune_tab_state })
        end,
    },
}
