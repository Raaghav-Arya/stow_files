return {
  {
    "CopilotC-Nvim/CopilotChat.nvim",
    keys = {
      { "<leader>aa", false }, -- disabled: sidekick uses this for session picker
      { "<leader>ap", false }, -- disabled: sidekick uses this for send clipboard
      { "<leader>aq", false }, -- disabled: sidekick prefix
      { "<leader>ax", false }, -- disabled: sidekick uses this for close active session
      {
        "<leader>ac",
        function()
          return require("CopilotChat").toggle()
        end,
        desc = "Toggle (CopilotChat)",
        mode = { "n", "x" },
      },
    },
  },
}
