-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua

local opts = { noremap = true, silent = true }

-- Center cursor when scrolling
vim.keymap.set("n", "<C-d>", "<C-d>zz", opts)
vim.keymap.set("n", "<C-u>", "<C-u>zz", opts)
vim.keymap.set("n", "<C-f>", "<C-f>zz", opts)
vim.keymap.set("n", "<C-b>", "<C-b>zz", opts)

-- Resize windows with Alt + h/j/k/l
vim.keymap.set("n", "<A-h>", "<cmd>vertical resize -2<CR>", { noremap = true, silent = true, desc = "Resize window left" })
vim.keymap.set("n", "<A-l>", "<cmd>vertical resize +2<CR>", { noremap = true, silent = true, desc = "Resize window right" })
vim.keymap.set("n", "<A-k>", "<cmd>resize +2<CR>", { noremap = true, silent = true, desc = "Resize window up" })
vim.keymap.set("n", "<A-j>", "<cmd>resize -2<CR>", { noremap = true, silent = true, desc = "Resize window down" })

-- Delete without yanking (don't lose clipboard)
vim.keymap.set({ "n", "v" }, "d", '"_d', { noremap = true, desc = "Delete without yanking" })
vim.keymap.set({ "n", "v" }, "D", '"_D', { noremap = true, desc = "Delete to end without yanking" })
vim.keymap.set({ "n", "v" }, "c", '"_c', { noremap = true, desc = "Change without yanking" })
vim.keymap.set({ "n", "v" }, "C", '"_C', { noremap = true, desc = "Change to end without yanking" })
vim.keymap.set("n", "x", '"_x', { noremap = true, desc = "Delete char without yanking" })
vim.keymap.set("n", "X", '"_X', { noremap = true, desc = "Delete char before cursor without yanking" })

-- Cut operations in normal mode: y + operator = cut (yank and delete/change)
vim.keymap.set("n", "yd", '"+d', { noremap = true, desc = "Cut (yank and delete)" })
vim.keymap.set("n", "yD", '"+D', { noremap = true, desc = "Cut to end of line" })
vim.keymap.set("n", "yc", '"+c', { noremap = true, desc = "Cut and change" })
vim.keymap.set("n", "yC", '"+C', { noremap = true, desc = "Cut to end and change" })
vim.keymap.set("n", "yx", '"+x', { noremap = true, desc = "Cut character to clipboard" })
vim.keymap.set("n", "yX", '"+X', { noremap = true, desc = "Cut character before cursor to clipboard" })

-- Cut in visual mode: just use 'x' (simpler)
vim.keymap.set("v", "x", '"+d', { noremap = true, desc = "Cut selection to clipboard" })
