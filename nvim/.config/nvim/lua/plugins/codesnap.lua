return {
    "mistricky/codesnap.nvim",
    build = "make build_generator",
    opts = {
        has_breadcrumbs = true,
        has_line_numbers = true,
        watermark = "",
    },
    keys = {
        { "<leader>cs", "<cmd>CodeSnap<cr>", mode = "x", desc = "Save selected code snapshot into clipboard" },
    },
}
