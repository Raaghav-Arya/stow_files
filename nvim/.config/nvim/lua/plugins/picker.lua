-- Snacks picker configuration to follow symlinks
return {
  {
    "folke/snacks.nvim",
    opts = {
      picker = {
        -- Global picker configuration
        sources = {
          -- Configure files picker to follow symlinks
          files = {
            follow = true, -- Follow symlinks when searching for files
            hidden = false, -- Set to true if you also want hidden files
            ignored = true, -- Show files even if they're in .gitignore
          },
          -- Configure grep picker to follow symlinks
          grep = {
            follow = true, -- Follow symlinks when grepping
            hidden = false, -- Set to true if you also want to search in hidden files
            ignored = true, -- Search in files even if they're in .gitignore
          },
          -- Configure grep_word picker to follow symlinks
          grep_word = {
            follow = true, -- Follow symlinks when searching for words
            ignored = true, -- Search in files even if they're in .gitignore
          },
          -- Configure live grep to follow symlinks
          grep_buffers = {
            follow = true, -- Follow symlinks in buffer grep
            ignored = true, -- Search in files even if they're in .gitignore
          },
          -- Configure explorer to follow symlinks
          explorer = {
            follow_file = true, -- Follow the file from the current buffer
            ignored = true, -- Search in files even if they're in .gitignore
          },
        },
      },
    },
  },
}
