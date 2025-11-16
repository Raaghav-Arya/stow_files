return {
  {
    "yetone/avante.nvim",
    enabled = false,
    event = "VeryLazy",
    lazy = false,
    version = false, -- set to "*" to use latest stable version
    opts = {
      -- Provider configuration
      provider = "claude", -- Default provider (can be "copilot", "claude", "openai", "azure", "gemini", "cohere", etc.)
      auto_suggestions_provider = nil, -- Auto-suggestions provider (set to nil to use same as provider)

      -- Instructions file for project-specific context
      instructions_file = "avante.md",

      -- Claude provider configuration via ACP (Anthropic Claude Provider)
      acp_providers = {
        ["claude-code"] = {
          command = "npx",
          args = { "-y", "@zed-industries/claude-code-acp" },
          env = {
            NODE_NO_WARNINGS = "1",
            ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY"),
            ANTHROPIC_BASE_URL = os.getenv("ANTHROPIC_BASE_URL"),
            ACP_PATH_TO_CLAUDE_CODE_EXECUTABLE = vim.fn.exepath("claude"),
            ACP_PERMISSION_MODE = "bypassPermissions",
          },
        },
      },

      -- Provider configurations
      providers = {
        -- Claude provider configuration
        claude = {
          endpoint = "https://api.anthropic.com",
          model = "claude-sonnet-4-5-20250929", -- Latest Claude 3.5 Sonnet
          timeout = 30000, -- Timeout in milliseconds
          context_window = 200000,
          extra_request_body = {
            temperature = 0.75,
            max_tokens = 64000,
          },
        },

        -- Copilot provider configuration
        copilot = {
          endpoint = "https://api.githubcopilot.com",
          model = "gpt-4o-2024-11-20", -- Latest model
          proxy = nil, -- [protocol://]host[:port] Use this proxy
          allow_insecure = false, -- Allow insecure server connections
          timeout = 30000, -- Timeout in milliseconds
          context_window = 64000,
          extra_request_body = {
            max_tokens = 20480,
          },
        },
      },

      -- Behavior configuration
      behaviour = {
        auto_focus_sidebar = true,
        auto_suggestions = false, -- Experimental: auto-suggestions
        auto_set_highlight_group = true,
        auto_set_keymaps = false,
        auto_apply_diff_after_generation = false,
        jump_result_buffer_on_finish = false,
        support_paste_from_clipboard = false,
        minimize_diff = true, -- Experimental: minimize the diff when applying a code block
        enable_token_counting = true,
        auto_add_current_file = true,
        confirmation_ui_style = "inline_buttons", -- "popup" or "inline_buttons"
        acp_follow_agent_locations = true, -- Follow ACP agent edits
      },

      -- Mapping configuration
      mappings = {
        --- @class AvanteConflictMappings
        diff = {
          ours = "co",
          theirs = "ct",
          all_theirs = "ca",
          both = "cb",
          cursor = "cc",
          next = "]x",
          prev = "[x",
        },
        suggestion = {
          accept = "<M-l>",
          next = "<M-]>",
          prev = "<M-[>",
          dismiss = "<C-]>",
        },
        jump = {
          next = "]]",
          prev = "[[",
        },
        submit = {
          normal = "<CR>",
          insert = "<C-s>",
        },

        -- Window management
        sidebar = {
          apply_all = "A",
          apply_cursor = "a",
          switch_windows = "<Tab>",
          reverse_switch_windows = "<S-Tab>",
        },
      },

      -- Hints configuration
      hints = { enabled = true },

      -- Window configuration
      windows = {
        position = "right", -- Options: "right", "left", "top", "bottom"
        wrap = true, -- Wrap text in windows
        width = 30, -- Width as percentage when position is "left" or "right"
        sidebar_header = {
          enabled = true,
          align = "center", -- Options: "left", "center", "right"
          rounded = true,
        },
        edit = {
          border = "rounded", -- Options: "none", "single", "double", "rounded", "solid", "shadow"
          start_insert = true, -- Start in insert mode
        },
        ask = {
          floating = false, -- Open ask window as floating window
          start_insert = true, -- Start in insert mode
          border = "rounded",
          focus_on_apply = "ours", -- Options: "ours", "theirs"
        },
      },

      -- Highlights configuration
      highlights = {
        diff = {
          current = "DiffText",
          incoming = "DiffAdd",
        },
      },

      -- Diff configuration
      diff = {
        autojump = true,
        list_opener = "copen",
        override_timeoutlen = 500,
      },
    },

    -- Build avante - handles both Windows and Unix systems
    build = vim.fn.has("win32") ~= 0
      and "powershell -ExecutionPolicy Bypass -File Build.ps1 -BuildFromSource false"
      or "make",

    -- Dependencies
    dependencies = {
      "stevearc/dressing.nvim",
      "nvim-lua/plenary.nvim",
      "MunifTanjim/nui.nvim",
      -- Optional: for Copilot provider support
      "zbirenbaum/copilot.lua",
      -- Optional dependencies for additional features
      {
        -- Support for image pasting
        -- Make sure to set `opts.behaviour.support_paste_from_clipboard = true`
        "HakonHarnes/img-clip.nvim",
        event = "VeryLazy",
        opts = {
          -- Recommended settings for avante
          default = {
            embed_image_as_base64 = false,
            prompt_for_file_name = false,
            drag_and_drop = {
              insert_mode = true,
            },
            -- Required for Windows users since avante uses `curl` with Windows
            use_absolute_path = vim.fn.has("win32") == 1,
          },
        },
      },
      {
        -- Make sure to set this up properly if you have lazy=true
        "MeanderingProgrammer/render-markdown.nvim",
        opts = {
          file_types = { "markdown", "Avante" },
        },
        ft = { "markdown", "Avante" },
      },
    },
  },
}
