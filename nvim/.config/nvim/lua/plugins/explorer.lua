return {
    "folke/snacks.nvim",
    opts = {
        picker = {
            exclude = {
                "**/pdk_09_00/**",
            },
            sources = {
                explorer = {
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
