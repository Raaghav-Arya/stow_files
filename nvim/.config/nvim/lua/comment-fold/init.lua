local M = {}

M._state = {} -- Per-buffer state: { [bufnr] = { folded = bool, fold_ids = {} } }

local defaults = {
    merge_consecutive = true,
    include_blank_after = false,
}

M._config = defaults

function M.setup(opts)
    M._config = vim.tbl_deep_extend("force", defaults, opts or {})

    -- Create user commands
    vim.api.nvim_create_user_command("CommentFold", function()
        M.fold()
    end, { desc = "Fold all comments in buffer" })

    vim.api.nvim_create_user_command("CommentUnfold", function()
        M.unfold()
    end, { desc = "Unfold all comments in buffer" })

    vim.api.nvim_create_user_command("CommentFoldToggle", function()
        M.toggle()
    end, { desc = "Toggle comment folding" })

    -- Restore original foldexpr before persistence.nvim saves session
    vim.api.nvim_create_autocmd("User", {
        pattern = "PersistenceSavePre",
        group = vim.api.nvim_create_augroup("CommentFoldCleanup", { clear = true }),
        callback = function()
            local foldexpr_mod = require("comment-fold.foldexpr")
            -- Iterate through all windows to restore foldexpr (it's window-local)
            for _, winid in ipairs(vim.api.nvim_list_wins()) do
                local bufnr = vim.api.nvim_win_get_buf(winid)
                local state = M._state[bufnr]
                if state and state.folded and vim.api.nvim_buf_is_valid(bufnr) then
                    -- Execute deactivate in the window's context
                    vim.api.nvim_win_call(winid, function()
                        foldexpr_mod.deactivate(bufnr)
                    end)
                end
            end
        end,
    })
end

function M.fold()
    local bufnr = vim.api.nvim_get_current_buf()
    local treesitter = require("comment-fold.treesitter")
    local fold_mod = require("comment-fold.fold")

    -- Check for treesitter parser
    local ok, err = treesitter.has_parser(bufnr)
    if not ok then
        vim.notify("CommentFold: " .. err, vim.log.levels.WARN)
        return
    end

    -- Get comment ranges
    local ranges = treesitter.get_comment_ranges(bufnr, M._config)
    if #ranges == 0 then
        vim.notify("CommentFold: No comments found", vim.log.levels.INFO)
        return
    end

    -- Create folds
    fold_mod.create_folds(bufnr, ranges)

    -- Track state
    M._state[bufnr] = M._state[bufnr] or {}
    M._state[bufnr].folded = true

    vim.notify("CommentFold: Folded " .. #ranges .. " comment block(s)", vim.log.levels.INFO)
end

function M.unfold()
    local bufnr = vim.api.nvim_get_current_buf()
    local fold_mod = require("comment-fold.fold")

    fold_mod.remove_folds(bufnr)

    if M._state[bufnr] then
        M._state[bufnr].folded = false
    end

    vim.notify("CommentFold: Unfolded all comments", vim.log.levels.INFO)
end

function M.toggle()
    local bufnr = vim.api.nvim_get_current_buf()
    local state = M._state[bufnr]

    if state and state.folded then
        M.unfold()
    else
        M.fold()
    end
end

function M.is_folded(bufnr)
    bufnr = bufnr or vim.api.nvim_get_current_buf()
    return M._state[bufnr] and M._state[bufnr].folded or false
end

return M
