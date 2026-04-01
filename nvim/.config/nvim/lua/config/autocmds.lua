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
      local ok_state, State = pcall(require, "sidekick.cli.state")
      if not ok_state then
        return
      end

      local CLI_TOOL = vim.g.sidekick_cli_tool or "gemini"
      local CLI_DISPLAY = CLI_TOOL:sub(1, 1):upper() .. CLI_TOOL:sub(2)

      -- Get current working directory
      local cwd = vim.fn.getcwd()

      -- Get all CLI tool states
      local tools = State.get()

      -- Look for <tool>_N sessions with matching cwd.
      -- After restart, discovered sessions have tool.name = "<tool>" (bare) because
      -- only the default tool has is_proc. The original tool name is preserved
      -- in the tmux session name (mux_session), format: "<tool_name> <sha256_prefix>".
      local count = 0
      for _, tool_state in ipairs(tools) do
        if tool_state.session and tool_state.session.cwd == cwd then
          local mux = tool_state.session.mux_session
          local name = mux and mux:match("^(" .. CLI_TOOL .. "_%d+) ")
          if name then
            -- Ensure the tool entry exists in config before attaching
            local cfg_tools = require("sidekick.config").cli.tools
            if not cfg_tools[name] then
              local f = vim.api.nvim_get_runtime_file("sk/cli/" .. CLI_TOOL .. ".lua", false)[1]
              local base = f and dofile(f) or {}
              cfg_tools[name] = { cmd = { CLI_TOOL }, format = base.format }
            end
            count = count + 1
          end
        end
      end
      if count > 0 then
        vim.notify("Restored " .. count .. " " .. CLI_DISPLAY .. " session(s)", vim.log.levels.INFO)
      end

      -- No matching session found, don't open anything
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
