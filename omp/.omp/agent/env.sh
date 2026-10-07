# OMP XDG Configuration
# Source this from ~/.bashrc or ~/.zshrc:
#   source ~/.omp/agent/env.sh

# XDG directories for clean separation of databases from config
export XDG_DATA_HOME="$HOME/.local/share"      # agent.db, skill-descriptions.db, sessions
export XDG_STATE_HOME="$HOME/.local/state"     # history.db, logs, terminal sessions
export XDG_CACHE_HOME="$HOME/.cache"           # models.db, composer.db, tiny models