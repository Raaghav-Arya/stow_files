-- Consolidated Git Plugin Configuration
-- This file sources individual git plugin configs from lua/plugins/git/
--
-- Plugin files:
-- - neogit.lua     : Git client interface
-- - diffview.lua   : Git diff viewer with text comparison
-- - gitsigns.lua   : Git status in signcolumn with hunk operations
-- - lazygit.lua    : Terminal UI for git commands
-- - snacks.lua     : Snacks git picker overrides
-- - which-key.lua  : Which-key group definitions

return {
    -- Import all git plugin configurations
    { import = "plugins.git.neogit" },
    { import = "plugins.git.diffview" },
    { import = "plugins.git.gitsigns" },
    { import = "plugins.git.lazygit" },
    { import = "plugins.git.snacks" },
    { import = "plugins.git.which-key" },
}
