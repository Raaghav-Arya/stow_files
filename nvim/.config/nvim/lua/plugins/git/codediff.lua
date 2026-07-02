return {
    "esmuellert/codediff.nvim",
    dependencies = { "MunifTanjim/nui.nvim" },
    cmd = "CodeDiff",
    keys = {
        { "<leader>gc", "<cmd>CodeDiff<cr>", desc = "Open CodeDiff" },
    },
    init = function()
        vim.api.nvim_create_autocmd("User", {
            pattern = "CodeDiffOpen",
            callback = function(ev)
                require("codediff.ui.view.compact").enable(ev.data.tabpage)
            end,
        })
    end,
    opts = {
        keymaps = {
            view = {
                toggle_explorer = "<leader>e",
                focus_explorer = "<leader>b",
            },
        },
    },
}
