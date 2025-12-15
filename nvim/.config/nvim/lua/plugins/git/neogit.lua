-- Neogit: Full-featured Git client
return {
    "NeogitOrg/neogit",
    dependencies = {
        "nvim-lua/plenary.nvim", -- required
        "sindrets/diffview.nvim", -- optional - Diff integration
        "folke/snacks.nvim", -- optional
    },
    cmd = "Neogit",
    keys = {
        {
            "<leader>gn",
            "<cmd>Neogit cwd=%:p:h<cr>",
            desc = "Neogit Status (Buffer's Git Repo)",
        },
    },
    opts = {
        -- Layout: "split" (horizontal), "vsplit" (vertical), "floating", or "tab"
        kind = "floating",
        -- Auto-refresh status when git state changes
        auto_refresh = true,
        -- Git service integrations for opening PRs, commits, and branches in browser
        git_services = {
            ["github.com"] = {
                pull_request = "https://github.com/${owner}/${repository}/compare/${branch_name}?expand=1",
                commit = "https://github.com/${owner}/${repository}/commit/${oid}",
                tree = "https://${host}/${owner}/${repository}/tree/${branch_name}",
            },
            ["bitbucket.itg.ti.com"] = {
                pull_request = "https://bitbucket.itg.ti.com/${owner}/${repository}/pull-requests/new?source=${branch_name}&t=1",
                commit = "https://bitbucket.itg.ti.com/${owner}/${repository}/commits/${oid}",
                tree = "https://bitbucket.itg.ti.com/${owner}/${repository}/branch/${branch_name}",
            },
            ["gitlab.com"] = {
                pull_request = "https://gitlab.com/${owner}/${repository}/merge_requests/new?merge_request[source_branch]=${branch_name}",
                commit = "https://gitlab.com/${owner}/${repository}/-/commit/${oid}",
                tree = "https://gitlab.com/${owner}/${repository}/-/tree/${branch_name}?ref_type=heads",
            },
            ["azure.com"] = {
                pull_request = "https://dev.azure.com/${owner}/_git/${repository}/pullrequestcreate?sourceRef=${branch_name}&targetRef=${target}",
                commit = "",
                tree = "",
            },
        },
    },
}
