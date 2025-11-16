return {
    "ahmedkhalf/project.nvim",
    dependencies = {
        "nvim-telescope/telescope.nvim",
    },
    event = "VeryLazy",
    opts = {
        -- Detection methods for project root
        detection_methods = { "pattern", "lsp" },
        -- Patterns to identify project root
        patterns = { ".git", "Makefile", "package.json", "CMakeLists.txt", "Cargo.toml" },
        -- Don't show hidden files in telescope
        show_hidden = false,
        -- Automatically cd to project root
        silent_chdir = true,
    },
    config = function(_, opts)
        require("project_nvim").setup(opts)
        -- Load telescope extension
        require("telescope").load_extension("projects")
    end,
    keys = {
        { "<leader>fp", "<cmd>Telescope projects<cr>", desc = "Projects" },
    },
}
