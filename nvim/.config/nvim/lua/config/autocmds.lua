-- Autocmds are automatically loaded on the VeryLazy event
-- Default autocmds that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/autocmds.lua
--
-- Add any additional autocmds here
-- with `vim.api.nvim_create_autocmd`
--
-- Or remove existing autocmds by their group name (which is prefixed with `lazyvim_` for the defaults)
-- e.g. vim.api.nvim_del_augroup_by_name("lazyvim_wrap_spell")

-- Restore sidekick CLI terminal when session is restored
vim.api.nvim_create_autocmd("SessionLoadPost", {
  group = vim.api.nvim_create_augroup("restore_sidekick_terminal", { clear = true }),
  callback = function()
    -- Small delay to ensure session is fully loaded
    vim.defer_fn(function()
      local CLI_TOOL = vim.g.sidekick_cli_tool or "claude"
      local CLI_DISPLAY = CLI_TOOL:sub(1, 1):upper() .. CLI_TOOL:sub(2)
      local count = require("config.sidekick_restore").restore()
      if count > 0 then
        vim.notify("Restored " .. count .. " " .. CLI_DISPLAY .. " session(s)", vim.log.levels.INFO)
      end
    end, 100)
  end,
  desc = "Restore sidekick CLI terminal with matching cwd after session load",
})

-- Disable wrap for markdown files (override LazyVim default)
-- vim.api.nvim_create_autocmd("FileType", {
--   group = vim.api.nvim_create_augroup("disable_markdown_wrap", { clear = true }),
--   pattern = "markdown",
--   callback = function()
--     vim.opt_local.wrap = false
--   end,
-- })
