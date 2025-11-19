return {
    {
        "catppuccin/nvim",
        name = "catppuccin",
        lazy = false,
    },
    { "dasupradyumna/midnight.nvim", lazy = false, priority = 1000 },
    { "rebelot/kanagawa.nvim", lazy = false, background = { dark = "dragon" } },
    { "tiagovla/tokyodark.nvim", lazy = false },
    {
        "LazyVim/LazyVim",
        opts = {
            -- colorscheme = "midnight",
            colorscheme = "catppuccin-mocha", -- or catppuccin-latte, catppuccin-frappe, catppuccin-macchiato
            -- colorscheme = "kanagawa", -- or catppuccin-latte, catppuccin-frappe, catppuccin-macchiato
            -- colorscheme = "tokyodark", -- or catppuccin-latte, catppuccin-frappe, catppuccin-macchiato
        },
    },
}
