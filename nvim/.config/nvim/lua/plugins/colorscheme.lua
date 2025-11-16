return {
    {
        "catppuccin/nvim",
        name = "catppuccin",
        lazy = false,
    },
    { "dasupradyumna/midnight.nvim", lazy = false, priority = 1000 },
    {
        "LazyVim/LazyVim",
        opts = {
            -- colorscheme = "midnight",
            colorscheme = "catppuccin-mocha", -- or catppuccin-latte, catppuccin-frappe, catppuccin-macchiato
        },
    },
}
