return {
    {
        "LunarVim/bigfile.nvim",
        opts = {
            filesize = 1,
            pattern = function(bufnr, filesize_mib)
                local filetype = vim.filetype.match({ buf = bufnr })
                return filetype == "c" and filesize_mib >= 1
            end,
        },
    },
}
