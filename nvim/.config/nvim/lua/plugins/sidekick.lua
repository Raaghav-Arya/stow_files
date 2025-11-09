return {
  {
    "folke/sidekick.nvim",
    event = "VeryLazy",
    opts = {
      -- Example configuration, adjust as needed
      ui = {
        border = "rounded",
      },
      -- Add your API key or endpoint if needed
      -- api_key = "your-claude-api-key",
      -- endpoint = "https://api.anthropic.com/v1/complete",
    },
    config = function(_, opts)
      require("sidekick").setup(opts)
    end,
  },
}
