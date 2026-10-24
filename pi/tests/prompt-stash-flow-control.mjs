// Linux/POSIX-only isolated PTY probe; never changes the user's terminal.
// node tests/prompt-stash-flow-control.mjs
import { execFileSync } from "node:child_process";
if (process.platform === "win32") {
  console.log("SKIP POSIX PTY XON/XOFF check on Windows");
} else {
  execFileSync("python3", ["-c", `
import os, pty, tty, termios, select
master, slave = pty.openpty()
try:
    tty.setraw(slave)
    raw = termios.tcgetattr(slave)
    assert not raw[0] & termios.IXON
    os.write(master, b'\\x13')
    assert select.select([slave], [], [], 1)[0]
    assert os.read(slave, 1) == b'\\x13'
    attrs = termios.tcgetattr(slave)
    attrs[0] |= termios.IXON
    termios.tcsetattr(slave, termios.TCSANOW, attrs)
    os.write(master, b'\\x13')
    assert not select.select([slave], [], [], .1)[0], 'IXON should consume Ctrl+S'
    os.write(master, b'\\x11Z') # resume output; sentinel proves processing before mode change
    assert select.select([slave], [], [], 1)[0]
    assert os.read(slave, 1) == b'Z'
    termios.tcsetattr(slave, termios.TCSANOW, raw)
    os.write(master, b'\\x13')
    assert select.select([slave], [], [], 1)[0]
    assert os.read(slave, 1) == b'\\x13'
finally:
    os.close(master)
    os.close(slave)
print('Prompt stash isolated PTY: raw Ctrl+S delivered; IXON consumes it; raw restored')
`], { stdio: "inherit" });
}
