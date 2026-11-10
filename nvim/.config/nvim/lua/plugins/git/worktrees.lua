return {
    "Raaghav-Arya/worktrees.nvim",
    commit = "28d3ecf5d1dc02bc9e48953512b18ff578090263",
    dependencies = { "folke/snacks.nvim" },
    keys = {
        {
            "<leader>gwc",
            function()
                require("worktrees").create()
            end,
            desc = "Create Worktree",
        },
        {
            "<leader>gws",
            function()
                require("worktrees").switch()
            end,
            desc = "Switch Worktree",
        },
    },
    opts = {
        open_mode = "tab",
        picker = function(items, on_choice)
            local picker_items = {}
            for _, item in ipairs(items) do
                local branch = item.branch or ("detached @ " .. (item.worktree.head or ""):sub(1, 7))
                table.insert(picker_items, {
                    text = branch .. " " .. item.path,
                    worktree_item = item,
                })
            end
            Snacks.picker({
                title = "Git Worktrees",
                items = picker_items,
                format = function(item, picker)
                    local entry = item.worktree_item
                    local branch = entry.branch or ("detached @ " .. (entry.worktree.head or ""):sub(1, 7))
                    local path = Snacks.picker.util.truncpath(entry.path, 52, {
                        cwd = picker:cwd(),
                        kind = "center",
                    })
                    return {
                        { "  ", "Comment" },
                        { branch, "Identifier" },
                        { "  " .. path, "Comment" },
                    }
                end,
                preview = "none",
                layout = { preset = "select" },
                confirm = function(picker, item)
                    picker:close()
                    vim.schedule(function()
                        on_choice(item and item.worktree_item)
                    end)
                end,
            })
        end,
        -- Optional example: enable an on_tab_open callback to run a Sidekick
        -- command. Sidekick terminals have one visible window, so do not
        -- automatically move an existing session between worktree tabs.
        -- on_tab_open = function(context)
        --     require("sidekick.cli").toggle({ name = "opencode", focus = true })
        -- end,
    },
    config = function(_, opts)
        require("worktrees").setup(opts)
    end,
}
