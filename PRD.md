# Confluence to Notion Browser Extension - PRD

## 1. Overview

### 1.1 Product Name
**Confluence2Notion** - A browser extension that converts Confluence pages to Markdown and imports them directly into Notion.

### 1.2 Problem Statement
Users with private/self-hosted Confluence instances need a simple way to migrate or sync content to Notion without using server-side APIs or complex migration tools.

### 1.3 Solution
A browser extension that runs client-side, reading Confluence page content from the DOM, converting it to Markdown, and pushing it to Notion via the public API.

---

## 2. User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US1 | Confluence user | Click a button to export current page to Notion | I can quickly migrate content without manual copy-paste |
| US2 | User | Configure my Notion API token and target page | The extension knows where to send content |
| US3 | User | See a preview of the Markdown before sending | I can verify the conversion quality |
| US4 | User | Get feedback on success/failure | I know if the import worked |
| US5 | User | Preserve images and attachments | My content is complete in Notion |

---

## 3. Functional Requirements

### 3.1 Core Features (MVP)

#### F1: Confluence Page Detection
- Detect when user is on a Confluence page
- Support both Confluence Cloud and Confluence Server/Data Center
- Extract page title and content from DOM

#### F2: HTML to Markdown Conversion
- Convert Confluence HTML content to clean Markdown
- Handle common elements:
  - Headings (h1-h6)
  - Paragraphs
  - Bold, italic, strikethrough
  - Ordered and unordered lists
  - Code blocks (inline and multi-line)
  - Tables
  - Links
  - Images (convert to URL references)
  - Blockquotes
- Handle Confluence-specific elements:
  - Info/Warning/Note panels → Callout blocks
  - Status macros
  - User mentions
  - Page links

#### F3: Notion API Integration
- Authenticate with Notion Integration Token
- Create new page under specified parent page
- Convert Markdown to Notion blocks
- Handle API rate limits and errors

#### F4: User Interface
- **Popup UI**:
  - Settings: API Token input, Default parent page ID
  - Quick action button: "Send to Notion"
  - Status indicator
- **Content Script UI** (optional):
  - Floating button on Confluence pages
  - Preview modal

#### F5: Configuration Storage
- Store settings in Chrome storage (sync)
- Settings:
  - `notionApiToken`: string (encrypted/obscured in UI)
  - `defaultParentPageId`: string
  - `includeImages`: boolean
  - `addSourceLink`: boolean (add link back to Confluence)

### 3.2 Future Features (Post-MVP)
- Batch export multiple pages
- Two-way sync
- Custom Markdown templates
- Confluence Space → Notion Database mapping
- Image upload to Notion (not just URL reference)

---

## 4. Technical Architecture

### 4.1 Extension Structure (Manifest V3)

```
confluence-to-notion-extension/
├── manifest.json           # Extension manifest (V3)
├── src/
│   ├── background/
│   │   └── service-worker.js   # Background service worker
│   ├── content/
│   │   ├── confluence-parser.js # DOM parsing logic
│   │   └── content-script.js    # Main content script
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   ├── lib/
│   │   ├── turndown.js         # HTML to Markdown library
│   │   ├── turndown-plugin-gfm.js
│   │   └── notion-client.js    # Notion API wrapper
│   └── utils/
│       ├── storage.js          # Chrome storage helpers
│       └── markdown-to-notion.js # MD to Notion blocks converter
├── assets/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── .cursorrules
└── README.md
```

### 4.2 Data Flow

```
┌──────────────────┐
│  Confluence Page │
│       DOM        │
└────────┬─────────┘
         │ Content Script reads DOM
         ▼
┌──────────────────┐
│  confluence-     │
│  parser.js       │
│  (Extract HTML)  │
└────────┬─────────┘
         │ Clean HTML content
         ▼
┌──────────────────┐
│   Turndown.js    │
│  (HTML → MD)     │
└────────┬─────────┘
         │ Markdown string
         ▼
┌──────────────────┐
│ markdown-to-     │
│ notion.js        │
│ (MD → Blocks)    │
└────────┬─────────┘
         │ Notion block objects
         ▼
┌──────────────────┐
│  notion-client   │
│  (API call)      │
└────────┬─────────┘
         │ HTTP POST
         ▼
┌──────────────────┐
│   Notion API     │
│ (Create Page)    │
└──────────────────┘
```

### 4.3 Key Libraries

| Library | Purpose | CDN/NPM |
|---------|---------|---------|
| Turndown | HTML to Markdown conversion | npm: turndown |
| turndown-plugin-gfm | GFM support (tables, strikethrough) | npm: turndown-plugin-gfm |
| @notionhq/client | Notion API client (optional, can use fetch) | npm: @notionhq/client |

### 4.4 Notion API Endpoints

| Action | Endpoint | Method |
|--------|----------|--------|
| Create Page | `https://api.notion.com/v1/pages` | POST |
| Append Blocks | `https://api.notion.com/v1/blocks/{id}/children` | PATCH |
| Get Page | `https://api.notion.com/v1/pages/{id}` | GET |

---

## 5. Confluence DOM Selectors

### 5.1 Confluence Cloud
```javascript
const selectors = {
  pageTitle: '[data-testid="title-text"]',
  pageContent: '#content .wiki-content',
  // Alternative selectors
  altPageTitle: '.page-title-text',
  altPageContent: '#main-content',
};
```

### 5.2 Confluence Server/Data Center
```javascript
const selectors = {
  pageTitle: '#title-text',
  pageContent: '#main-content .wiki-content',
  // Alternative
  altPageContent: '.confluence-content',
};
```

---

## 6. Notion Block Mapping

| Markdown | Notion Block Type |
|----------|-------------------|
| `# Heading` | heading_1 |
| `## Heading` | heading_2 |
| `### Heading` | heading_3 |
| Paragraph | paragraph |
| `- item` | bulleted_list_item |
| `1. item` | numbered_list_item |
| `> quote` | quote |
| ``` code ``` | code |
| `---` | divider |
| `![](url)` | image |
| `[text](url)` | paragraph with link |
| Table | table + table_row |
| `- [ ] task` | to_do |

---

## 7. Error Handling

| Error Type | User Message | Action |
|------------|--------------|--------|
| Not on Confluence page | "Please navigate to a Confluence page" | Disable button |
| No API token configured | "Please set your Notion API token in settings" | Open settings |
| Invalid API token | "Invalid Notion API token" | Prompt reconfiguration |
| Page not shared with integration | "Please share the Notion page with your integration" | Show instructions |
| Rate limited | "Rate limited. Retrying in X seconds..." | Auto-retry with backoff |
| Network error | "Network error. Please check your connection" | Show retry button |

---

## 8. Security Considerations

1. **API Token Storage**: Store in `chrome.storage.sync` (encrypted by Chrome)
2. **Content Security**: Sanitize HTML before processing
3. **Permissions**: Request minimal permissions
   - `activeTab` - Access current tab only when clicked
   - `storage` - Store settings
   - No `<all_urls>` needed if using activeTab

---

## 9. UI/UX Design

### 9.1 Popup States

**State 1: Not Configured**
```
┌─────────────────────────────┐
│  ⚙️ Confluence2Notion       │
├─────────────────────────────┤
│                             │
│  Please configure settings  │
│                             │
│  Notion API Token:          │
│  [____________________]     │
│                             │
│  Parent Page ID:            │
│  [____________________]     │
│                             │
│  [Save Settings]            │
│                             │
└─────────────────────────────┘
```

**State 2: Ready (on Confluence page)**
```
┌─────────────────────────────┐
│  ⚙️ Confluence2Notion       │
├─────────────────────────────┤
│                             │
│  📄 "Current Page Title"    │
│                             │
│  Target: My Notion Page     │
│  [Change]                   │
│                             │
│  ☑️ Include images          │
│  ☑️ Add source link         │
│                             │
│  [🚀 Send to Notion]        │
│                             │
└─────────────────────────────┘
```

**State 3: Processing**
```
┌─────────────────────────────┐
│  ⚙️ Confluence2Notion       │
├─────────────────────────────┤
│                             │
│       ⏳ Sending...         │
│                             │
│  Converting to Markdown...  │
│  ████████░░░░░ 60%          │
│                             │
└─────────────────────────────┘
```

**State 4: Success**
```
┌─────────────────────────────┐
│  ⚙️ Confluence2Notion       │
├─────────────────────────────┤
│                             │
│       ✅ Success!           │
│                             │
│  Page created in Notion     │
│  [Open in Notion]           │
│                             │
└─────────────────────────────┘
```

---

## 10. Testing Plan

### 10.1 Unit Tests
- Turndown conversion accuracy
- Notion block generation
- Storage operations

### 10.2 Integration Tests
- Full flow: Confluence → Notion
- Error handling scenarios

### 10.3 Manual Testing
- Confluence Cloud
- Confluence Server 7.x
- Confluence Data Center
- Various page complexities

---

## 11. Success Metrics

| Metric | Target |
|--------|--------|
| Conversion accuracy | > 95% for standard content |
| Time to export (avg page) | < 5 seconds |
| User error rate | < 10% |

---

## 12. Development Phases

### Phase 1: MVP (Week 1-2)
- Basic extension structure
- Confluence DOM parsing
- HTML to Markdown conversion
- Notion API integration
- Simple popup UI

### Phase 2: Polish (Week 3)
- Error handling
- UI improvements
- Edge case handling
- Testing

### Phase 3: Enhancements (Week 4+)
- Image handling
- Confluence macros support
- Batch operations

---

## Appendix A: Sample Notion API Request

```javascript
// Create a page in Notion
const response = await fetch('https://api.notion.com/v1/pages', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28'
  },
  body: JSON.stringify({
    parent: { page_id: parentPageId },
    properties: {
      title: {
        title: [{ text: { content: pageTitle } }]
      }
    },
    children: notionBlocks // Array of block objects
  })
});
```

## Appendix B: Turndown Configuration

```javascript
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
  strongDelimiter: '**',
});

// Add GFM plugin for tables and strikethrough
turndownService.use(turndownPluginGfm.gfm);

// Custom rule for Confluence info panels
turndownService.addRule('confluencePanel', {
  filter: (node) => {
    return node.classList && node.classList.contains('confluence-information-macro');
  },
  replacement: (content, node) => {
    return `> ℹ️ **Info**\n> ${content.trim()}\n\n`;
  }
});
```
