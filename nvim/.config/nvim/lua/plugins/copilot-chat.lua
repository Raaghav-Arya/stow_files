return {
    "CopilotC-Nvim/CopilotChat.nvim",
    optional = true,
    keys = {
      { "<leader>aa", false },
      { "<leader>ac", function() return require("CopilotChat").toggle() end, desc = "Toggle (CopilotChat)", mode = { "n", "v" } },
      { "<leader>ax", false },
      { "<leader>aq", false },
      { "<leader>ad", false },
      { "<leader>ap", false },
    }
}
