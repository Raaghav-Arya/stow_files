-- Gitsigns: Git status in signcolumn with hunk operations
-- Override LazyVim's default gitsigns keybindings (change prefix from <leader>gh* to <leader>h*)
return {
    "lewis6991/gitsigns.nvim",
    init = function()
        -- Delete LazyVim's default <leader>gh* keybindings for gitsigns
        local del_keys = {
            { "n", "<leader>ghs" },
            { "x", "<leader>ghs" },
            { "n", "<leader>ghr" },
            { "x", "<leader>ghr" },
            { "n", "<leader>ghS" },
            { "n", "<leader>ghu" },
            { "n", "<leader>ghR" },
            { "n", "<leader>ghp" },
            { "n", "<leader>ghb" },
            { "n", "<leader>ghB" },
            { "n", "<leader>ghd" },
            { "n", "<leader>ghD" },
        }
        for _, key in ipairs(del_keys) do
            pcall(vim.keymap.del, key[1], key[2])
        end
    end,
    keys = {
        -- Hunk operations: Changed from <leader>gh* to <leader>h*
        { "<leader>hs", ":Gitsigns stage_hunk<CR>", mode = { "n", "x" }, desc = "Stage Hunk" },
        { "<leader>hr", ":Gitsigns reset_hunk<CR>", mode = { "n", "x" }, desc = "Reset Hunk" },
        {
            "<leader>hS",
            function()
                require("gitsigns").stage_buffer()
            end,
            desc = "Stage Buffer",
        },
        {
            "<leader>hu",
            function()
                require("gitsigns").undo_stage_hunk()
            end,
            desc = "Undo Stage Hunk",
        },
        {
            "<leader>hR",
            function()
                require("gitsigns").reset_buffer()
            end,
            desc = "Reset Buffer",
        },
        {
            "<leader>hp",
            function()
                require("gitsigns").preview_hunk_inline()
            end,
            desc = "Preview Hunk Inline",
        },
        {
            "<leader>hb",
            function()
                require("gitsigns").blame_line({ full = true })
            end,
            desc = "Blame Line",
        },
        {
            "<leader>hB",
            function()
                require("gitsigns").blame()
            end,
            desc = "Blame Buffer",
        },
        {
            "<leader>hd",
            function()
                require("gitsigns").diffthis()
            end,
            desc = "Diff This",
        },
        {
            "<leader>hD",
            function()
                require("gitsigns").diffthis("~")
            end,
            desc = "Diff This ~",
        },
        { "ih", ":<C-U>Gitsigns select_hunk<CR>", mode = { "o", "x" }, desc = "GitSigns Select Hunk" },
    },
}
