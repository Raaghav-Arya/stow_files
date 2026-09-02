local M = {}

-- Re-register <tool>_N sessions with matching cwd in sidekick's config so they can be
-- reattached. After restart, discovered sessions have tool.name = "<tool>" (bare) because
-- only the default tool has is_proc. The original tool name is preserved in the tmux
-- session name (mux_session), format: "<tool_name> <sha256_prefix>".
function M.restore()
  local ok_state, State = pcall(require, "sidekick.cli.state")
  if not ok_state then
    return 0
  end

  local CLI_TOOL = vim.g.sidekick_cli_tool or "claude"
  local cwd = vim.fn.getcwd()
  local tools = State.get()

  local count = 0
  for _, tool_state in ipairs(tools) do
    if tool_state.session and tool_state.session.cwd == cwd then
      local mux = tool_state.session.mux_session
      local name = mux and mux:match("^(" .. CLI_TOOL .. "_%d+) ")
      if name then
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

  return count
end

return M
