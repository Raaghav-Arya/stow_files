# form-ctrl-nav

Local OpenCode TUI plugin that makes **Ctrl+N** and **Ctrl+P** navigate answers in the question UI (the "form" keymap mode), in addition to the built-in `j`/`k` and arrow keys.

## Behavior

| Key | Equivalent to | In a text field |
| --- | --- | --- |
| Ctrl+P | Up | Moves the cursor up. On the first line, leaves the field and selects the previous answer. |
| Ctrl+N | Down | Moves the cursor down. On the last line, leaves the field and selects the next answer. |

Ctrl+N/P always navigate, even while typing in a text field, since they don't type characters. Left/Right, `h`/`l` and Tab (switching between questions) are unchanged.

## Installation

Registered in `cli.json`:

```json
{
  "plugins": ["./plugins/form-ctrl-nav"]
}
```

Config changes apply without a restart. Use `/reload` to force one.

## Why a plugin

The question UI's `j`/`k`/Up/Down bindings are hardcoded in the OpenCode binary rather than exposed as configurable command IDs, so `keybinds` in `cli.json` can't change them. (The configurable `dialog.select.next`/`prev` already include Ctrl+N/P, but the question UI doesn't use them.)

## How it works

A prepended `keypress` listener runs only while `keymap.mode.current() === "form"`:

- **Ctrl+P:** rewrites the event in place to a plain Up (`name`, `sequence`, `ctrl`).
- **Ctrl+N, not in a text field or not on the last line:** rewrites the event to a plain Down.
- **Ctrl+N on the last line of a text field:** the form has no "leave edit" binding for Down, only for Up. So the plugin swallows the event, emits a synthetic Escape (closes the answer edit), then emits a synthetic Down on the next tick (`setTimeout 0`) once edit mode has ended.

## Gotchas learned the hard way

- **Synthetic events need clean flags.** Cloned events copy the original's "default prevented" and "propagation stopped" state, which makes the keymap ignore them. `withKey` resets both.
- **Synthetic Down must be deferred.** Emitting Escape and Down back-to-back lets Down arrive while the field is still in edit mode, where it does nothing. Hence the `setTimeout`.
- **`sequence` must be the real terminal sequence.** The text field inserts an event's `sequence` as typed text. Using the key name (e.g. `"escape"`) printed the literal word into the field. Use `\x1b`, `\x1b[A` and `\x1b[B`.
- **Escape can dismiss the whole form** in some states (e.g. the form has no answer edit open). Ctrl+N is only synthesized into Escape when an editor is focused, so this should not trigger, but it is the first thing to check if a form disappears unexpectedly.

## Fragility

This depends on OpenCode internals found by reading the binary, not on documented APIs:

- the `form` keymap mode name
- `renderer.currentFocusedEditor` and its `virtualLineCount`, `scrollY` and `visualCursor.visualRow` properties
- the Escape-leaves-edit and Up-leaves-edit behavior of the form's editing layer
- `keyInput.emit("keypress", ...)` and `prependListener`

An OpenCode update may break it. If Ctrl+N/P stop working, check these first. If `virtualLineCount` is renamed, Ctrl+N inside a multi-line field falls back to acting as a plain Down.

## Files

- `tui.ts`: the plugin
