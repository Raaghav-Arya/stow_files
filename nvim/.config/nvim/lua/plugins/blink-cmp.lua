-- Configure blink.cmp for better Copilot integration with tab cycling
return {
    {
        "saghen/blink.cmp",
        opts = {
            keymap = {
                preset = "default",
                ["<C-space>"] = { "show", "show_documentation", "hide_documentation" },
                ["<C-e>"] = { "hide" },
                ["<C-y>"] = { "select_and_accept" },
                ["<C-p>"] = { "select_prev", "fallback" },
                ["<C-n>"] = { "select_next", "fallback" },
                ["<C-b>"] = { "scroll_documentation_up", "fallback" },
                ["<C-f>"] = { "scroll_documentation_down", "fallback" },
                ["<CR>"] = { "accept", "fallback" },

                -- Tab cycling configuration for Copilot suggestions
                ["<Tab>"] = {
                    function(cmp)
                        -- If completion menu is open, select next item
                        if cmp.is_visible() then
                            return cmp.select_next()
                        -- If there's a snippet to jump to, do that
                        elseif cmp.snippet_active() then
                            return cmp.snippet_forward()
                        end
                        -- Otherwise, fallback to default tab behavior
                    end,
                    "fallback",
                },

                ["<S-Tab>"] = {
                    function(cmp)
                        -- If completion menu is open, select previous item
                        if cmp.is_visible() then
                            return cmp.select_prev()
                        -- If there's a snippet to jump back to, do that
                        elseif cmp.snippet_active() then
                            return cmp.snippet_backward()
                        else
                            return cmp.show()
                        end
                    end,
                    "fallback",
                },
            },

            -- Appearance configuration
            appearance = {
                use_nvim_cmp_as_default = true,
                nerd_font_variant = "mono",
            },

            -- Completion configuration
            completion = {
                -- Accept on tab when selecting
                accept = {
                    auto_brackets = {
                        enabled = true,
                    },
                },

                -- Show completions automatically
                trigger = {
                    show_on_insert_on_trigger_character = true,
                },

                -- Configure the completion menu
                menu = {
                    draw = {
                        columns = {
                            { "label", "label_description", gap = 1 },
                            { "kind_icon", "kind" },
                        },
                    },
                },

                -- Documentation window
                documentation = {
                    auto_show = true,
                    auto_show_delay_ms = 100,
                },
            },

            -- Signature help
            signature = {
                enabled = true,
            },

            -- Sources configuration - prioritize Copilot
            sources = {
                default = { "lsp", "path", "snippets", "buffer", "copilot" },
                providers = {
                    copilot = {
                        name = "copilot",
                        module = "blink-copilot",
                        score_offset = 100, -- Give Copilot suggestions higher priority
                        async = true,
                    },
                },
            },
        },
    },

    -- Ensure blink-copilot is configured
    {
        "fang2hou/blink-copilot",
        dependencies = { "zbirenbaum/copilot.lua" },
    },

    -- Configure copilot.lua for better integration
    {
        "zbirenbaum/copilot.lua",
        opts = {
            suggestion = {
                enabled = false, -- Disable inline suggestions since we're using blink.cmp
                auto_trigger = false,
            },
            panel = {
                enabled = false, -- Disable the panel since we're using blink.cmp
            },
        },
    },
}

