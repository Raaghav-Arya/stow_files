-- Lualine customization:
-- - lualine_b: tab directory (pwd, :tcd-aware) + git branch
-- - lualine_c: simple buffer path (parent/file.ext), root_dir removed
--
-- Also patches LazyVim.root.cwd() to use vim.fn.getcwd() so all lualine
-- components respect tab-local (:tcd) and window-local (:lcd) directories.
return {
  {
    "nvim-lualine/lualine.nvim",
    init = function()
      -- Patch before lualine is configured so root_dir/pretty_path pick it up
      LazyVim.root.cwd = function()
        return LazyVim.root.realpath(vim.fn.getcwd()) or ""
      end
    end,
    opts = function(_, opts)
      local tab_dir = {
        function()
          -- Show cwd abbreviated like a shell prompt (~-shortened, last 3 parts)
          local cwd = vim.fn.getcwd()
          local short = vim.fn.fnamemodify(cwd, ":~")
          -- Trim to last 3 path components to keep it readable
          local parts = vim.split(short, "/")
          if #parts > 3 then
            parts = { "…", unpack(parts, #parts - 1, #parts) }
          end
          return table.concat(parts, "/")
        end,
        icon = "󰉋",
        color = function()
          return { fg = Snacks.util.color("Directory") }
        end,
      }

      -- Prepend tab_dir before the existing branch component
      opts.sections.lualine_b = vim.list_extend({ tab_dir }, opts.sections.lualine_b or { "branch" })

      -- Rebuild lualine_c from scratch: diagnostics + filetype icon + simple path
      -- (drops root_dir() and pretty_path() entirely)
      local icons = LazyVim.config.icons
      opts.sections.lualine_c = {
        {
          "diagnostics",
          symbols = {
            error = icons.diagnostics.Error,
            warn  = icons.diagnostics.Warn,
            info  = icons.diagnostics.Info,
            hint  = icons.diagnostics.Hint,
          },
        },
        { "filetype", icon_only = true, separator = "", padding = { left = 1, right = 0 } },
        {
          function()
            local name = vim.fn.expand("%:~:.")
            if name == "" then return "" end
            -- Show at most parent/filename
            local parts = vim.split(name, "/")
            if #parts > 2 then
              return "…/" .. parts[#parts - 1] .. "/" .. parts[#parts]
            end
            return name
          end,
          color = function()
            if vim.bo.modified then
              return { fg = Snacks.util.color("MatchParen"), bold = true }
            end
            return { bold = true }
          end,
        },
      }
      return opts
    end,
  },
}
