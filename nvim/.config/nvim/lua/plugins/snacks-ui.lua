-- Disable smooth scrolling from Snacks.nvim
return {
    {
        "folke/snacks.nvim",
        opts = {
            scroll = {
                enabled = false, -- Disable smooth scrolling
            },
            diagnostics = {
                enabled = false, -- Disable diagnostics
            },
        },
    },
}
