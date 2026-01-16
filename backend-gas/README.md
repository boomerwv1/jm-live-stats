# Google Apps Script Backend

This folder contains the Google Apps Script code that powers the JM Live Stats backend.

## Structure

Google Apps Script projects typically use `.gs` files. Common structure:
- `Code.gs` - Main entry point and doGet/doPost handlers
- `Helpers.gs` - Utility functions
- `Stats.gs` - Stat calculation and processing
- `Sheets.gs` - Google Sheets interaction functions

## How to Sync

### From Google Apps Script → This Repo
1. Open your Google Sheets document
2. Go to **Extensions → Apps Script**
3. Copy the code from each file (Code.gs, Helpers.gs, etc.)
4. Create corresponding `.gs` files in this folder
5. Commit to git

### From This Repo → Google Apps Script
1. Open your Google Sheets document
2. Go to **Extensions → Apps Script**
3. Copy the code from the `.gs` files in this folder
4. Paste into the corresponding files in Apps Script
5. Save and deploy

## Current API Endpoints

The backend handles these actions (from frontend):

- `init_game` - Initialize a new game
- `set_starters` - Save starting lineup
- `stat` - Log a stat event
- `sub` - Log a substitution
- `set_playtime` - Update playtime totals
- `set_meta` - Update period/clock
- `get_game_state` - Resume a game (JSONP GET)
- `list_games` - List previous games (JSONP GET)
- `end_game` - Archive a game

## Planned Enhancements

Based on requirements, these features need to be added:

1. **Jump Ball Event** - New event type `JUMP_BALL` for logging jump balls
2. **Score Calculation** - Calculate Home/Away scores from stat events (2M, 3M, FTM)
3. **Multi-User Polling** - Endpoint to fetch latest game state for concurrent users
4. **Clock Correction Logging** - Ensure clock updates via `set_meta` are auditable

## Notes

- The LIVE sheet is the source of truth
- Event logs are append-only
- Stats are recomputed from events
- Games remain LIVE until explicitly ended (no auto-end)
