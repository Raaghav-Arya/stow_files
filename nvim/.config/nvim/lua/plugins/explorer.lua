return {
  "folke/snacks.nvim",
  opts = {
    picker = {
      sources = {
        explorer = {
          win = {
            list = {
              keys = {
                -- Prevent Esc from closing explorer immediately
                ["<Esc>"] = function() end,
              },
            },
          },
        },
      },
    },
  },
}
