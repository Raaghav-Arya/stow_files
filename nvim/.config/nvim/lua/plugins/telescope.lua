return {
  "nvim-telescope/telescope.nvim",
  keys = {
    -- Add save file keybinding
    {
      "<leader>fs",
      function()
        -- Get the current buffer name
        local filename = vim.fn.expand("%")

        if filename == "" then
          -- If no filename, prompt for one
          vim.ui.input({ prompt = "Save as: " }, function(input)
            if input then
              vim.cmd("write " .. input)
              print("Saved as: " .. input)
            end
          end)
        else
          -- Save the current file
          vim.cmd("write")
          print("Saved: " .. filename)
        end
      end,
      desc = "Save File",
    },
  },
}

