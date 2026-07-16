return {
    "esmuellert/codediff.nvim",
    dependencies = { "MunifTanjim/nui.nvim" },
    cmd = "CodeDiff",
    keys = {
        { "<leader>gc", "<cmd>CodeDiff<cr>", desc = "Open CodeDiff" },

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
                vim.cmd("CodeDiff file " .. vim.fn.fnameescape(file1) .. " " .. vim.fn.fnameescape(file2))

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
                vim.cmd("CodeDiff file " .. vim.fn.fnameescape(file1) .. " " .. vim.fn.fnameescape(file2))
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
