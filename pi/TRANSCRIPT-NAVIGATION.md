# Experimental Pi transcript navigation

The working Ctrl+U/Ctrl+D configuration is committed in `1a5c531`.
The navigation extension is a separate, reversible experiment.

Implementation: `.pi/agent/extensions/transcript-navigation.ts`, symlinked into
`~/.pi/agent/extensions/`. Run `/reload` to load it. Stay in **Neovim terminal
mode**; all navigation happens inside Pi, not in Neovim's terminal scrollback.

## Keys (fullscreen only)

- **Ctrl+Q**: toggle input/navigation mode. Returning to input follows latest output.
- **j / k** or **Down / Up**: scroll one transcript line in navigation mode.
- **gg / G**: jump to beginning/end in navigation mode.
- **i**: leave navigation mode, jump to latest output, and edit the existing draft.
- **Ctrl+U / Ctrl+D**, **PageUp / PageDown**, **Ctrl+Home / Ctrl+End**:
  existing fullscreen transcript controls continue to work in either mode.
- **Escape / Ctrl+C**: leave navigation mode without jumping the viewport, then
  perform Pi's normal interrupt/clear action. Escape is not a mode-entry key.

The editor's bottom border shows INPUT or NAV. Unknown keys, Enter, and pasted
text are ignored in navigation mode to protect the draft and avoid submitting it.
This is transcript navigation, not Vim editing or selection. Pi's existing
fullscreen search and mouse controls remain available. Dialogs retain their own
keyboard handling. Regular mode is unchanged.

The extension replaces the main editor with a `CustomEditor` subclass, following
Pi's modal-editor example. Do not combine it with another extension that replaces
the editor without explicitly composing them. It uses the installed fullscreen
renderer's public scrolling methods, capability-checked for compatibility.

## Disable

Rename the live symlink so Pi no longer discovers it, then run `/reload`:

```sh
mv ~/.pi/agent/extensions/transcript-navigation.ts \
   ~/.pi/agent/extensions/transcript-navigation.ts.disabled
```

To re-enable, rename it back and `/reload`. The Ctrl+U/Ctrl+D bindings remain
unchanged either way. No Sidekick or tmux configuration was modified.

## Tests

From the stow repository root:

```sh
node pi/tests/transcript-navigation.test.mjs
```

Tests load the installed Pi runtime and exercise its actual fullscreen input
routing, stable renderer proxy, editor callbacks, and mode rendering without
starting a terminal or making model requests. Set `PI_PACKAGE_ROOT` if Pi is not
on PATH. Interactive feel and mouse behaviour still need a manual trial.
