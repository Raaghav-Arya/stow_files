return {
    {
        dir = vim.fn.stdpath("config") .. "/lua/comment-fold",
        name = "comment-fold",
        cmd = { "CommentFold", "CommentUnfold", "CommentFoldToggle" },
        keys = {
            {
                "zh",
                function()
                    require("comment-fold").toggle()
                end,
                desc = "Toggle comment folding",
            },
        },
        dependencies = {
            "nvim-treesitter/nvim-treesitter",
        },
        config = function()
            require("comment-fold").setup({
                merge_consecutive = true,     -- Merge adjacent comment lines
                include_blank_after = true,   -- Include trailing blank lines
            })
        end,
    },
}
