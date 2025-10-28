return {
  "akinsho/toggleterm.nvim",
  version = "*",
  opts = {
    size = 15,
    open_mapping = [[<c-/>]],
    shade_terminals = true,
    direction = "horizontal",
    persist_size = true,
    terminal_mappings = false, -- Disable default terminal mappings
  },
  keys = {
    { "<leader>t", desc = "terminal", icon = "" },
    {
      "<leader>tn",
      function()
        local is_term = vim.bo.buftype == "terminal"
        local term = require("toggleterm.terminal").Terminal:new()
        if is_term then
          vim.cmd("hide")
        end
        term:open()
      end,
      desc = "New terminal",
    },
    { "<leader>ts", "<cmd>TermSelect<cr>", desc = "Select terminal" },
    {
      "<leader>tv",
      function()
        vim.cmd("vsplit")
        require("toggleterm.terminal").Terminal:new():open()
      end,
      desc = "Split terminal vertically",
    },
    {
      "<leader>tq",
      function()
        local term_id = require("toggleterm.terminal").get_focused_id()
        if term_id then
          require("toggleterm.terminal").get(term_id):shutdown()
        else
          vim.notify("No terminal found", vim.log.levels.WARN)
        end
      end,
      desc = "Kill terminal",
    },
  },
  config = function(_, opts)
    require("toggleterm").setup(opts)
    
    vim.keymap.set("t", "<Esc><Esc>", [[<C-\><C-n>]], { desc = "Exit terminal mode" })
    
    vim.api.nvim_create_autocmd("TermOpen", {
      pattern = "term://*",
      callback = function()
        local buf = vim.api.nvim_get_current_buf()
        
        -- For toggleterm terminals
        if vim.bo[buf].filetype == "toggleterm" then
          vim.keymap.set("n", "q", function()
            local term_id = require("toggleterm.terminal").get_focused_id()
            if term_id then
              vim.cmd(term_id .. "ToggleTerm")
            end
          end, { buffer = buf, silent = true, desc = "Hide terminal" })
        end
        
        -- Allow C-l to pass through to clear terminal - set with higher priority
        vim.keymap.set("t", "<C-l>", "<C-l>", { buffer = buf, nowait = true })
      end,
    })
  end,
}
