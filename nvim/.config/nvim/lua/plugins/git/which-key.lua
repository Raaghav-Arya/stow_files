-- Which-key: Add <leader>h group for hunk operations
return {
    "folke/which-key.nvim",
    opts = {
        spec = {
            { "<leader>h", group = "hunks" },
        },
    },
}
