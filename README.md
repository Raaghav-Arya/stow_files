# Config File Backup Repo

This repository contains configuration files and scripts managed using GNU Stow

## Structure

- Each directory represents a set of dotfiles or configuration for a specific application.
- Files are symlinked to their appropriate locations in the home directory.

## Usage

1. Clone the repository to your home directory.
2. Use `stow <package>` to symlink the desired configuration.

## Requirements

- GNU Stow
- Linux environment
