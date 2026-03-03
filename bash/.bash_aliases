# Aliases
alias ccc="clear"
alias gst="git status"
alias glg="git log"
alias rst2rem="git reset --hard @{u}"
alias ls='ls -v '
alias bat="batcat"
alias cat="bat"

# Makes a new dir and cd to it
mkcd() { mkdir -p "$@" && cd "$@" || exit; }
# Starts interactive rebase for the last N commits
grb() { git rebase -i HEAD~"$@"; }
# Returns the current date in yyyy-mm-dd format
today() { date +%F; }
# oneline gitlog
glgo() { git log --oneline -"$@"; }
# symbolic link creation
lncp() { ln -s $(realpath "$1") $(realpath "$2"); }
# Query claude in the terminal
ask() { claude -p --model haiku "$*"; }

