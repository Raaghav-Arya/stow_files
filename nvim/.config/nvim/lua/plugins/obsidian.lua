return {
    "obsidian-nvim/obsidian.nvim",
    version = "*", -- use latest release, remove to use latest commit
    ft = "markdown",
    dependencies = {
        "nvim-lua/plenary.nvim",
        "saghen/blink.cmp",
    },
    ---@module 'obsidian'
    ---@type obsidian.config
    opts = {
        legacy_commands = false, -- this will be removed in the next major release
         footer = {
            enabled = false,
        },
        workspaces = {
            {
                name = "personal",
                path = "~/vaults/personal",
            },
        },

        -- Daily notes configuration
        daily_notes = {
            folder = "daily",
            date_format = "%Y-%m-%d",
            alias_format = "%B %-d, %Y",
            default_tags = { "daily-notes" },
            workdays_only = false,
        },

        -- Templates configuration
        templates = {
            folder = "templates",
            date_format = "%Y-%m-%d",
            time_format = "%H:%M",
        },

        -- Completion settings
        completion = {
            blink = true,
            min_chars = 2,
        },

        -- Enable wiki-style links [[like this]]
        preferred_link_style = "wiki",

        -- Open notes in current buffer
        open_notes_in = "current",

        -- Callbacks for setting up keymaps when entering a note
        callbacks = {
            enter_note = function(note)
                -- Smart action on <CR>: follow links, toggle checkboxes, etc.
                vim.keymap.set("n", "<CR>", function()
                    require("obsidian.api").smart_action()
                end, {
                    buffer = true,
                    desc = "Obsidian: Smart action",
                })

                -- Navigate between links
                vim.keymap.set("n", "]o", function()
                    require("obsidian.api").nav_link("next")
                end, {
                    buffer = true,
                    desc = "Obsidian: Next link",
                })

                vim.keymap.set("n", "[o", function()
                    require("obsidian.api").nav_link("prev")
                end, {
                    buffer = true,
                    desc = "Obsidian: Previous link",
                })
            end,
        },
    },

    -- Global keybindings for Obsidian commands (available everywhere)
    keys = {
        -- Quick access
        { "<leader>oo", "<cmd>Obsidian quick_switch<cr>", desc = "Obsidian: Quick switch" },
        { "<leader>os", "<cmd>Obsidian search<cr>", desc = "Obsidian: Search notes" },
        { "<leader>on", "<cmd>Obsidian new<cr>", desc = "Obsidian: New note" },

        -- Daily notes
        { "<leader>od", "<cmd>Obsidian today<cr>", desc = "Obsidian: Today's note" },
        { "<leader>oy", "<cmd>Obsidian yesterday<cr>", desc = "Obsidian: Yesterday's note" },
        { "<leader>om", "<cmd>Obsidian tomorrow<cr>", desc = "Obsidian: Tomorrow's note" },
        { "<leader>oc", "<cmd>Obsidian dailies<cr>", desc = "Obsidian: Calendar (dailies)" },

        -- Navigation
        { "<leader>ob", "<cmd>Obsidian backlinks<cr>", desc = "Obsidian: Backlinks" },
        { "<leader>ol", "<cmd>Obsidian links<cr>", desc = "Obsidian: Links in note" },
        { "<leader>ot", "<cmd>Obsidian tags<cr>", desc = "Obsidian: Find tags" },
        { "<leader>oT", "<cmd>Obsidian toc<cr>", desc = "Obsidian: Table of contents" },

        -- Templates
        { "<leader>oi", "<cmd>Obsidian template<cr>", desc = "Obsidian: Insert template" },
        { "<leader>oN", "<cmd>Obsidian new_from_template<cr>", desc = "Obsidian: New from template" },

        -- Editing
        { "<leader>or", "<cmd>Obsidian rename<cr>", desc = "Obsidian: Rename note" },
        { "<leader>ox", "<cmd>Obsidian toggle_checkbox<cr>", desc = "Obsidian: Toggle checkbox" },
        { "<leader>op", "<cmd>Obsidian paste_img<cr>", desc = "Obsidian: Paste image" },

        -- Visual mode: link selected text
        { "<leader>ol", ":<C-u>Obsidian link<cr>", mode = "v", desc = "Obsidian: Link to note" },
        { "<leader>on", ":<C-u>Obsidian link_new<cr>", mode = "v", desc = "Obsidian: Link to new note" },
        { "<leader>oe", ":<C-u>Obsidian extract_note<cr>", mode = "v", desc = "Obsidian: Extract to new note" },

        -- Workspace
        { "<leader>ow", "<cmd>Obsidian workspace<cr>", desc = "Obsidian: Switch workspace" },

        -- Open in Obsidian app
        { "<leader>oO", "<cmd>Obsidian open<cr>", desc = "Obsidian: Open in app" },
    },
}
