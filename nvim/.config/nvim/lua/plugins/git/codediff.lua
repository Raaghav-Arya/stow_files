-- Open a file diff and delete the backing temp files once that diff tab closes
local function open_file_diff_and_cleanup(file1, file2, tmp_dir)
    vim.cmd("CodeDiff file " .. vim.fn.fnameescape(file1) .. " " .. vim.fn.fnameescape(file2))

    local tabpage = vim.api.nvim_get_current_tabpage()
    local group = vim.api.nvim_create_augroup("CodeDiffSelectionCleanup" .. tabpage, { clear = true })
    vim.api.nvim_create_autocmd("User", {
        group = group,
        pattern = "CodeDiffClose",
        callback = function(ev)
            if ev.data.tabpage == tabpage then
                vim.api.nvim_del_augroup_by_id(group)
                -- Defer: codediff's own close handling still touches these
                -- buffers after this event fires, so deleting them here
                -- would pull the rug out from under it.
                vim.schedule(function()
                    for _, file in ipairs({ file1, file2 }) do
                        local bufnr = vim.fn.bufnr(vim.fn.fnamemodify(file, ":p"))
                        if bufnr ~= -1 then
                            pcall(vim.api.nvim_buf_delete, bufnr, { force = true })
                        end
                    end
                    vim.fn.delete(tmp_dir, "rf")
                end)
            end
        end,
    })
end

-- Jump to the first/last changed hunk in the current file. codediff only
-- exposes relative next/prev hunk navigation, so this reimplements the
-- buffer/line-side detection from its own next_hunk/prev_hunk but jumps
-- straight to changes[1]/changes[#changes] instead of walking one at a time.
local function jump_to_hunk_edge(edge)
    local lifecycle = require("codediff.ui.lifecycle")
    local tabpage = vim.api.nvim_get_current_tabpage()
    local session = lifecycle.get_session(tabpage)
    if not session or not session.stored_diff_result then
        return
    end

    local changes = session.stored_diff_result.changes
    if not changes or #changes == 0 then
        return
    end

    local current_buf = vim.api.nvim_get_current_buf()
    local is_original = current_buf == session.original_bufnr
    local is_result = session.result_bufnr and current_buf == session.result_bufnr
    local is_diff_buf = is_original or current_buf == session.modified_bufnr

    if session.layout == "inline" or is_result then
        is_original = false
    elseif not is_diff_buf then
        is_original = false
        local target_win = session.modified_win
        if target_win and vim.api.nvim_win_is_valid(target_win) then
            vim.api.nvim_set_current_win(target_win)
        else
            return
        end
    end

    local index = edge == "first" and 1 or #changes
    local hunk = changes[index]
    local target_line = is_original and hunk.original.start_line or hunk.modified.start_line
    pcall(vim.api.nvim_win_set_cursor, 0, { target_line, 0 })
    vim.cmd("normal! zz")
    vim.api.nvim_echo({ { string.format("Hunk %d of %d", index, #changes), "None" } }, false, {})
end

return {
    "esmuellert/codediff.nvim",
    dependencies = { "MunifTanjim/nui.nvim" },
    cmd = "CodeDiff",
    keys = {
        { "<leader>gcc", "<cmd>CodeDiff<cr>", desc = "Open CodeDiff (working tree)" },
        { "<leader>gch", "<cmd>CodeDiff history<cr>", desc = "Open CodeDiff history (git log)" },
        {
            "<leader>gch",
            "<cmd>'<,'>CodeDiff history<cr>",
            mode = "v",
            desc = "Open CodeDiff history for selection (git log -L)",
        },
        { "<leader>gcf", "<cmd>CodeDiff history %<cr>", desc = "Open CodeDiff history for current file" },

        -- Compare two visual selections
        {
            "<leader>gv",
            function()
                -- Get the visual selection
                local mode = vim.fn.mode()
                if mode ~= "v" and mode ~= "V" and mode ~= "\22" then
                    vim.notify("Please select text in visual mode first", vim.log.levels.WARN)
                    return
                end

                -- Store first selection
                vim.cmd('normal! "ay')
                local first_selection = vim.fn.getreg("a")

                vim.notify("First text saved. Select second text and press <leader>gV", vim.log.levels.INFO)

                -- Store in global for second selection
                vim.g.codediff_first_selection = first_selection
            end,
            mode = "v",
            desc = "Diff: Save first selection",
        },
        {
            "<leader>gV",
            function()
                if not vim.g.codediff_first_selection then
                    vim.notify("Please save first selection with <leader>gv first", vim.log.levels.WARN)
                    return
                end

                -- Get second selection
                local mode = vim.fn.mode()
                if mode ~= "v" and mode ~= "V" and mode ~= "\22" then
                    vim.notify("Please select text in visual mode", vim.log.levels.WARN)
                    return
                end

                vim.cmd('normal! "by')
                local second_selection = vim.fn.getreg("b")

                -- Create temporary files
                local tmp_dir = vim.fn.tempname()
                vim.fn.mkdir(tmp_dir, "p")
                local file1 = tmp_dir .. "/selection1.txt"
                local file2 = tmp_dir .. "/selection2.txt"

                -- Write selections to temp files
                vim.fn.writefile(vim.split(vim.g.codediff_first_selection, "\n"), file1)
                vim.fn.writefile(vim.split(second_selection, "\n"), file2)

                -- Open in codediff
                open_file_diff_and_cleanup(file1, file2, tmp_dir)

                -- Clean up
                vim.g.codediff_first_selection = nil

                vim.notify("Comparing selections in CodeDiff", vim.log.levels.INFO)
            end,
            mode = "v",
            desc = "Diff: Compare with first selection",
        },

        -- Quick compare - simplified version (both selections in one go)
        {
            "<leader>gx",
            function()
                -- Use unnamed register (last yank/delete)
                local first = vim.fn.getreg('"')

                -- Get current visual selection
                local mode = vim.fn.mode()
                if mode ~= "v" and mode ~= "V" and mode ~= "\22" then
                    vim.notify("Select second text in visual mode", vim.log.levels.WARN)
                    return
                end

                vim.cmd('normal! "cy')
                local second = vim.fn.getreg("c")

                -- Create temporary files
                local tmp_dir = vim.fn.tempname()
                vim.fn.mkdir(tmp_dir, "p")
                local file1 = tmp_dir .. "/text1.txt"
                local file2 = tmp_dir .. "/text2.txt"

                vim.fn.writefile(vim.split(first, "\n"), file1)
                vim.fn.writefile(vim.split(second, "\n"), file2)

                -- Open in codediff
                open_file_diff_and_cleanup(file1, file2, tmp_dir)
            end,
            mode = "v",
            desc = "Diff: Compare with last yank",
        },
    },
    init = function()
        vim.api.nvim_create_autocmd("User", {
            pattern = "CodeDiffOpen",
            callback = function(ev)
                require("codediff.ui.view.compact").enable(ev.data.tabpage)

                local tabpage = ev.data.tabpage
                local lifecycle = require("codediff.ui.lifecycle")

                -- Plugin only registers toggle_explorer in explorer mode, so
                -- <leader>e is free here; reuse it to toggle history panel
                -- visibility (history panel shares the "explorer" slot).
                if ev.data.mode == "history" then
                    local history_obj = lifecycle.get_explorer(tabpage)
                    if history_obj then
                        lifecycle.set_tab_keymap(tabpage, "n", "<leader>e", function()
                            require("codediff.ui.history").toggle_visibility(history_obj)
                        end, { desc = "Toggle history panel visibility" })
                    end
                end

                -- First/last hunk jumps (codediff only ships relative ]h/[h)
                lifecycle.set_tab_keymap(tabpage, "n", "[H", function()
                    jump_to_hunk_edge("first")
                end, { desc = "Jump to first hunk" })
                lifecycle.set_tab_keymap(tabpage, "n", "]H", function()
                    jump_to_hunk_edge("last")
                end, { desc = "Jump to last hunk" })
            end,
        })

        -- Alias l -> <CR> in the explorer and history panels (select's lhs is
        -- a single string in codediff's config, so it can't be set to both
        -- keys at once)
        vim.api.nvim_create_autocmd("FileType", {
            pattern = { "codediff-explorer", "codediff-history" },
            callback = function(ev)
                vim.keymap.set("n", "l", "<CR>", { buffer = ev.buf, remap = true })
            end,
        })
    end,
    opts = {
        keymaps = {
            view = {
                toggle_explorer = "<leader>e",
                focus_explorer = "<leader>b",
                next_hunk = "]h",
                prev_hunk = "[h",
            },
        },
    },
}
