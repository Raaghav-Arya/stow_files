-- Snacks picker configuration to follow symlinks
return {
    {
        "folke/snacks.nvim",
        opts = {
            picker = {
                -- Define custom layout as a preset
                layouts = {
                    custom_horizontal = {
                        layout = {
                            box = "horizontal",
                            width = 0.85,
                            min_width = 120,
                            height = 0.80,
                            {
                                box = "vertical",
                                border = true,
                                title = "{title} {live} {flags}",
                                { win = "input", height = 1, border = "bottom" },
                                { win = "list", border = "none" },
                            },
                            { win = "preview", title = "{preview}", border = true, width = 0.65 },
                        },
                    },
                },
                -- Reference the preset (no array elements here!)
                layout = { preset = "custom_horizontal" },
                win = {
                    preview = {
                        wo = {
                            wrap = true,
                        },
                    },
                },
                exclude = {
                    "**/pdk_09_00/**",
                    "**/targetfs*/**",
                },
                sources = {
                    -- Configure files picker to follow symlinks
                    files = {
                        follow = true, -- Follow symlinks when searching for files
                        hidden = false, -- Set to true if you also want hidden files
                        ignored = true, -- Show files even if they're in .gitignore
                    },
                    -- Configure grep picker to follow symlinks
                    grep = {
                        follow = true, -- Follow symlinks when grepping
                        hidden = false, -- Set to true if you also want to search in hidden files
                        ignored = true, -- Search in files even if they're in .gitignore
                    },
                    -- Configure grep_word picker to follow symlinks
                    grep_word = {
                        follow = true, -- Follow symlinks when searching for words
                        ignored = true, -- Search in files even if they're in .gitignore
                    },
                    -- Configure live grep to follow symlinks
                    grep_buffers = {
                        follow = true, -- Follow symlinks in buffer grep
                        ignored = true, -- Search in files even if they're in .gitignore
                    },
                    -- Configure explorer to follow symlinks
                    explorer = {
                        follow_file = true, -- Follow the file from the current buffer
                        ignored = true, -- Search in files even if they're in .gitignore
                    },
                },
            },
        },
    },
}
