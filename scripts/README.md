# Broadcast Scripts

Node.js bridge scripts that connect JM Live Stats to NewBlue Titler graphics.

## What These Scripts Do

1. **`jm_titler_bridge.js`** - Polls Google Apps Script CSV endpoint every second and writes to `C:\Broadcast\Data\jm_stats.csv` (for NewBlue Titler to read)

2. **`jm_players_server.js`** - Serves player images from `C:\Broadcast\Players\web` over HTTP at `http://localhost:8085/Players/`

3. **`run_broadcast_stack.js`** - Runs both scripts together (Ctrl+C stops both)

## Setup

```bash
cd scripts
npm install
```

## Running

### Run both scripts together:
```bash
npm start
# or
node run_broadcast_stack.js
```

### Run individually:
```bash
npm run bridge    # Just the CSV bridge
npm run server     # Just the image server
```

## Important Paths

**These scripts still write/serve from `C:\Broadcast`** (for compatibility with NewBlue Titler):

- CSV Output: `C:\Broadcast\Data\jm_stats.csv` (written by bridge)
- Player Images: `C:\Broadcast\Players\web\` (served by server)

The scripts themselves are now in this repo, but they continue to use `C:\Broadcast` for all data/images.

## Environment Variables

Set `JM_TOKEN` environment variable for authentication:
```bash
set JM_TOKEN=your_token_here
node run_broadcast_stack.js
```

Or on Windows PowerShell:
```powershell
$env:JM_TOKEN="your_token_here"
node run_broadcast_stack.js
```

## Notes

- The bridge polls every 1 second
- The image server runs on port 8085
- Both scripts write to/serve from `C:\Broadcast` (not the repo)
- Player images should be placed in `C:\Broadcast\Players\web\`
