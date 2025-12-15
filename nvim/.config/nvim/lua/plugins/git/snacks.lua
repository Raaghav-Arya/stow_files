-- Override Snacks git picker keybindings to work relative to buffer's git root
-- Uses LazyVim.root.git() for proper nested git repository detection
--
-- NOTE: There's a known issue with git_restore (<c-r>) in nested git repos.
-- The git.diff() function in snacks.nvim ignores the provided cwd and calls
-- ctx:git_root() which finds the wrong parent repo. This has been reported upstream.
return {
    "folke/snacks.nvim",
    opts = {},
    keys = {
        -- Git log commands
        {
            "<leader>gl",
            function()
                Snacks.picker.git_log({ cwd = LazyVim.root.git() })
            end,
            desc = "Git Log (Buffer's Git Root)",
        },
        {
            "<leader>gL",
            function()
                Snacks.picker.git_log({ cwd = vim.fn.getcwd() })
            end,
            desc = "Git Log (cwd)",
        },
        {
            "<leader>gb",
            function()
                -- git_log_line auto-detects from current buffer/line
                Snacks.picker.git_log_line()
            end,
            desc = "Git Blame Line",
        },
        {
            "<leader>gf",
            function()
                -- git_log_file auto-detects from current buffer
                Snacks.picker.git_log_file()
            end,
            desc = "Git Current File History",
        },

        -- Git diff commands
        {
            "<leader>gd",
            function()
                Snacks.picker.git_diff({ cwd = LazyVim.root.git() })
            end,
            desc = "Git Diff (hunks)",
        },
        {
            "<leader>gD",
            function()
                Snacks.picker.git_diff({ cwd = LazyVim.root.git(), base = "origin", group = true })
            end,
            desc = "Git Diff (origin)",
        },

        -- Git status and stash
        {
            "<leader>gs",
            function()
                Snacks.picker.git_status({ cwd = LazyVim.root.git() })
            end,
            desc = "Git Status",
        },
        {
            "<leader>gS",
            function()
                Snacks.picker.git_stash({ cwd = LazyVim.root.git() })
            end,
            desc = "Git Stash",
        },

        -- Git files
        {
            "<leader>fg",
            function()
                Snacks.picker.git_files({ cwd = LazyVim.root.git() })
            end,
            desc = "Find Files (git-files)",
        },

        -- GitHub integration
        {
            "<leader>gi",
            function()
                Snacks.picker.gh_issue({ cwd = LazyVim.root.git() })
            end,
            desc = "GitHub Issues (open)",
        },
        {
            "<leader>gI",
            function()
                Snacks.picker.gh_issue({ cwd = LazyVim.root.git(), state = "all" })
            end,
            desc = "GitHub Issues (all)",
        },
        {
            "<leader>gp",
            function()
                Snacks.picker.gh_pr({ cwd = LazyVim.root.git() })
            end,
            desc = "GitHub Pull Requests (open)",
        },
        {
            "<leader>gP",
            function()
                Snacks.picker.gh_pr({ cwd = LazyVim.root.git(), state = "all" })
            end,
            desc = "GitHub Pull Requests (all)",
        },
    },
}
