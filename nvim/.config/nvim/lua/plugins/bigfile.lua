return {
    {
        "LunarVim/bigfile.nvim",
        opts = {
            -- bigfile.nvim ORs our pattern's result with `filesize >= filesize`
            -- (using its own MiB-rounded size), so a low filesize here would
            -- still false-trigger on its own regardless of what pattern returns.
            -- Set it unreachably high and let `pattern` be the sole detector,
            -- using an exact byte-size stat instead of the rounded MiB value.
            filesize = math.huge,
            pattern = function(bufnr, _)
                local name = vim.api.nvim_buf_get_name(bufnr)
                local stats = vim.loop.fs_stat(name)
                return stats ~= nil and stats.size >= 4 * 1024 * 1024
            end,
        },
    },
}
