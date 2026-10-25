# PI-014 implementation plan (before coding)

1. Read ticket, personal keybindings/settings and transcript editor; inspect installed Pi 1.4.0 docs/examples and actual editor/select/custom-dialog paths.
2. Online-read pinned nvim-cmp and blink.cmp acceptance implementation and licenses, without installing or executing downloaded code; record provenance/security/API findings.
3. Prefer documented `tui.select.confirm` config for actual selection UIs. Because Pi's slash-completion confirm path can submit, compose a small input-transform helper into the existing transcript editor: Ctrl+Y becomes the existing Tab binding only while autocomplete is visible. Do not install an editor factory or global input hook.
4. Parent owns shared editor/config changes. Send exact integration instructions; account for INPUT/NAV, regular/fullscreen, key releases, bracketed paste and Ctrl+S integration. Preserve Ctrl+Y yank when autocomplete is absent.
5. Add offline runtime tests of actual Pi editor, completion and selection paths, unchanged Tab, navigation/filter/cancel/no-selection, Unicode/narrow rendering. Document built-in/custom dialog coverage and unsupported paths explicitly.
6. Report automated tests and manual terminal forwarding still required. No commits, installs, model calls, live reload, secret reads or downloaded code execution.

## Outcome / plan adjustment

Source audit and a runtime regression test proved global `tui.select.confirm` also submits free-text dialogs. Step 3's config route was rejected, not implemented. Parent was asked to relay the scope clarification rather than weaken context preservation. Delivered safe completion helper plus opt-in custom-selection predicate; broader built-in picker coverage stays explicitly unsupported/partial. Both offline picker and transcript tests passed. Shared editor integration belongs to the parent; terminal-stack manual testing remains pending.

Risks: `tui.select.confirm` is not uniformly used by custom extensions. Mapping it alone is unsafe for slash completion. Stock Editor has public `isShowingAutocomplete()` but no public accept-without-submit API; reuse Tab input rather than private autocomplete state. Preserve current paste handling including chunks. No global claim for arbitrary custom dialogs or RPC clients.
