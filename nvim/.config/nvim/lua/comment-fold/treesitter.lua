local M = {}

--- Check if buffer has a treesitter parser
---@param bufnr number
---@return boolean ok, string? error
function M.has_parser(bufnr)
    local ft = vim.bo[bufnr].filetype
    if ft == "" then
        return false, "No filetype detected"
    end

    local lang = vim.treesitter.language.get_lang(ft)
    if not lang then
        return false, "No treesitter language for filetype: " .. ft
    end

    local ok = pcall(vim.treesitter.get_parser, bufnr, lang)
    if not ok then
        return false, "No treesitter parser installed for: " .. lang
    end

    return true, nil
end

--- Check if a node type represents a comment
---@param node_type string
---@return boolean
local function is_comment_type(node_type)
    -- Common comment node types across languages
    return node_type:match("comment") ~= nil
end

--- Check if a comment is inline (has code before it on the same line)
---@param bufnr number
---@param start_row number (0-indexed)
---@param start_col number
---@return boolean
local function is_inline_comment(bufnr, start_row, start_col)
    -- Get the line content
    local line = vim.api.nvim_buf_get_lines(bufnr, start_row, start_row + 1, false)[1]
    if not line then
        return false
    end

    -- Check if there's non-whitespace content before the comment
    local before_comment = line:sub(1, start_col)
    return before_comment:match("%S") ~= nil
end

--- Get all comment ranges in the buffer
---@param bufnr number
---@param config table
---@return table[] Array of {start_line, end_line} (1-indexed)
function M.get_comment_ranges(bufnr, config)
    local ft = vim.bo[bufnr].filetype
    local lang = vim.treesitter.language.get_lang(ft)
    local parser = vim.treesitter.get_parser(bufnr, lang)
    local trees = parser:parse()
    if not trees or #trees == 0 then
        return {}
    end

    local tree = trees[1]
    local root = tree:root()

    local ranges = {}

    -- Method 1: Use highlights query with @comment capture
    local query_ok, query = pcall(vim.treesitter.query.get, lang, "highlights")
    if query_ok and query then
        for id, node, _ in query:iter_captures(root, bufnr, 0, -1) do
            local capture_name = query.captures[id]
            if capture_name and capture_name:match("^comment") then
                local start_row, start_col, end_row, _ = node:range()
                -- Skip inline comments (comments with code before them)
                if not is_inline_comment(bufnr, start_row, start_col) then
                    table.insert(ranges, { start_row + 1, end_row + 1 }) -- Convert to 1-indexed
                end
            end
        end
    end

    -- Method 2: Fallback - traverse tree and find comment nodes
    if #ranges == 0 then
        local function traverse(node)
            if is_comment_type(node:type()) then
                local start_row, start_col, end_row, _ = node:range()
                -- Skip inline comments
                if not is_inline_comment(bufnr, start_row, start_col) then
                    table.insert(ranges, { start_row + 1, end_row + 1 })
                end
            end
            for child in node:iter_children() do
                traverse(child)
            end
        end
        traverse(root)
    end

    -- Merge consecutive ranges if configured
    if config.merge_consecutive and #ranges > 1 then
        ranges = M.merge_ranges(ranges, bufnr, config)
    end

    -- Filter out single-line ranges (they cause folding issues)
    local filtered = {}
    for _, range in ipairs(ranges) do
        if range[1] ~= range[2] then  -- Only keep multi-line comments
            table.insert(filtered, range)
        end
    end

    return filtered
end

--- Merge adjacent comment ranges
---@param ranges table[]
---@param bufnr number
---@param config table
---@return table[]
function M.merge_ranges(ranges, bufnr, config)
    -- Sort by start line
    table.sort(ranges, function(a, b)
        return a[1] < b[1]
    end)

    local merged = {}
    local current = nil

    for _, range in ipairs(ranges) do
        if not current then
            current = { range[1], range[2] }
        else
            -- Check if this range is adjacent to current (possibly with blank lines)
            local gap_start = current[2] + 1
            local gap_end = range[1] - 1
            local is_adjacent = gap_end < gap_start

            -- Check for blank lines between
            local only_blanks = true
            if not is_adjacent and config.include_blank_after then
                for lnum = gap_start, gap_end do
                    local line = vim.api.nvim_buf_get_lines(bufnr, lnum - 1, lnum, false)[1]
                    if line and line:match("%S") then
                        only_blanks = false
                        break
                    end
                end
            end

            if is_adjacent or (config.include_blank_after and only_blanks) then
                -- Merge
                current[2] = range[2]
            else
                -- Start new range
                table.insert(merged, current)
                current = { range[1], range[2] }
            end
        end
    end

    if current then
        table.insert(merged, current)
    end

    return merged
end

return M
