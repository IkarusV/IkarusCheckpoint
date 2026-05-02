# Ikarus Checkpoint

A lightweight, game-save-inspired floating checkpoint/branch navigator for [SillyTavern](https://github.com/SillyTavern/SillyTavern).

## Features

- **Floating Window** — Draggable, resizable glassmorphic panel with warm amber/gold accents
- **Checkpoint Scanner** — Automatically detects all bookmarks/checkpoints in your current chat
- **Branch Navigator** — Lists all chat branches for easy switching
- **One-Click Navigation** — Jump to any checkpoint or branch instantly
- **Quick Checkpoint** — Create new checkpoints directly from the panel
- **User Notes** — Add personal notes to any checkpoint (persisted across sessions)
- **Search & Sort** — Filter by name or note, sort by date or alphabetically
- **Context Estimates** — Shows message count and approximate context size per checkpoint
- **Keyboard Shortcut** — Configurable hotkey (default: `Alt+K`) to toggle the window
- **Wand Menu** — Accessible from SillyTavern's extensions wand menu
- **Dock Icon** — Optional floating button for quick access
- **Back to Main** — One-click return to the main chat when inside a checkpoint

## Installation

### Via SillyTavern Extension Installer

1. Open SillyTavern
2. Go to **Extensions** → **Install Extension**
3. Paste this URL:
   ```
   https://github.com/IkarusV/IkarusCheckpoint
   ```
4. Click **Install** and reload

### Manual Installation

1. Clone this repository into your SillyTavern extensions folder:
   ```bash
   cd SillyTavern/data/default-user/extensions/third-party/
   git clone https://github.com/IkarusV/IkarusCheckpoint.git
   ```
2. Restart SillyTavern

## Configuration

Open **Extensions** panel → find **Ikarus Checkpoint** section:

| Setting | Description |
|---------|-------------|
| **Enable** | Toggle the extension on/off |
| **Show Dock Icon** | Show/hide the floating bookmark button |
| **Keyboard Shortcut** | Enable and configure a hotkey (e.g. `Alt+K`, `Ctrl+Shift+B`) |
| **Open Navigator** | Button to open the checkpoint window |

## Usage

1. **Open the window** via dock icon, wand menu, hotkey, or settings button
2. **Checkpoints** section shows all bookmarks in the current chat
3. **Branches** section shows all chat branches
4. Click any card to **navigate** to that checkpoint/branch
5. Use the **+ New** button to create a checkpoint at the current position
6. Add **notes** to any checkpoint by clicking the pen icon field
7. Use **search** to filter and the **sort button** to toggle date/alphabetical order
8. When inside a checkpoint, use **Back to Main Chat** to return

## Requirements

- SillyTavern (latest version recommended)
- No additional dependencies

## License

MIT
