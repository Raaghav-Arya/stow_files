-- CLI tool to use for AI sessions (change to "claude", "copilot", etc.)
local CLI_TOOL = "gemini"

vim.g.sidekick_cli_tool = CLI_TOOL -- expose for autocmds.lua
local CLI_PREFIX = CLI_TOOL .. "_"
local CLI_PATTERN = "^" .. CLI_TOOL .. "_%d+$"
local CLI_NUM_PATTERN = "^" .. CLI_TOOL .. "_(%d+)$"
local CLI_DISPLAY = CLI_TOOL:sub(1, 1):upper() .. CLI_TOOL:sub(2)
local CLI_SK_FILE = "sk/cli/" .. CLI_TOOL .. ".lua"

-- Module-level state for dynamic session management
local _tool_base = nil
local _active_session = nil -- name of the currently visible session
local _prev_session = nil -- name of the previously visible session (for <leader>al)

local function get_tool_base()
    if _tool_base then
        return _tool_base
    end
    local f = vim.api.nvim_get_runtime_file(CLI_SK_FILE, false)[1]
    if f then
        local ok, ret = pcall(dofile, f)
        if ok and type(ret) == "table" then
            _tool_base = ret
        end
    end
    _tool_base = _tool_base or {}
    return _tool_base
end

local function make_tool()
    local base = get_tool_base()
    return {
        cmd = { CLI_TOOL },
        format = base.format,
        -- NOTE: no is_proc to avoid tmux process-discovery conflicts with multiple tools
    }
end

local function ensure_slot(n)
    local name = CLI_PREFIX .. n
    local tools = require("sidekick.config").cli.tools
    if not tools[name] then
        tools[name] = make_tool()
    end
    return name
end

local function ensure_extra_slot(tool_name, n)
    local name = tool_name .. "_" .. n
    local tools = require("sidekick.config").cli.tools
    if not tools[name] then
        local base_config = tools[tool_name]
        if base_config then
            -- Deepcopy preserves cmd, env, keys, format, etc.
            -- Strip is_proc to avoid tmux process-discovery conflicts (same as make_tool())
            local cfg = vim.deepcopy(base_config)
            cfg.is_proc = nil
            tools[name] = cfg
        else
            -- Fallback for unknown tools not in sidekick's built-in config
            tools[name] = { cmd = { tool_name } }
        end
    end
    return name
end

local function next_global_slot()
    local tools = require("sidekick.config").cli.tools
    local max_n = 0
    for name in pairs(tools) do
        if name:match("^[%a_]+_%d+$") then
            local n = tonumber(name:match("(%d+)$"))
            if n and n > max_n then max_n = n end
        end
    end
    return max_n + 1
end

local function is_cli_name(name)
    return name:match(CLI_PATTERN) ~= nil
end

-- True for gemini_N (pattern only) or any other tool_N registered in cfg_tools
local function is_our_session(name)
    if is_cli_name(name) then return true end
    local tools = require("sidekick.config").cli.tools
    return tools[name] ~= nil and name:match("^[%a_]+_%d+$") ~= nil
end

-- Return the cfg_tools name for global slot i (e.g. "claude_2"), or nil if none exists
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

-- Enforce exclusive visibility: hide other terminals, show target
local function toggle_session(name)
    local ok, State = pcall(require, "sidekick.cli.state")
    if not ok then
        require("sidekick.cli").toggle({ name = name, focus = true })
        return
    end

    local states = State.get({ attached = true })

    -- Check if the target session is currently visible
    local target_visible = false
    for _, s in ipairs(states) do
        if s.tool.name == name and s.terminal and s.terminal:is_open() then
            target_visible = true
            break
        end
    end

    if target_visible then
        -- Target is shown — toggle will hide it
        _active_session = nil
        require("sidekick.cli").toggle({ name = name, focus = true })
    else
        -- Track the outgoing session as prev before switching
        if _active_session and _active_session ~= name then
            _prev_session = _active_session
        end
        -- Hide all other visible terminals first (synchronous)
        for _, s in ipairs(states) do
            if s.tool.name ~= name and is_our_session(s.tool.name) and s.terminal and s.terminal:is_open() then
                s.terminal:hide()
            end
        end
        -- Show the target (async via State.with, runs after hides complete)
        _active_session = name
        require("sidekick.cli").toggle({ name = name, focus = true })
    end
end

-- Toggle all sessions: hide all if any visible, show last active if none
local function toggle_all_sessions()
    local ok, State = pcall(require, "sidekick.cli.state")
    if not ok then
        require("sidekick.cli").toggle({ name = CLI_TOOL, focus = true })
        return
    end

    local states = State.get({ attached = true })
    local any_visible = false

    for _, s in ipairs(states) do
        if is_our_session(s.tool.name) and s.terminal and s.terminal:is_open() then
            any_visible = true
            s.terminal:hide()
        end
    end

    if any_visible then
        -- Keep _active_session so the next toggle restores the same session
    else
        -- Show the last active session, default to primary
        local name = _active_session or ensure_slot(1)
        _active_session = name
        require("sidekick.cli").toggle({ name = name, focus = true })
    end
end

-- Returns the name of the currently visible session for send routing
local function get_active_session_name()
    if _active_session then
        return _active_session
    end
    -- Fallback: scan for any visible terminal
    local ok, State = pcall(require, "sidekick.cli.state")
    if not ok then
        return nil
    end
    for _, s in ipairs(State.get({ attached = true })) do
        if is_our_session(s.tool.name) and s.terminal and s.terminal:is_open() then
            _active_session = s.tool.name
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
                    local status = (s.terminal and s.terminal:is_open()) and " [visible]"
                        or (s.session ~= nil) and " [attached]"
                        or ""
                    return s.tool.name .. status
                end,
            }, function(choice)
                if choice then
                    local n = tonumber(choice.tool.name:match(CLI_NUM_PATTERN))
                    if n then ensure_slot(n) end
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
            if not ok then return end

            local states = State.get({ installed = true })
            local items = {}
            for _, s in ipairs(states) do
                local name = s.tool.name
                -- Only bare tool names (no _N suffix), excluding the default CLI_TOOL
                if name ~= CLI_TOOL and not name:match("^[%a_]+_%d+$") then
                    items[#items + 1] = s
                end
            end

            if #items == 0 then
                vim.notify("No other installed CLI tools found", vim.log.levels.INFO)
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
            _active_session = nil
        end,
        desc = "Detach CLI Session",
    },
    {
        "<leader>al",
        function()
            if not _prev_session then
                vim.notify("No previous " .. CLI_DISPLAY .. " session", vim.log.levels.INFO)
                return
            end
            local name = _prev_session
            local n = tonumber(name:match(CLI_NUM_PATTERN))
            if n then ensure_slot(n) end
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
            _active_session = nil
            -- Kill the tmux sessions after Neovim cleanup
            for _, mux_name in ipairs(tmux_sessions) do
                vim.fn.system({ "tmux", "kill-session", "-t", mux_name })
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
            local name = _active_session
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
                    _active_session = nil
                    vim.fn.system({ "tmux", "kill-session", "-t", mux_name })
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
    end,
  },
}
