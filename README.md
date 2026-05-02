# Ikarus Hub

A lightweight, game-save-inspired floating checkpoint and branch manager for [SillyTavern](https://github.com/SillyTavern/SillyTavern). The general interface and UI glass panel is from [ST-Copilot](https://github.com/Supker/ST-Copilot), a floating assistant extensions.

## Features

- **Character-Level Hub** — Acts as a master "Save File" manager for your character. It aggregates all checkpoints and branches across a character's *entire* chat history, not just the active chat.
- **Save State Restoration** — Clicking a checkpoint acts like loading a game save: it automatically creates a fresh duplicate branch from the checkpoint so you can continue the story without permanently modifying the original checkpoint file.
- **Auto-Sync & Caching** — Automatically syncs your checkpoints in the background the first time you switch to a character. It caches the data to prevent UI lag and layout thrashing as you navigate between chats.
- **Manual Sync** — Click the Sync (🔄) button in the header at any time to explicitly rescan all the character's chat files for new bookmarks and branches.
- **Floating Window** — Draggable, resizable glassmorphic panel with warm amber/gold accents.
- **User Notes** — Add personal notes to any checkpoint or branch (persisted across sessions).
- **Search & Sort** — Filter by name or your custom notes, and sort by creation date or alphabetically.
- **Context Estimates** — Displays the exact message count and approximate context size per checkpoint/branch.
- **Dock Icon & Wand Menu** — Accessible via an optional floating screen-edge dock icon or SillyTavern's native extensions wand menu.
<img width="792" height="1056" alt="image" src="https://github.com/user-attachments/assets/65b2c5cf-b056-486a-bc44-3f8bbc5c2c23" />

<img width="900" height="1244" alt="image" src="https://github.com/user-attachments/assets/2d022685-d9dd-40f8-9a65-ecba523f2dc1" />



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

Open the **Extensions** panel and find the **Ikarus Checkpoint** section:

| Setting | Description |
|---------|-------------|
| **Enable** | Toggle the extension on/off |
| **Show Dock Icon** | Show/hide the floating bookmark button on the edge of the screen |
| **Open Navigator** | Button to manually open the checkpoint window |

## Usage

1. **Open the Hub** via the dock icon, wand menu, or settings panel.
2. When you switch to a new character, the Hub will automatically scan all their past chats in the background.
3. The **Checkpoints** section shows all bookmarks (Save States) across the character's history. Click one to **duplicate** it into a new active timeline.
4. The **Branches** section shows all active alternate timelines. Click one to **jump** to it directly.
5. Use the **Sync (🔄)** button in the top right to manually update the lists if you've recently created new bookmarks.
6. Add **notes** to any item by clicking the pen icon field.
7. Use **search** to filter and the **sort button** to toggle date/alphabetical order.

## Requirements

- SillyTavern (latest version recommended)
- No additional dependencies

## License

MIT
