return {
    "Raaghav-Arya/no-comments-please.nvim",
    cmd = { "CommentFold", "CommentUnfold", "CommentFoldToggle" },
    keys = {
        {
            "zh",
            function()
                require("no-comments-please").toggle()
            end,
            desc = "Toggle comment folding",
        },
    },
    dependencies = {
        "nvim-treesitter/nvim-treesitter",
    },
    config = function()
        require("no-comments-please").setup({
            merge_consecutive = true, -- Merge adjacent comment lines
            include_blank_after = false, -- Include trailing blank lines (default: false)
        })
    end,
}
