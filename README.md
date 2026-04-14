# Cookie Editor & Storage Manager

A Manifest V3 Chrome extension for inspecting and editing cookies, localStorage, and sessionStorage from a browser side panel. It is designed for day-to-day debugging, test cleanup, and moving storage snapshots between pages with JSON import/export.

## Features

- Manage cookies, localStorage, and sessionStorage from one side panel.
- Search the active storage type and refresh the current tab data on demand.
- Add, edit, and delete individual cookies or web storage entries.
- Delete all entries in the active storage type for the current page after confirmation.
- Export selected storage types to a JSON snapshot.
- Import JSON snapshots and apply only the storage types included in the file.
- Right-click rows to copy the key/name, value, or full row as JSON.
- Expand rows to edit full values and metadata.
- Resize grid columns in the side panel.
- Live-sync data while the side panel is open, with sync paused while editing.
- Preserve cookie details such as path, SameSite, HttpOnly, Secure, store ID, and partition key when available.
- Enforce browser rules for `__Host-` and `__Secure-` cookie prefixes before saving.
- Open a quick guide automatically after first installation.

## Install Locally

1. Open `chrome://extensions` in Chrome or another Chromium-based browser.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this extension folder.
5. Open any website tab and click the extension icon to open the side panel.

No build step is required. The extension uses plain HTML, CSS, and JavaScript modules.

## Usage

Open the extension on a normal web page, then choose one of the side panel tabs:

- **Cookies**: lists cookies visible for the active tab URL.
- **LocalStorage**: lists `window.localStorage` entries from the active tab.
- **SessionStorage**: lists `window.sessionStorage` entries from the active tab.

Use the search box to filter the current table. Click a row to expand it, edit fields, reset the editor, cancel changes, or save. Use the `+` button to create a new cookie or storage entry.

`Delete All` removes every item in the active storage type for the current page, not just the filtered rows. The extension asks for confirmation before the bulk delete runs.

## Import and Export

The export button writes a JSON file named like:

```text
storage-control-example.com-2026-04-14T10-30-00-000Z.json
```

The export menu lets you choose which storage types are included. These preferences are saved in `chrome.storage.local`.

Exported files use this shape:

```json
{
  "version": 1,
  "exportedAt": "2026-04-14T10:30:00.000Z",
  "source": {
    "url": "https://example.com/path",
    "host": "example.com"
  },
  "selectedTypes": ["cookies", "localStorage", "sessionStorage"],
  "cookies": [
    {
      "name": "session",
      "value": "abc123",
      "domain": "example.com",
      "path": "/",
      "secure": true,
      "httpOnly": true,
      "sameSite": "lax",
      "expirationDate": 1770000000,
      "storeId": "0"
    }
  ],
  "localStorage": [
    {
      "key": "theme",
      "value": "dark"
    }
  ],
  "sessionStorage": [
    {
      "key": "draft",
      "value": "hello"
    }
  ]
}
```

Import accepts either the full export object or a direct payload object containing any of `cookies`, `localStorage`, or `sessionStorage`. When `selectedTypes` is present, only those storage types are applied.

Import updates or creates matching keys and cookies. It does not clear unrelated entries that are missing from the import file.

## Permissions

The extension requests:

- `cookies`: read, create, update, and remove cookies for the active page URL.
- `storage`: save side panel preferences, such as selected export types.
- `sidePanel`: show the extension UI in Chrome's side panel.
- `tabs`: find the active tab and react to tab changes.
- `scripting`: run small scripts in the active tab to read and write web storage.
- `<all_urls>` host access: allow cookie and web storage operations across sites where the extension is allowed to run.

## Project Structure

```text
manifest.json              Extension metadata, permissions, side panel, and worker registration
service-worker.js          Background message router and side panel launcher
sidepanel.html             Side panel UI shell
sidepanel.css              Side panel styling
sidepanel.js               Main side panel state, import/export, sync, and storage actions
storage/cookies.js         Chrome cookies API adapter
storage/webStorage.js      localStorage/sessionStorage adapter using chrome.scripting
ui/grid.js                 Expandable, editable storage grid component
ui/contextMenu.js          Row context menu for copy actions
guide.html                 First-install quick guide
guide.css                  Quick guide styling
icons/                     Extension icon assets
```

## Implementation Notes

- The service worker accepts typed messages from the side panel and delegates to the cookie or web storage modules.
- The extension action opens a window-level side panel, so one panel follows the active tab instead of creating separate tab-specific panels.
- Cookie deletion rebuilds the correct URL from the cookie domain/path and preserves `storeId` and `partitionKey` when present.
- Cookie edits that change identity fields clean up the replaced cookie to avoid leaving stale entries behind.
- Web storage operations run inside the active tab using `chrome.scripting.executeScript`.
- A lightweight hash signature avoids repainting the grid when live-sync sees no data changes.
- Live-sync runs every 1.5 seconds and also listens for cookie changes, tab activation, tab updates, and panel visibility changes.
- The grid escapes inserted values before rendering editable rows.

## Limitations

- Chrome internal pages, extension pages, and other restricted URLs may block `chrome.scripting` or storage access.
- Web storage is page-context storage. `sessionStorage` is scoped to the active tab/session and is not shared across tabs.
- Cookie visibility follows the Chrome cookies API and the active tab URL, so not every cookie in a browser profile is necessarily listed.
- Import does not validate that the snapshot came from the same host as the current active tab.
- There is currently no automated test suite or packaging script in this repository.

## Privacy

The extension does not send storage data to a remote service. Cookie and web storage data stays in the browser unless you explicitly export it to a JSON file or copy row data through the context menu.

## Development

After changing files, reload the extension from `chrome://extensions` and reopen the side panel. For changes in the service worker, use the extension details page to inspect or reload the worker if Chrome keeps an old instance alive.

Before publishing publicly, consider adding a license file and verifying that the broad `<all_urls>` host permission matches your distribution requirements.
