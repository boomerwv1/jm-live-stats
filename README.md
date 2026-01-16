# JM Live Stats

Real-time basketball stat tracking system used during live middle-school/high-school games.

## Project Structure

```
jm-stats-clean/
├── src/                    # React frontend (Vite)
│   └── App.jsx            # Main stat entry UI
├── backend-gas/           # Google Apps Script backend code
│   ├── Code.gs           # Main Apps Script handlers
│   └── ...               # Other .gs files
├── scripts/               # Node.js bridge scripts
│   ├── jm_titler_bridge.js    # Polls CSV, writes to C:\Broadcast\Data\
│   ├── jm_players_server.js   # Serves images from C:\Broadcast\Players\
│   └── run_broadcast_stack.js  # Runs both scripts
└── dist/                  # Built frontend (deployed to GitHub Pages)
```

## Frontend (React)

The web UI for stat keepers during live games.

### Development
```bash
npm install
npm run dev
```

### Build & Deploy
```bash
npm run build
npm run deploy  # Deploys to GitHub Pages
```

### Features
- ✅ Unified player view (all players on one screen)
- ✅ On-court players pinned to top
- ✅ Streamlined substitutions (single action)
- ✅ Real-time playtime tracking
- ✅ Game persistence and resume

## Backend (Google Apps Script)

The Google Sheets-backed backend that stores all game data.

### Location
- Code lives in `backend-gas/` folder (backup/sync)
- Deployed in Google Apps Script (Extensions → Apps Script)

### API Endpoints
- `init_game` - Initialize new game
- `stat` - Log stat events
- `sub` - Log substitutions
- `set_meta` - Update period/clock
- `get_game_state` - Resume game
- `list_games` - List previous games
- `end_game` - Archive game

## Broadcast Scripts (Node.js)

Bridge scripts that connect the web app to NewBlue Titler graphics.

### Setup
```bash
cd scripts
npm install
```

### Run
```bash
npm start  # Runs both bridge + image server
```

### What They Do
- **Bridge**: Polls Google Apps Script CSV endpoint → writes to `C:\Broadcast\Data\jm_stats.csv`
- **Image Server**: Serves player images from `C:\Broadcast\Players\web\` over HTTP

**Note**: Scripts are in the repo, but still write/serve from `C:\Broadcast` (for NewBlue Titler compatibility).

## Data Flow

```
Stat Keeper (Browser)
    ↓ POST stat/sub events
Google Apps Script (Sheets)
    ↓ CSV export
Node.js Bridge Script
    ↓ writes CSV
C:\Broadcast\Data\jm_stats.csv
    ↓ reads
NewBlue Titler Graphics
```

## Key Concepts

- **LIVE sheet** is the source of truth
- Event logs are **append-only**
- Stats are **recomputed from events**
- Games remain **LIVE until explicitly ended** (no auto-end)

## Deployment

1. **Frontend**: Build and deploy to GitHub Pages (served by Google Apps Script)
2. **Backend**: Copy code from `backend-gas/` to Google Apps Script
3. **Scripts**: Run `npm start` in `scripts/` folder (keeps CSV updated for Titler)
