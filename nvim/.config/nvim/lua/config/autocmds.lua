-- Autocmds are automatically loaded on the VeryLazy event
-- Default autocmds that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/autocmds.lua
--
-- Add any additional autocmds here
-- with `vim.api.nvim_create_autocmd`
--
-- Or remove existing autocmds by their group name (which is prefixed with `lazyvim_` for the defaults)
-- e.g. vim.api.nvim_del_augroup_by_name("lazyvim_wrap_spell")

-- Restore Claude terminal when session is restored
vim.api.nvim_create_autocmd("SessionLoadPost", {
  group = vim.api.nvim_create_augroup("restore_claude_terminal", { clear = true }),
  callback = function()
    -- Small delay to ensure session is fully loaded
    vim.defer_fn(function()
      local ok_state, State = pcall(require, "sidekick.cli.state")
      if not ok_state then
        return
      end

      -- Get current working directory
      local cwd = vim.fn.getcwd()

      -- Get all CLI tool states
      local tools = State.get()

      -- Look for a Claude session with matching working directory
      for _, tool_state in ipairs(tools) do
        if tool_state.tool.name == "claude" and tool_state.session and tool_state.session.cwd == cwd then
          -- Found a Claude session with matching cwd, attach to it using State.attach
          State.attach(tool_state, { show = true, focus = false })
          return
        end
      end

      -- No matching session found, don't open anything
    end, 100)
  end,
  desc = "Restore Claude terminal with matching cwd after session load",
})
