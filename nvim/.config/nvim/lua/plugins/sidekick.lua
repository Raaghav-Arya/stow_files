-- Module-level state for dynamic Claude session management
local _claude_base = nil
local _active_session = nil -- name of the currently visible Claude session

local function get_claude_base()
    if _claude_base then
        return _claude_base
    end
    local f = vim.api.nvim_get_runtime_file("sk/cli/claude.lua", false)[1]
    if f then
        local ok, ret = pcall(dofile, f)
        if ok and type(ret) == "table" then
            _claude_base = ret
        end
    end
    _claude_base = _claude_base or {}
    return _claude_base
end

local function make_claude_tool()
    local base = get_claude_base()
    return {
        cmd = { "claude" },
        format = base.format,
        -- NOTE: no is_proc to avoid tmux process-discovery conflicts with multiple claude tools
    }
end

local function ensure_claude_slot(n)
    local name = "claude_" .. n
    local tools = require("sidekick.config").cli.tools
    if not tools[name] then
        tools[name] = make_claude_tool()
    end
    return name
end

local function next_available_slot()
    local tools = require("sidekick.config").cli.tools
    local i = 1
    while tools["claude_" .. i] do
        i = i + 1
    end
    return i
end

local function is_claude_name(name)
    return name:match("^claude_%d+$") ~= nil
end

-- Enforce exclusive visibility: hide other Claude terminals, show target
local function toggle_claude(name)
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
        -- Hide all other visible Claude terminals first (synchronous)
        for _, s in ipairs(states) do
            if s.tool.name ~= name and is_claude_name(s.tool.name) and s.terminal and s.terminal:is_open() then
                s.terminal:hide()
            end
        end
        -- Show the target (async via State.with, runs after hides complete)
        _active_session = name
        require("sidekick.cli").toggle({ name = name, focus = true })
    end
end

-- Toggle all Claude sessions: hide all if any visible, show last active if none
local function toggle_all_claude()
    local ok, State = pcall(require, "sidekick.cli.state")
    if not ok then
        require("sidekick.cli").toggle({ name = "claude", focus = true })
        return
    end

    local states = State.get({ attached = true })
    local any_visible = false

    for _, s in ipairs(states) do
        if is_claude_name(s.tool.name) and s.terminal and s.terminal:is_open() then
            any_visible = true
            s.terminal:hide()
        end
    end

    if any_visible then
        _active_session = nil
    else
        -- Show the last active session, default to primary
        local name = _active_session or ensure_claude_slot(1)
        _active_session = name
        require("sidekick.cli").toggle({ name = name, focus = true })
    end
end

-- Returns the name of the currently visible Claude session for send routing
local function get_active_claude_name()
    if _active_session then
        return _active_session
    end
    -- Fallback: scan for any visible Claude terminal
    local ok, State = pcall(require, "sidekick.cli.state")
    if not ok then
        return nil
    end
    for _, s in ipairs(State.get({ attached = true })) do
        if is_claude_name(s.tool.name) and s.terminal and s.terminal:is_open() then
            _active_session = s.tool.name
            return s.tool.name
        end
    end
    return nil
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
                if is_claude_name(s.tool.name) then
                    items[#items + 1] = s
                end
            end
            if #items == 0 then
                vim.notify("No Claude sessions", vim.log.levels.INFO)
                return
            end
            vim.ui.select(items, {
                prompt = "Claude Sessions",
                format_item = function(s)
                    local status = (s.terminal and s.terminal:is_open()) and " [visible]"
                        or (s.session ~= nil) and " [attached]"
                        or ""
                    return s.tool.name .. status
                end,
            }, function(choice)
                if choice then
                    local n = tonumber(choice.tool.name:match("^claude_(%d+)$")) or 1
                    ensure_claude_slot(n)
                    toggle_claude(choice.tool.name)
                end
            end)
        end,
        desc = "Pick Claude Session",
    },
    {
        "<leader>an",
        function()
            local n = next_available_slot()
            local name = ensure_claude_slot(n)
            toggle_claude(name)
        end,
        desc = "New Claude Session",
    },
    {
        "<leader>as",
        function()
            toggle_all_claude()
        end,
        desc = "Toggle Claude (Sidekick)",
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
                if is_claude_name(s.tool.name) then
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
                vim.notify("Killed " .. count .. " Claude session(s)", vim.log.levels.INFO)
            else
                vim.notify("No Claude sessions to kill", vim.log.levels.INFO)
            end
        end,
        desc = "Kill All Claude Sessions",
    },
    {
        "<leader>ax",
        function()
            local name = _active_session
            if not name then
                vim.notify("No active Claude session", vim.log.levels.INFO)
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
                    vim.notify("Killed Claude session: " .. name, vim.log.levels.INFO)
                    return
                end
            end
            vim.notify("Session not found: " .. name, vim.log.levels.WARN)
        end,
        desc = "Kill Active Claude Session",
    },
    {
        "<leader>af",
        function()
            require("sidekick.cli").send({ msg = "{file}", name = get_active_claude_name() })
        end,
        desc = "Send Current File to AI",
    },
    {
        "<leader>at",
        function()
            require("sidekick.cli").send({ msg = "{this}", name = get_active_claude_name() })
        end,
        mode = { "x", "n" },
        desc = "Send This (context) to AI",
    },
    {
        "<leader>av",
        function()
            require("sidekick.cli").send({ msg = "{selection}", name = get_active_claude_name() })
        end,
        mode = { "x" },
        desc = "Send Visual Selection to AI",
    },
    {
        "<leader>ay",
        function()
            -- Copy current selection to system clipboard, then send to AI
            vim.cmd('normal! "+y')
            require("sidekick.cli").send({ msg = "{selection}", name = get_active_claude_name() })
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
                require("sidekick.cli").send({ msg = clipboard, name = get_active_claude_name() })
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
            local name = ensure_claude_slot(i)
            toggle_claude(name)
        end,
        desc = "Claude Session " .. i,
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
