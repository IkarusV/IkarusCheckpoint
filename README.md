# Ikarus Hub

A lightweight floating checkpoint, branch, and swipe navigator for [SillyTavern](https://github.com/SillyTavern/SillyTavern). The glass-panel interface is inspired by [ST-Copilot](https://github.com/Supker/ST-Copilot), a floating assistant extension by Supker.

## Features

- **Character-level hub** - Scans a character's chat history and groups checkpoints, branch chats, and swipes in one compact floating panel.
- **Checkpoint folders** - Checkpoints are grouped as pseudo-folders. Open a folder to see the original checkpoint and numbered copies such as `(1)`, `(2)`, and `(3)`.
- **Safe checkpoint creation** - Use the `+` button on a checkpoint folder/card to create a fresh numbered checkpoint copy. Opening an existing child checkpoint jumps to that chat instead of creating another duplicate.
- **Branch and swipe folders** - Chats with detected branch or swipe data appear in the Branches & Swipes section. Opening a chat folder separates its **Branches** and **Swipes** into simple categories.
- **Deep branch scan** - The red deep-scan button can infer missing branch parents by comparing shared message history, useful when SillyTavern branch metadata is missing or stale.
- **Quick sync** - The normal sync button performs a lightweight scan for checkpoints, explicit branch metadata, and swipes. It preserves deep-scan branch data.
- **Detection toggles** - Choose whether to detect checkpoints, branches, and/or swipes. All are enabled by default.
- **Optional character auto-scan** - Auto-scan on character change is enabled by default, but can be disabled so character changes only show already cached data until you manually sync.
- **Search, sort, and notes** - Search by names, swipe text, or notes. Sort by date or name. Add persistent notes to checkpoint, branch, and swipe entries.
- **Floating window** - Draggable, resizable glass panel with mobile-friendly sizing, an optional dock icon, and a SillyTavern wand-menu entry.
- **Context estimates** - Shows message count and approximate context size where available.

<img width="792" height="1056" alt="Ikarus Hub checkpoint list" src="https://github.com/user-attachments/assets/65b2c5cf-b056-486a-bc44-3f8bbc5c2c23" />

<img width="900" height="1244" alt="Ikarus Hub floating panel" src="https://github.com/user-attachments/assets/2d022685-d9dd-40f8-9a65-ecba523f2dc1" />

<img width="652" height="354" alt="Ikarus Hub compact view" src="https://github.com/user-attachments/assets/8e695ca0-b0ef-4ab6-8380-5a3be3e5c948" />

## Installation

### Via SillyTavern Extension Installer

1. Open SillyTavern.
2. Go to **Extensions** -> **Install Extension**.
3. Paste this URL:
   ```text
   https://github.com/IkarusV/IkarusCheckpoint
   ```
4. Click **Install** and reload SillyTavern.

### Manual Installation

1. Clone this repository into your SillyTavern third-party extensions folder:
   ```bash
   cd SillyTavern/data/default-user/extensions/third-party/
   git clone https://github.com/IkarusV/IkarusCheckpoint.git
   ```
2. Restart SillyTavern.

## Configuration

Open the **Extensions** panel and find **Ikarus Checkpoint**.

| Setting | Description |
| --- | --- |
| **Enable Ikarus Checkpoint** | Toggle the extension on or off. |
| **Show floating dock icon** | Show or hide the floating bookmark button. |
| **Show scan notifications** | Show toast notifications when scans start and finish. |
| **Auto scan when character changes** | When enabled, the hub scans a character the first time it needs data. When disabled, character changes only load cached data until you press Sync. |
| **Detect Checkpoints** | Include checkpoint/bookmark detection. |
| **Detect Branches** | Include SillyTavern branch metadata detection. |
| **Detect Swipes** | Include swipe detection and search. |
| **Open Checkpoint Navigator** | Manually open the hub window. |

## Usage

1. Open the hub from the dock icon, wand menu, or settings panel.
2. Use the normal sync button to run a lightweight scan.
3. Open a checkpoint folder to see its original checkpoint and numbered copies.
4. Click the `+` button on a checkpoint folder/card to create a new numbered copy.
5. Click an existing checkpoint child to open it directly.
6. Open a Branches & Swipes chat folder to browse its detected branches and swipes.
7. Click a branch child to open that branch chat.
8. Click a swipe child to open the source chat around that message.
9. Use the red deep-scan button when branch parents are missing. This scan is more expensive because it compares chat histories, so it is manual on purpose.
10. Add notes and use search/sort to keep large chat histories manageable.

## Branch Detection Notes

SillyTavern does not always provide a reliable parent pointer for every branch chat. Ikarus Hub uses two branch detection modes:

- **Quick sync** reads explicit `extra.branches` metadata when SillyTavern has it.
- **Deep branch scan** compares message prefixes to infer parent and child relationships when metadata is missing.

Deep-scan results are preserved by later quick syncs, so you can run the expensive scan only when you need to rebuild branch relationships.

## Compatibility

The settings container includes a stable `ikarus_checkpoint_container` id so other extensions can identify or skip this settings block when needed.

## Requirements

- SillyTavern
- No additional dependencies

## License

MIT
