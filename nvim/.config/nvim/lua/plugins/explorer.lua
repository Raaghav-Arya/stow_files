return {
    "folke/snacks.nvim",
    opts = {
        picker = {
            sources = {
                explorer = {
                    -- Use sidebar preset instead of full layout definition
                    layout = { preset = "sidebar", preview = false },
                    win = {
                        list = {
                            keys = {
                                -- Prevent Esc from closing explorer immediately
                                ["<Esc>"] = function() end,
                            },
                        },
                    },
                },
            },
        },
    },
}
