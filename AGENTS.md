# Agents Guide – DISTI Board (Apps Script + HTML)

## Stack
- Backend: Google Apps Script (apps-script/Code.gs)
- Frontend: HTML Service (apps-script/index.html)
- Manifest: apps-script/appsscript.json (webapp)

## How to run
- Deploy via Google Apps Script as a Web App.
- Execute as: Me
- Access: Anyone with link
- Sheets: IDs are configured in CONFIG.PRODUCTS_DB_ID and CONFIG.DISTI_BOARD_ID in Code.gs

## Project rules
- Preserve APIs: whoAmI, getCategories, listProducts, updateProduct (role-protected), setFavorite
- Preserve audit logging
- Preserve role checks: viewer, editor, admin
- Keep HtmlService.XFrameOptionsMode.ALLOWALL in doGet
- Keep helpers: Persian digit mapping and number parsing

## Testing
- After changes, deploy web app and test via URL
- Manual functional test only (no automated test runner)

## Coding style
- Small clear PRs
- Commit messages should describe the change
- Do not break compatibility with existing Sheets
