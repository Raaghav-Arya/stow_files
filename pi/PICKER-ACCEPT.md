# Ctrl+Y acceptance (PI-014)

## User decision and behavior

The user explicitly approved preferring Ctrl+Y acceptance over yank, including
submission in text dialogs. Personal `keybindings.json` now sets:

```json
"tui.select.confirm": ["enter", "ctrl+y"]
```

Enter remains available. Tab remains unchanged: some pickers use Tab to change
scope rather than accept, so this change does not redefine Tab globally.

The existing `transcript-navigation.ts` editor composes
`picker-accept/input.ts`: while autocomplete is visible, Ctrl+Y follows Tab's
completion path **without submitting the main prompt**, including slash-command
suggestions. No second editor factory or global input hook is installed.

## Coverage

| Surface | Behavior |
|---|---|
| Main editor autocomplete, regular/fullscreen INPUT | Apply highlighted suggestion like Tab, without submission |
| Built-in selectors using `tui.select.confirm` | Ctrl+Y confirms, as does Enter |
| `ctx.ui.select()` / confirm | Ctrl+Y confirms |
| Text dialogs using `tui.select.confirm`, including input/rename | Ctrl+Y confirms/submits; losing yank here is explicitly approved |
| Main editor without autocomplete | Stock behavior; yank may remain where no confirm action consumes it |
| Transcript NAV | Existing draft-protection policy remains |
| Bracketed paste | Forward unchanged, including split paste chunks |
| Arbitrary custom extensions | Only if they honor the confirm action or explicitly handle Ctrl+Y |
| AskUser custom UI | Its own contextual choice/review handling; free-text editor behavior is separate |
| RPC/JSON/print | Client owns keyboard behavior; no terminal remapping |

This is not a promise that every third-party/custom dialog honors Pi's named
confirmation action. The helper also exports `isPickerAcceptance` for selection
branches owned by an extension. Existing item/empty-selection guards still apply.

## Why the editor helper is required

Pi 1.4.0 handles confirmation of slash completions differently from Tab and may
submit the command. The helper intercepts Ctrl+Y **only while autocomplete is
visible**, converting it to Tab before stock processing. This applies in regular
mode and fullscreen INPUT, not NAV. Keep literal Tab bound to `tui.input.tab`;
if disabled/rebound, the helper fails inert rather than accidentally submitting.

State is local to each editor instance. No processes, timers, model requests,
persistence, downloaded plugin dependencies, or competing editor replacement.

## Apply and disable

Changes take effect on the next Pi start or `/reload`. Do not reload while
background agents are working: the hub shuts down its children on reload.

To remove the additional confirmation key, remove `ctrl+y` from
`tui.select.confirm`. To also remove autocomplete acceptance, bypass the
`pickerAcceptance.transform` call in `transcript-navigation.ts`, then remove its
helper import/field only after callers are gone. Retaining the helper while
removing the global binding yields completion-only Ctrl+Y with normal yank
outside completion. No live reload was performed during implementation.

## Validation

From `pi/`:

```sh
node tests/picker-accept.test.mjs
node tests/transcript-navigation.test.mjs
```

Offline tests use the installed Pi runtime and actual configured transcript editor:
completion/no-submission, unchanged Tab, selection navigation/filter/cancel/empty,
Unicode/narrow rendering, split paste, CSI-u/release handling, disabled Tab,
built-in selector confirmation and explicitly approved text-dialog submission.
No model/network requests or dependency installation.

Manual WezTerm → tmux → Neovim terminal forwarding remains unverified. Test regular
and fullscreen modes, slash/file completions, Ctrl+Y and Enter in pickers and text
dialogs, cancellation, NAV protection, Unicode, narrow widths and resize. Inspect
`:verbose tmap <C-y>` if Neovim intercepts the key; automated parsing is not
end-to-end terminal acceptance.

Plans and pinned actual-source reviews (nvim-cmp, blink.cmp, Pi):
`research/PI-014-plan.md`, `research/PI-014-references.md`. Their original rejection
of global confirmation records the earlier preservation requirement; the user
has since explicitly approved the broader confirmation behavior above.
