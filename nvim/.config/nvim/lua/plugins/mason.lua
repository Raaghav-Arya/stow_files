return {
    {
        "mason-org/mason.nvim",
        opts = function(_, opts)
            -- Ensure opts.ensure_installed exists before processing
            if opts.ensure_installed then
                opts.ensure_installed = vim.tbl_filter(function(package)
                    -- Strip out the bad tree-sitter package from auto-installing
                    return package ~= "tree-sitter"
                end, opts.ensure_installed)
            end
        end,
    },
}
