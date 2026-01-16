# Google Apps Script Update Instructions

## Files to Update

You need to update **3 files** in your Google Apps Script project:

### 1. ✅ Code.gs — REQUIRED (Major Changes)

**What changed:**
- Added jump ball event support (`JUMP_BALL`, `JUMP`, `JB` event types)
- Added score calculation (`computeFinalScore_()`)
- Added multi-user polling endpoint (`getLiveSnapshotReadOnly_()`)
- Added read-only wrapper functions for DoGet.gs
- Added clock/period change logging (optional PBP entries)
- All existing functionality preserved

**Action:** Replace entire `Code.gs` file with `backend-gas/Code.gs`

---

### 2. ✅ DoGet.gs — REQUIRED (Refactored to Thin Routing Layer)

**What changed:**
- Refactored to be a pure routing/formatting layer
- Removed all business logic (moved to Code.gs)
- Now delegates to Code.gs wrapper functions:
  - `getLiveSnapshotReadOnly_()` for polling
  - `renderTitlerCsvReadOnly_()` for CSV export
  - `listGames_()` and `getGameState_()` for API
- CSV export format unchanged (still stable)
- JSONP support preserved

**Action:** Replace entire `DoGet.gs` file with `backend-gas/DoGet.gs`

---

### 3. ✅ PressSheet.html — REQUIRED (Bug Fix)

**What changed:**
- Fixed corruption issue (stray string at beginning of file)

**Action:** Replace entire `PressSheet.html` file with `backend-gas/PressSheet.html`

---

### 4. ❌ App.html — NO CHANGES NEEDED

This file was not modified. Keep it as-is.

---

## Step-by-Step Update Process

1. **Open Google Apps Script**
   - Go to your Google Sheets document
   - Click **Extensions → Apps Script**

2. **Update Code.gs**
   - Click on `Code.gs` in the file list
   - Select all (Ctrl+A / Cmd+A)
   - Delete everything
   - Copy entire contents of `backend-gas/Code.gs`
   - Paste into the editor
   - Click **Save** (Ctrl+S / Cmd+S)

3. **Update DoGet.gs**
   - Click on `DoGet.gs` in the file list
   - Select all (Ctrl+A / Cmd+A)
   - Delete everything
   - Copy entire contents of `backend-gas/DoGet.gs`
   - Paste into the editor
   - Click **Save**

4. **Update PressSheet.html**
   - Click on `PressSheet.html` in the file list
   - Select all (Ctrl+A / Cmd+A)
   - Delete everything
   - Copy entire contents of `backend-gas/PressSheet.html`
   - Paste into the editor
   - Click **Save**

5. **Deploy**
   - Click **Deploy → Manage deployments**
   - Click **Edit** (pencil icon) on your existing deployment
   - Click **Deploy** (or create new deployment if needed)
   - Copy the new deployment URL if it changed

6. **Test**
   - Test CSV endpoint: `/exec?view=tl_csv&access_token=YOUR_TOKEN`
   - Test API endpoint: `/exec?view=api&action=list_games&access_token=YOUR_TOKEN`
   - Test frontend: Open the web app URL

---

## What's New (Features Added)

### Backend (Code.gs)
- ✅ Jump ball event support (`JUMP_BALL` event type)
- ✅ Score calculation (Home/Away totals from LIVE sheet)
- ✅ Multi-user polling endpoint (`get_live_snapshot`)
- ✅ Clock/period change logging (optional PBP entries)

### Frontend (src/App.jsx)
- ✅ Unified player view (all players on one screen)
- ✅ On-court players pinned to top
- ✅ Streamlined substitutions
- ✅ Quarter change resets clock to 8:00
- ✅ Manual clock correction UI
- ✅ Live score display
- ✅ Jump ball button
- ✅ End game confirmation dialog
- ✅ Multi-user polling (every 5 seconds)

---

## Important Notes

- **CSV format unchanged** — NewBlue Titler bridge will continue working
- **LIVE sheet schema unchanged** — No column changes
- **All existing endpoints preserved** — Backward compatible
- **DoGet.gs is now pure routing** — No business logic, just formatting

---

## Rollback Plan

If something breaks:
1. Keep backups of your current GAS files before updating
2. You can revert by pasting the old code back
3. The frontend changes are separate and won't break if backend is reverted

---

## Verification Checklist

After updating, verify:
- [ ] CSV export works: `/exec?view=tl_csv&access_token=...`
- [ ] Press sheet works: `/exec?view=presssheet&tab=...`
- [ ] API works: `/exec?view=api&action=list_games&access_token=...`
- [ ] Frontend loads: Open web app URL
- [ ] NewBlue Titler bridge still receives CSV updates
