# Grok Search Chrome Extension

A Chrome extension that allows users to search selected text on a webpage using Grok (grok.com) via a right-click context menu. Users can add optional extra text in a popup before initiating the search.

## Features
- Right-click context menu option to "Search with Grok" on selected text.
- Custom popup for adding optional extra text to the search query.
- Injects the query into grok.com's search field.
- Supports Enter key for submitting the popup form.

## Installation
1. Clone the repository: `git clone https://github.com/digitallyamar/grok-search-extension.git`
2. Open Chrome and go to `chrome://extensions/`.
3. Enable "Developer mode" and click "Load unpacked".
4. Select the `grok-search-extension` directory.

## Development
- **Files**:
  - `manifest.json`: Extension configuration.
  - `background.js`: Handles context menu and popup logic.
  - `content.js`: Injects queries on grok.com.
  - `popup.html`: Popup UI with inline CSS.
  - `icon.png`: Extension icon (48x48 PNG).
- **Future Plans**:
  - Add dynamic popup positioning near the cursor.
  - Implement clipboard fallback for query injection.
  - Support xAI API for direct search results.

## License
MIT License (see LICENSE file).