return {
  {
    "folke/sidekick.nvim",
    event = "VeryLazy",
    keys = {
      {
        "<leader>as",
        function()
          require("sidekick.cli").toggle({ name = "claude", focus = true })
        end,
        desc = "Toggle Claude (Sidekick)",
        mode = { "n", "x" },
      },
      {
        "<leader>ad",
        function()
          require("sidekick.cli").close()
        end,
        desc = "Detach CLI Session",
      },
      {
        "<leader>af",
        function()
          require("sidekick.cli").send({ msg = "{file}" })
        end,
        desc = "Send Current File to AI",
      },
      {
        "<leader>at",
        function()
          require("sidekick.cli").send({ msg = "{this}" })
        end,
        mode = { "x", "n" },
        desc = "Send This (context) to AI",
      },
      {
        "<leader>av",
        function()
          require("sidekick.cli").send({ msg = "{selection}" })
        end,
        mode = { "x" },
        desc = "Send Visual Selection to AI",
      },
      {
        "<leader>ay",
        function()
          -- Copy current selection to system clipboard, then send to AI
          vim.cmd('normal! "+y')
          require("sidekick.cli").send({ msg = "{selection}" })
        end,
        mode = { "x" },
        desc = "Copy to Clipboard + Send to AI",
      },
      {
        "<leader>ap",
        function()
          -- Send clipboard contents to AI
          local clipboard = vim.fn.getreg("+")
          if clipboard and clipboard ~= "" then
            require("sidekick.cli").send({ msg = clipboard })
          else
            vim.notify("Clipboard is empty", vim.log.levels.WARN)
          end
        end,
        mode = { "n" },
        desc = "Send Clipboard to AI",
      },
      {
        "<Tab>",
        function()
          -- if there is a next edit, jump to it, otherwise apply it if any
          if not require("sidekick").nes_jump_or_apply() then
            return "<Tab>" -- fallback to normal tab
          end
        end,
        expr = true,
        desc = "Goto/Apply Next Edit Suggestion",
      },
    },
    opts = {
      -- CLI configuration for AI tools
      cli = {
        mux = {
          backend = "tmux", -- Using tmux as requested
          enabled = true,
        },
      },
      -- UI configuration
      ui = {
        border = "rounded",
      },
    },
    -- Override the vim.ui.select configuration for sidekick_cli picker
    dependencies = {
      {
        "folke/snacks.nvim",
        opts = function(_, opts)
          opts.picker = opts.picker or {}
          opts.picker.ui_select = opts.picker.ui_select or {}
          opts.picker.ui_select.sidekick_cli = {
            mappings = {
              d = {
                mode = "n",
                action = function(picker)
                  local item = picker:current()
                  if item and item.session then
                    -- Send exit command to the selected session
                    local cli = require("sidekick.cli")

                    -- First close the picker
                    picker:close()

                    -- Send exit to the specific session
                    vim.schedule(function()
                      cli.send({
                        msg = "exit",
                        filter = { session = item.session.id }
                      })
                      vim.notify("Deleting session: " .. item.tool.name, vim.log.levels.INFO)
                    end)
                  else
                    vim.notify("No active session to delete", vim.log.levels.WARN)
                  end
                end,
                desc = "Delete session",
              },
            },
          }
          return opts
        end,
      },
    },
    config = function(_, opts)
      require("sidekick").setup(opts)
    end,
  },
}
