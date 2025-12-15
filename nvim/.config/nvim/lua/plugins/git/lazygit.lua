-- Lazygit: Terminal UI for git commands
return {
    "kdheepak/lazygit.nvim",
    init = function()
        -- Use custom config file path
        vim.g.lazygit_use_custom_config_file_path = 1
        vim.g.lazygit_config_file_path = "~/.config/lazygit/config.yml"
    end,
}
