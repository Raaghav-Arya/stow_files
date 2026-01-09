local M = {}

--- Create folds using hybrid foldexpr approach
---@param bufnr number
---@param ranges table[] Array of {start_line, end_line}
function M.create_folds(bufnr, ranges)
    local foldexpr_mod = require("comment-fold.foldexpr")
    foldexpr_mod.activate(bufnr, ranges)
end

--- Remove comment folds, restore original foldexpr
---@param bufnr number
function M.remove_folds(bufnr)
    local foldexpr_mod = require("comment-fold.foldexpr")
    foldexpr_mod.deactivate(bufnr)
end

return M
