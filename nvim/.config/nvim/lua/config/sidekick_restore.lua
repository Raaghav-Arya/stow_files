local M = {}

-- Re-register <tool>_N sessions with matching cwd in sidekick's config so they can be
-- reattached. After restart, discovered sessions have tool.name = "<tool>" (bare) because
-- only the base tools have is_proc. The original tool name is preserved in the tmux
-- session name (mux_session), format: "<tool_name> <sha256_prefix>".
function M.restore()
  local ok_state, State = pcall(require, "sidekick.cli.state")
  if not ok_state then
    return 0
  end

  local cwd = vim.fn.getcwd()
  local tools = State.get()
  local cfg_tools = require("sidekick.config").cli.tools
  local Tool = require("sidekick.cli.tool")
  local restored = {}

  local count = 0
  for _, tool_state in ipairs(tools) do
    if tool_state.session and tool_state.session.cwd == cwd then
      local mux = tool_state.session.mux_session
      local name = mux and mux:match("^([%w_-]+_%d+) ")
      local base_name = name and name:match("^(.-)_%d+$")
      if base_name and cfg_tools[base_name] and not restored[name] then
        if not cfg_tools[name] then
          local cfg = vim.deepcopy(Tool.get(base_name).config)
          -- Only base tools should participate in process discovery.
          cfg.is_proc = nil
          cfg_tools[name] = cfg
        end
        restored[name] = true
        count = count + 1
      end
    end
  end

  return count
end

return M
