-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here

vim.o.tabstop = 4 -- A TAB character looks like 4 spaces
vim.o.expandtab = true -- Pressing the TAB key will insert spaces instead of a TAB character
vim.o.softtabstop = 4 -- Number of spaces inserted instead of a TAB character
vim.o.shiftwidth = 4 -- Number of spaces inserted when indenting

vim.g.autoformat = false -- Sets autoformat to false

-- Enable system clipboard integration
vim.opt.clipboard = "unnamedplus" -- Use system clipboard for all yank/delete/paste operations
vim.diagnostic.enable(false)

vim.g.lazygit_use_custom_config_file_path = 1
vim.g.lazygit_config_file_path = "~/.config/lazygit/config.yml"
vim.o.swapfile = false -- Disable swapfile creation
