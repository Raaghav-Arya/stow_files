# Pi transcript navigation

Navigation is provided by the published **pi-vim-navigation** npm package, not a
local extension. Version **0.1.1** adds Ctrl+U/Ctrl+D half-page scrolling in NAV
mode and has been verified interactively.

- Source and README: https://github.com/Raaghav-Arya/pi-vim-navigation
- npm: https://www.npmjs.com/package/pi-vim-navigation
- Configuration: `.pi/agent/settings.json` contains `"npm:pi-vim-navigation"` in
  `packages`.

The former local `transcript-navigation.ts` implementation and loader have been
removed. Do not reinstall them alongside the npm package.

## Install and update

```sh
pi install npm:pi-vim-navigation
# Update an existing installation:
pi update npm:pi-vim-navigation
```

Run `/reload` or restart Pi after installation or updates. Publishing a new npm
version does not automatically update an existing installation. Ctrl+U/Ctrl+D
require version 0.1.1 or newer; updating a stale 0.1.0 installation resolved the
missing shortcuts.

Stay in **Neovim terminal mode**; all navigation happens inside Pi, not in
Neovim's terminal scrollback.

## Keys (fullscreen only)

- **Ctrl+Q**: toggle INPUT/NAV mode. Returning to INPUT follows latest output.
- **j / k** or **Down / Up**: scroll one transcript line in NAV mode.
- **Ctrl+U / Ctrl+D**: scroll half a page up/down in NAV mode only. The amount is
  half the current terminal height, rounded down to at least one line.
- **gg / G**: jump to beginning/end in NAV mode.
- **i**: leave NAV, jump to latest output, and edit the existing draft.
- **PageUp / PageDown**, **Ctrl+Home / Ctrl+End**: Pi's fullscreen transcript
  controls remain available in either mode.
- **Escape / Ctrl+C**: leave NAV without jumping the viewport, then perform Pi's
  normal interrupt/clear action. Escape is not a mode-entry key.

There are no global Ctrl+U/Ctrl+D fullscreen keybinding overrides. In INPUT mode,
Ctrl+U retains delete-to-line-start behavior; Ctrl+D deletes forward or exits
when the editor is empty. The plugin handles scrolling only in NAV mode.

The editor's bottom border shows INPUT or NAV. Unknown keys, Enter, and pasted
text are ignored in NAV to protect the draft and avoid submitting it. This is
transcript navigation, not Vim editing or selection. Pi's existing fullscreen
search and mouse controls remain available. Dialogs retain their own keyboard
handling. Regular mode is unchanged.

The extension replaces the main editor with a `CustomEditor` subclass. Do not
combine it with another extension that replaces the editor without explicitly
composing them.

## Remove

```sh
pi remove npm:pi-vim-navigation
```

Then run `/reload` or restart Pi. Stock Ctrl+U/Ctrl+D behavior remains unchanged.

## Tests

From the stow repository root, with Pi and the npm package installed:

```sh
PI_OFFLINE=1 node pi/tests/transcript-navigation.test.mjs
PI_OFFLINE=1 node pi/tests/picker-accept.test.mjs
PI_OFFLINE=1 node pi/tests/prompt-stash.test.mjs
PI_OFFLINE=1 PI_AGENTS_HUB_CHILD=0 node pi/tests/feature-integration.test.mjs
```

These regression suites import the installed npm extension and use the real Pi
runtime without making model requests. Set `PI_PACKAGE_ROOT` if Pi is not on
PATH. The plugin repository also contains unit and real-editor integration tests
for NAV-only half-page scrolling, terminal resizing, and stock INPUT editing.
