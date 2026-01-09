local M = {}

M._comment_ranges = {} -- { [bufnr] = { {start, end}, ... } }
M._original_foldexpr = {} -- { [bufnr] = "original_expr" }

--- Check if a line is within any comment range
---@param bufnr number
---@param lnum number
---@return boolean, number? -- is_comment, fold_level
local function is_in_comment_range(bufnr, lnum)
    local ranges = M._comment_ranges[bufnr]
    if not ranges then
        return false, nil
    end

    for _, range in ipairs(ranges) do
        if lnum >= range[1] and lnum <= range[2] then
            -- Return fold level based on position in range
            if lnum == range[1] then
                return true, ">1" -- Start of fold
            elseif lnum == range[2] then
                return true, "<1" -- End of fold
            else
                return true, "1" -- Inside fold
            end
        end
    end

    return false, nil
end

--- Custom foldexpr that combines LSP folds with comment folds
---@return string
function M.hybrid_foldexpr()
    local bufnr = vim.api.nvim_get_current_buf()
    local lnum = vim.v.lnum

    -- Check if this line is in a comment range we're folding
    local in_comment, comment_level = is_in_comment_range(bufnr, lnum)
    if in_comment then
        return comment_level
    end

    -- Otherwise, delegate to original foldexpr (LSP)
    local original = M._original_foldexpr[bufnr]
    if original and original ~= "" then
        -- Directly call LSP foldexpr if that's what the original was
        if original:match("vim%.lsp%.foldexpr") or original:match("vim.lsp.foldexpr") then
            local result = vim.lsp.foldexpr()
            return tostring(result)
        end
        -- Fallback to eval for other foldexprs
        local ok, result = pcall(vim.fn.eval, original)
        if ok then
            return tostring(result)
        end
    end

    -- Fallback to no fold
    return "0"
end

--- Activate hybrid folding with comment ranges
---@param bufnr number
---@param ranges table[]
function M.activate(bufnr, ranges)
    -- Save comment ranges
    M._comment_ranges[bufnr] = ranges

    local current_foldexpr = vim.wo.foldexpr

    -- Save original foldexpr if not already saved
    -- Don't save if it's already our hybrid foldexpr
    if not M._original_foldexpr[bufnr] then
        if not current_foldexpr:match("comment%-fold") then
            M._original_foldexpr[bufnr] = current_foldexpr
        end
    end

    -- Set our hybrid foldexpr
    vim.wo.foldmethod = "expr"
    vim.wo.foldexpr = "v:lua.require'comment-fold.foldexpr'.hybrid_foldexpr()"

    -- Recompute folds
    vim.cmd("normal! zx")

    -- Now explicitly close each comment fold
    local current_pos = vim.api.nvim_win_get_cursor(0)
    for _, range in ipairs(ranges) do
        vim.api.nvim_win_set_cursor(0, { range[1], 0 })
        pcall(vim.cmd, "normal! zc")
    end
    vim.api.nvim_win_set_cursor(0, current_pos)
end

--- Deactivate hybrid folding, restore original
---@param bufnr number
function M.deactivate(bufnr)
    -- Clear comment ranges
    M._comment_ranges[bufnr] = nil

    -- Restore original foldexpr
    local original = M._original_foldexpr[bufnr]
    if original then
        vim.wo.foldexpr = original
        M._original_foldexpr[bufnr] = nil
    end

    -- Recompute folds
    vim.cmd("normal! zx")
end

return M
