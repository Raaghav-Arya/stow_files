return {
    -- Disable snacks.nvim terminal feature
    {
        "folke/snacks.nvim",
        opts = {
            terminal = { enabled = false },
        },
    },

    -- Configure toggleterm.nvim for VSCode-like terminal behavior
    {
        "akinsho/toggleterm.nvim",
        cmd = "ToggleTerm",
        keys = {
            -- Toggle terminal: show/hide terminal, or create if none exists
            { "<M-/>", "<cmd>ToggleTerm<cr>", desc = "Toggle Terminal", mode = { "n", "t", "i" } },

            -- End current terminal: completely shutdown and remove the current terminal
            {
                "<M-q>",
                function()
                    local _, term = require("toggleterm.terminal").identify()
                    if term then
                        term:shutdown()
                    end
                end,
                desc = "End Current Terminal",
                mode = { "n", "t", "i", "v" },
            },

            -- New terminal: close any visible terminal and create a new one with next available ID
            {
                "<M-t>",
                function()
                    local terms = require("toggleterm.terminal")
                    local ui = require("toggleterm.ui")

                    -- Close all open terminals to maintain single terminal view
                    local has_open, windows = ui.find_open_windows()
                    if has_open then
                        ui.close_and_save_terminal_view(windows)
                    end

                    -- Create and open new terminal with next available ID
                    vim.cmd(terms.next_id() .. "ToggleTerm direction=horizontal")

                    -- Enter terminal mode after opening (defer to ensure terminal is ready)
                    vim.schedule(function()
                        vim.cmd("startinsert")
                    end)
                end,
                desc = "New Terminal",
                mode = { "n", "t", "i", "v" },
            },

            -- Terminal picker: select from existing terminals by their working directory
            {
                "<M-s>",
                function()
                    local terms = require("toggleterm.terminal")
                    local terminals = terms.get_all(true)

                    if #terminals == 0 then
                        vim.notify("No terminals are open yet", vim.log.levels.INFO)
                        return
                    end

                    vim.ui.select(terminals, {
                        prompt = "Select terminal: ",
                        format_item = function(term)
                            -- Try to get terminal's current working directory from buffer title
                            local dir
                            if term.bufnr and vim.api.nvim_buf_is_valid(term.bufnr) then
                                dir = vim.b[term.bufnr].term_title
                                if dir then
                                    -- Extract the last part (usually the directory path)
                                    dir = dir:match("(%S+)$") or dir
                                end
                            end

                            -- Fallback to initial directory or nvim's cwd
                            dir = dir or term.dir or vim.fn.getcwd()

                            -- Replace home directory with ~ for cleaner display
                            local home = vim.env.HOME
                            if home and dir:sub(1, #home) == home then
                                dir = "~" .. dir:sub(#home + 1)
                            end

                            return dir
                        end,
                    }, function(term)
                        if not term then
                            return
                        end

                        -- Close current terminal and open selected one (VSCode-like behavior)
                        local _, current = terms.identify()
                        if current then
                            current:close()
                        end

                        vim.cmd(term.id .. "ToggleTerm")

                        -- Enter terminal mode after opening (defer to ensure terminal is ready)
                        vim.schedule(function()
                            vim.cmd("startinsert")
                        end)
                    end)
                end,
                desc = "Terminal Picker",
                mode = { "n", "t" },
            },

            -- Next terminal: cycle to the next terminal in the list
            {
                "<M-l>",
                function()
                    local terms = require("toggleterm.terminal")
                    local all_terms = terms.get_all(true)
                    if #all_terms == 0 then
                        return
                    end

                    local _, current = terms.identify()
                    local current_id = current and current.id or 0

                    -- Close current terminal to maintain single view
                    if current then
                        current:close()
                    end

                    -- Find next terminal with ID greater than current
                    local next_id
                    for _, term in ipairs(all_terms) do
                        if term.id > current_id then
                            next_id = term.id
                            break
                        end
                    end

                    -- Wrap around to first terminal if at the end
                    next_id = next_id or all_terms[1].id

                    if next_id then
                        vim.cmd(next_id .. "ToggleTerm")
                    end
                end,
                desc = "Next Terminal",
                mode = { "t" },
            },

            -- Previous terminal: cycle to the previous terminal in the list
            {
                "<M-h>",
                function()
                    local terms = require("toggleterm.terminal")
                    local all_terms = terms.get_all(true)
                    if #all_terms == 0 then
                        return
                    end

                    local _, current = terms.identify()
                    local current_id = current and current.id or math.huge

                    -- Close current terminal to maintain single view
                    if current then
                        current:close()
                    end

                    -- Find previous terminal with ID less than current
                    local prev_id
                    for i = #all_terms, 1, -1 do
                        if all_terms[i].id < current_id then
                            prev_id = all_terms[i].id
                            break
                        end
                    end

                    -- Wrap around to last terminal if at the beginning
                    prev_id = prev_id or all_terms[#all_terms].id

                    if prev_id then
                        vim.cmd(prev_id .. "ToggleTerm")
                    end
                end,
                desc = "Previous Terminal",
                mode = { "t" },
            },
        },
        opts = {
            direction = "horizontal",
            size = function(term)
                -- Terminal takes 40% of screen height when horizontal
                if term.direction == "horizontal" then
                    return vim.o.lines * 0.4
                elseif term.direction == "vertical" then
                    return vim.o.columns * 0.4
                end
            end,
            hide_numbers = true,
            shade_terminals = true,
            start_in_insert = true,
            insert_mappings = false,
            terminal_mappings = true,
            persist_size = true,
            persist_mode = true,
            close_on_exit = true,
            shell = vim.o.shell,
            on_open = function(term)
                -- Move horizontal terminals to bottom and make them full width (VSCode-like)
                if term.direction == "horizontal" then
                    vim.cmd("wincmd J")
                end
            end,
        },
    },
}

