#!/bin/bash
# Script for downloading tpm and catppucin tmux theme. Needed for tmux.conf to work properly. Run this script before starting tmux for the first time.

git clone https://github.com/tmux-plugins/tpm ~/.config/tmux/plugins/tpm
git clone -b v2.1.3 https://github.com/catppuccin/tmux.git ~/.config/tmux/plugins/catppuccin/tmux
