# Aliases
alias ccc="clear"
alias gst="git status"
alias glg="git log"
alias glgo="git log --oneline"
alias rst2rem="git reset --hard @{u}"
alias ls='ls -v '

mkcd() { mkdir -p "$@" && cd "$@" || exit; }
grb() { git rebase -i HEAD~"$@"; }
