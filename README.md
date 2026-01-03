# Confluence2Notion Browser Extension

A Chrome/Edge browser extension that converts Confluence pages to Markdown and imports them directly into Notion.

## Features

- 🔄 One-click export from Confluence to Notion
- 📝 Converts HTML to clean Markdown
- 🏢 Works with private/self-hosted Confluence instances
- 🎨 Preserves formatting: headings, lists, code blocks, tables, images
- 🔗 Optionally adds source link back to Confluence
- ⚡ No server-side setup required

## Installation

### Development/Local Installation

1. Clone or download this repository
2. Download required libraries (see below)
3. Open Chrome/Edge and go to `chrome://extensions`
4. Enable "Developer mode" (toggle in top right)
5. Click "Load unpacked"
6. Select the `confluence-to-notion-extension` folder

### Required Libraries

Download these files and place them in `src/lib/`:

1. **Turndown.js** - HTML to Markdown converter
   - Download from: https://unpkg.com/turndown/dist/turndown.js
   - Save as: `src/lib/turndown.js`

2. **Turndown GFM Plugin** - GitHub Flavored Markdown support
   - Download from: https://unpkg.com/turndown-plugin-gfm/dist/turndown-plugin-gfm.js
   - Save as: `src/lib/turndown-plugin-gfm.js`

Or use npm:
```bash
npm install turndown turndown-plugin-gfm
# Then copy from node_modules to src/lib/
```

## Setup

### 1. Create a Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Give it a name (e.g., "Confluence2Notion")
4. Select the workspace
5. Click "Submit"
6. Copy the "Internal Integration Token" (starts with `secret_`)

### 2. Share Notion Page with Integration

1. Open the Notion page where you want to import content
2. Click "Share" in the top right
3. Click "Invite"
4. Select your integration
5. Click "Invite"

### 3. Get Parent Page ID

1. Open the target Notion page in your browser
2. Copy the page ID from the URL:
   - URL: `https://notion.so/My-Page-1234567890abcdef1234567890abcdef`
   - Page ID: `1234567890abcdef1234567890abcdef`

### 4. Configure the Extension

1. Click the extension icon
2. Enter your Notion API Token
3. Enter the Parent Page ID
4. Click "Save Settings"

## Usage

1. Navigate to any Confluence page
2. Click the extension icon
3. Click "Send to Notion"
4. Wait for the import to complete
5. Click "Open in Notion" to view your imported page

## Supported Confluence Elements

| Element | Status |
|---------|--------|
| Headings (h1-h6) | ✅ |
| Paragraphs | ✅ |
| Bold, Italic, Strikethrough | ✅ |
| Ordered Lists | ✅ |
| Unordered Lists | ✅ |
| Code Blocks | ✅ |
| Inline Code | ✅ |
| Links | ✅ |
| Images | ✅ |
| Tables | ✅ |
| Blockquotes | ✅ |
| Info/Warning Panels | ✅ (as callouts) |
| Task Lists | ✅ |
| User Mentions | ⚠️ (as @username) |
| Attachments | ⚠️ (as links) |

## Project Structure

```
confluence-to-notion-extension/
├── manifest.json           # Extension manifest (V3)
├── src/
│   ├── background/
│   │   └── service-worker.js   # Notion API calls
│   ├── content/
│   │   ├── confluence-parser.js # DOM parsing
│   │   └── content-script.js    # Content script
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── lib/
│       ├── turndown.js         # (download required)
│       └── turndown-plugin-gfm.js  # (download required)
├── assets/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── PRD.md                  # Product requirements
├── .cursorrules            # Cursor AI rules
└── README.md
```

## Development

### Using Cursor IDE

This project includes a `.cursorrules` file optimized for AI-assisted development with Cursor IDE.

### Testing

1. Make changes to the code
2. Go to `chrome://extensions`
3. Click the refresh icon on the extension card
4. Test on a Confluence page

### Debugging

- Open DevTools on the Confluence page to see content script logs
- Click "Service Worker" link in `chrome://extensions` to see background logs
- Right-click extension icon → "Inspect Popup" for popup logs

## Troubleshooting

### "Not a Confluence page"
- Make sure you're on an actual Confluence page, not the dashboard
- Try refreshing the page

### "Invalid API token"
- Verify your token starts with `secret_`
- Make sure you copied the entire token

### "Page not shared with integration"
- Go to the Notion page and share it with your integration
- Parent pages must be shared, not just child pages

### Content missing or broken
- Some Confluence macros may not convert perfectly
- Complex nested structures might need manual adjustment
- Check the browser console for errors

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Credits

- [Turndown](https://github.com/mixmark-io/turndown) - HTML to Markdown converter
- [Notion API](https://developers.notion.com/) - Notion's public API
