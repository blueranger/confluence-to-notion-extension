/**
 * Confluence2Notion - Background Service Worker
 * Handles Notion API calls and coordinates extension operations
 */

// Pre-load JSZip library using importScripts (CSP-compliant)
// This must be at the top level, not inside async functions
// JSZip UMD will assign to self.JSZip in Service Worker context
try {
  importScripts(chrome.runtime.getURL('src/lib/jszip.min.js'));
} catch (error) {
  console.error('Confluence2Notion: Failed to pre-load JSZip', error);
  // JSZip will be undefined if loading fails, we'll handle this in the handler
}

// ============================================================================
// Constants
// ============================================================================
const NOTION_API_VERSION = '2022-06-28';
const NOTION_API_BASE = 'https://api.notion.com/v1';

// ============================================================================
// Notion API Client
// ============================================================================
/**
 * Make a request to Notion API
 * @param {string} endpoint - API endpoint
 * @param {string} method - HTTP method
 * @param {Object} body - Request body
 * @param {string} apiToken - Notion API token
 * @returns {Promise<Object>} API response
 */
async function notionRequest(endpoint, method, body, apiToken) {
  const url = `${NOTION_API_BASE}${endpoint}`;
  
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_API_VERSION,
    },
  };
  
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.message || `API error: ${response.status}`);
  }
  
  return data;
}

// ============================================================================
// Markdown to Notion Blocks Converter
// ============================================================================
/**
 * Convert Markdown text to Notion blocks
 * @param {string} markdown - Markdown content
 * @returns {Array} Notion block objects
 */
function markdownToNotionBlocks(markdown) {
  console.log('Confluence2Notion: ===== MARKDOWN INPUT START =====');
  console.log('Confluence2Notion: Full markdown length:', markdown.length);
  console.log('Confluence2Notion: Full markdown:', markdown);
  console.log('Confluence2Notion: ===== MARKDOWN INPUT END =====');
  
  const blocks = [];
  const lines = markdown.split('\n');
  
  console.log('Confluence2Notion: Total lines:', lines.length);
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    // Skip empty lines (but preserve structure)
    if (line.trim() === '') {
      i++;
      continue;
    }
    
    // Code blocks (fenced) - handle both regular and indented code blocks
    // Match ``` at start of line or with leading whitespace
    // Pattern: optional whitespace + ``` + optional space + optional language
    const trimmedLine = line.trimStart();
    const leadingSpaces = line.length - trimmedLine.length;
    
    if (trimmedLine.startsWith('```')) {
      // Extract language from after ```
      const afterFence = trimmedLine.slice(3).trim();
      const language = afterFence || 'plain text';
      const indent = line.slice(0, leadingSpaces);
      const codeLines = [];
      i++;
      
      // Look for closing ```
      while (i < lines.length) {
        const currentLine = lines[i];
        const currentTrimmed = currentLine.trimStart();
        
        // Check if this line is the closing fence
        if (currentTrimmed.startsWith('```') && currentTrimmed.trim() === '```') {
          break;
        }
        
        // Remove the same indentation from code lines if present
        if (indent && currentLine.startsWith(indent)) {
          codeLines.push(currentLine.slice(indent.length));
        } else {
          codeLines.push(currentLine);
        }
        i++;
      }
      
      const codeContent = codeLines.join('\n');
      
      // Debug: log code block conversion
      console.log('Confluence2Notion: Converting code block', {
        language: language,
        contentLength: codeContent.length,
        contentPreview: codeContent.substring(0, 100),
        lineCount: codeLines.length,
        hadIndent: leadingSpaces > 0
      });
      
      blocks.push(createCodeBlock(codeContent, language));
      i++; // Skip closing ```
      continue;
    }
    
    // Headings (h1-h6)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      blocks.push(createHeadingBlock(level, text));
      i++;
      continue;
    }
    
    // Horizontal rule
    if (line.match(/^(-{3,}|_{3,}|\*{3,})$/)) {
      blocks.push(createDividerBlock());
      i++;
      continue;
    }
    
    // Tables - check before lists to avoid misidentification
    // A table line should contain at least one pipe and look like a table row
    if (line.includes('|')) {
      // More flexible table detection: allow lines that start with | or have | in the middle
      const looksLikeTableRow = line.match(/^\s*\|.+\|\s*$/) || 
                                (line.match(/\|/) && line.split('|').length >= 2);
      
      if (looksLikeTableRow) {
        const tableData = parseTable(lines, i);
        if (tableData && tableData.headers.length > 0) {
          blocks.push(createTableBlock(tableData.headers, tableData.rows));
          i = tableData.nextIndex;
          continue;
        }
      }
    }
    
    // Blockquotes (check for callout pattern)
    if (line.startsWith('> ')) {
      const quoteData = parseBlockquote(lines, i);
      if (quoteData.isCallout) {
        blocks.push(createCalloutBlock(quoteData.content, quoteData.emoji, quoteData.type));
      } else {
        blocks.push(createQuoteBlock(quoteData.content));
      }
      i = quoteData.nextIndex;
      continue;
    }
    
    // Lists (with nesting support)
    const listData = parseList(lines, i);
    if (listData) {
      console.log('Confluence2Notion: Parsed list', {
        startLine: i,
        endLine: listData.nextIndex,
        blockCount: listData.blocks.length,
        firstBlockContent: listData.blocks[0]?.[listData.blocks[0].type]?.rich_text?.[0]?.text?.content?.substring(0, 50)
      });
      blocks.push(...listData.blocks);
      i = listData.nextIndex;
      continue;
    }
    
    // Images
    const imageMatch = line.match(/^!\[(.*?)\]\((.*?)\)$/);
    if (imageMatch) {
      blocks.push(createImageBlock(imageMatch[2], imageMatch[1]));
      i++;
      continue;
    }
    
    // Check for flowchart/process flow patterns (lines with arrows)
    // These should be preserved as paragraphs but with special formatting
    const hasArrow = line.includes('→') || line.includes('->');
    if (hasArrow) {
      // Check for flowchart pattern with different arrow types (avoid character class issues)
      const pattern1 = /[A-Z][a-z]+(?:\s*→\s*[A-Z][a-z]+)+/;
      const pattern2 = /[A-Z][a-z]+(?:\s*->\s*[A-Z][a-z]+)+/;
      const hasPattern = pattern1.test(line) || pattern2.test(line);
      const hasMultipleParts = line.split(/→|->/).length >= 3;
      
      if (hasPattern || hasMultipleParts) {
        // This looks like a flowchart line - preserve it as-is
        blocks.push(createParagraphBlock(line));
        i++;
        continue;
      }
    }
    
    // Default: paragraph
    blocks.push(createParagraphBlock(line));
    i++;
  }
  
  return blocks;
}

// ============================================================================
// Block Creators
// ============================================================================
/**
 * Parse inline Markdown to Notion rich text
 * Supports: bold, italic, strikethrough, code, links
 * @param {string} text - Text with inline Markdown
 * @returns {Array} Notion rich text array
 */
function parseInlineMarkdown(text) {
  if (!text || !text.trim()) {
    return [{ type: 'text', text: { content: '' } }];
  }
  
  // Tokenize the text with all markdown patterns
  const tokens = [];
  let pos = 0;
  const textLength = text.length;
  
  // Pattern order matters: more specific patterns first
  const patterns = [
    // Code (backticks) - highest priority, can't contain other formatting
    { regex: /`([^`]+)`/g, type: 'code' },
    // Bold (double asterisk or underscore)
    { regex: /\*\*([^*]+)\*\*/g, type: 'bold' },
    { regex: /__(?!_)([^_]+)__/g, type: 'bold' },
    // Strikethrough
    { regex: /~~([^~]+)~~/g, type: 'strikethrough' },
    // Italic (single asterisk or underscore, but not if followed by asterisk/underscore)
    { regex: /(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)/g, type: 'italic' },
    { regex: /(?<!_)_(?!_)([^_]+?)_(?!_)/g, type: 'italic' },
    // Links
    { regex: /\[([^\]]+)\]\(([^)]+)\)/g, type: 'link' },
  ];
  
  // Find all matches with their positions
  const matches = [];
  patterns.forEach(({ regex, type }) => {
    let match;
    regex.lastIndex = 0; // Reset regex
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        type,
        content: match[1] || match[0],
        link: match[2], // For links
        fullMatch: match[0],
      });
    }
  });
  
  // Sort matches by position
  matches.sort((a, b) => a.start - b.start);
  
  // Remove overlapping matches (keep first/outermost)
  const nonOverlapping = [];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    let overlaps = false;
    
    for (let j = 0; j < nonOverlapping.length; j++) {
      const existing = nonOverlapping[j];
      // Check if current overlaps with existing
      if (!(current.end <= existing.start || current.start >= existing.end)) {
        overlaps = true;
        break;
      }
    }
    
    if (!overlaps) {
      nonOverlapping.push(current);
    }
  }
  
  // Build rich text array
  const richText = [];
  let lastIndex = 0;
  
  nonOverlapping.forEach(match => {
    // Add plain text before match
    if (match.start > lastIndex) {
      const plainText = text.slice(lastIndex, match.start);
      if (plainText) {
        richText.push(createRichTextSegment(plainText));
      }
    }
    
    // Add formatted text
    const annotations = {};
    let content = match.content;
    let link = null;
    
    if (match.type === 'bold') {
      annotations.bold = true;
    } else if (match.type === 'italic') {
      annotations.italic = true;
    } else if (match.type === 'strikethrough') {
      annotations.strikethrough = true;
    } else if (match.type === 'code') {
      annotations.code = true;
    } else if (match.type === 'link') {
      // Validate URL before creating link
      const validUrl = validateAndCleanUrl(match.link);
      if (validUrl) {
        link = { url: validUrl };
      } else {
        // Invalid URL - convert link to plain text
        console.warn('Confluence2Notion: Invalid link URL, converting to text:', match.link);
        // Don't set link, so it will be rendered as plain text
      }
    }
    
    // For code and links, don't parse nested formatting
    if (match.type === 'code' || match.type === 'link') {
      // If link is invalid, render as plain text (link will be null)
      richText.push(createRichTextSegment(content, annotations, link || null));
    } else {
      // For other types, recursively parse nested formatting
      // But avoid infinite recursion by checking if content has formatting
      const hasNestedFormatting = /(\*\*|__|\*|_|~~|`|\[)/.test(content);
      
      if (hasNestedFormatting) {
        const nested = parseInlineMarkdown(content);
        nested.forEach(segment => {
          // Merge annotations (parent + child)
          const mergedAnnotations = { ...annotations };
          if (segment.annotations) {
            Object.assign(mergedAnnotations, segment.annotations);
          }
          
          // Validate link URL if present
          let finalLink = link || segment.text?.link;
          if (finalLink && finalLink.url) {
            const validUrl = validateAndCleanUrl(finalLink.url);
            if (!validUrl) {
              finalLink = null; // Remove invalid link
            } else {
              finalLink = { url: validUrl };
            }
          }
          
          richText.push({
            ...segment,
            annotations: Object.keys(mergedAnnotations).length > 0 ? mergedAnnotations : undefined,
            text: {
              ...segment.text,
              link: finalLink || undefined,
            },
          });
        });
      } else {
        // No nested formatting, just apply current annotations
        richText.push(createRichTextSegment(content, annotations, link));
      }
    }
    
    lastIndex = match.end;
  });
  
  // Add remaining plain text
  if (lastIndex < textLength) {
    const plainText = text.slice(lastIndex);
    if (plainText) {
      richText.push(createRichTextSegment(plainText));
    }
  }
  
  // Handle text that exceeds Notion's 2000 character limit per rich_text item
  const MAX_TEXT_LENGTH = 2000;
  const result = [];
  
  richText.forEach(segment => {
    const content = segment.text?.content || '';
    if (content.length <= MAX_TEXT_LENGTH) {
      result.push(segment);
    } else {
      // Split long text into multiple segments
      for (let i = 0; i < content.length; i += MAX_TEXT_LENGTH) {
        const chunk = content.slice(i, i + MAX_TEXT_LENGTH);
        result.push(createRichTextSegment(chunk, segment.annotations, segment.text?.link));
      }
    }
  });
  
  return result.length > 0 ? result : [{ type: 'text', text: { content: '' } }];
}

/**
 * Validate and clean URL
 * @param {string} url - URL to validate
 * @returns {string|null} Valid URL or null if invalid
 */
function validateAndCleanUrl(url) {
  if (!url || !url.trim()) {
    return null;
  }
  
  const trimmed = url.trim();
  
  // Check if it's already a valid HTTP/HTTPS URL
  if (/^https?:\/\/.+/.test(trimmed)) {
    try {
      const urlObj = new URL(trimmed);
      // Only allow http and https protocols
      if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
        // Clean up the URL (remove fragments, normalize)
        return urlObj.href;
      }
    } catch (error) {
      // Invalid URL format
      console.warn('Confluence2Notion: Invalid URL format:', trimmed, error);
      return null;
    }
  }
  
  // Try to fix common issues
  // If it starts with //, add https:
  if (trimmed.startsWith('//')) {
    try {
      const urlObj = new URL('https:' + trimmed);
      return urlObj.href;
    } catch (error) {
      console.warn('Confluence2Notion: Failed to fix protocol-relative URL:', trimmed, error);
      return null;
    }
  }
  
  // If it's a relative URL, we can't use it in Notion (Notion requires absolute URLs)
  // But we should log a warning so users know why images aren't showing
  if (trimmed.startsWith('/') || !trimmed.includes('://')) {
    console.warn('Confluence2Notion: Relative URL cannot be used in Notion:', trimmed);
    return null;
  }
  
  return null;
}

/**
 * Create a rich text segment
 * @param {string} content - Text content
 * @param {Object} annotations - Formatting annotations
 * @param {Object} link - Link object
 * @returns {Object} Rich text segment
 */
function createRichTextSegment(content, annotations = {}, link = null) {
  const segment = {
    type: 'text',
    text: {
      content: content,
    },
  };
  
  // Validate link URL before adding
  if (link && link.url) {
    const validUrl = validateAndCleanUrl(link.url);
    if (validUrl) {
      segment.text.link = { url: validUrl };
    } else {
      // Invalid URL - remove link but keep text
      console.warn('Confluence2Notion: Invalid URL removed:', link.url);
    }
  }
  
  if (Object.keys(annotations).length > 0) {
    segment.annotations = annotations;
  }
  
  return segment;
}

function createParagraphBlock(text) {
  return {
    type: 'paragraph',
    paragraph: {
      rich_text: parseInlineMarkdown(text),
    },
  };
}

function createHeadingBlock(level, text) {
  // Notion supports heading_1 through heading_3
  const type = `heading_${Math.min(Math.max(level, 1), 3)}`;
  return {
    type,
    [type]: {
      rich_text: parseInlineMarkdown(text),
    },
  };
}

function createBulletedListItem(text) {
  const block = {
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: parseInlineMarkdown(text),
    },
  };
  return block;
}

function createNumberedListItem(text) {
  const block = {
    type: 'numbered_list_item',
    numbered_list_item: {
      rich_text: parseInlineMarkdown(text),
    },
  };
  return block;
}

function createTodoBlock(text, checked = false) {
  return {
    type: 'to_do',
    to_do: {
      rich_text: parseInlineMarkdown(text),
      checked,
    },
  };
}

function createQuoteBlock(text) {
  return {
    type: 'quote',
    quote: {
      rich_text: parseInlineMarkdown(text),
    },
  };
}

function createCodeBlock(code, language = 'plain text') {
  // Normalize language name
  const normalizedLang = normalizeLanguage(language);
  
  // Ensure code is a string and preserve all content
  // Normalize line endings (CRLF -> LF, CR -> LF)
  const codeString = String(code || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Split long code blocks (Notion has limits)
  const MAX_CODE_LENGTH = 2000;
  if (codeString.length <= MAX_CODE_LENGTH) {
    const block = {
      type: 'code',
      code: {
        rich_text: [{ type: 'text', text: { content: codeString } }],
        language: normalizedLang,
      },
    };
    
    // Debug: log final code block
    console.log('Confluence2Notion: Created code block', {
      language: normalizedLang,
      contentLength: codeString.length,
      contentPreview: codeString.substring(0, 100),
      originalLanguage: language
    });
    
    return block;
  }
  
  // For very long code blocks, we'll create multiple blocks
  // Note: This is a limitation - Notion doesn't support splitting code blocks
  // So we'll truncate with a note
  const truncated = codeString.slice(0, MAX_CODE_LENGTH - 100) + '\n\n... (truncated, original code too long) ...';
  
  console.warn('Confluence2Notion: Code block truncated', {
    originalLength: codeString.length,
    truncatedLength: truncated.length,
    language: normalizedLang,
    originalLanguage: language
  });
  
  return {
    type: 'code',
    code: {
      rich_text: [{ 
        type: 'text', 
        text: { content: truncated } 
      }],
      language: normalizedLang,
    },
  };
}

/**
 * Normalize programming language name to Notion's supported languages
 * @param {string} lang - Language name
 * @returns {string} Normalized language
 */
function normalizeLanguage(lang) {
  // Valid Notion API languages (from the error message)
  const validNotionLanguages = new Set([
    'abap', 'abc', 'agda', 'arduino', 'ascii art', 'assembly', 'bash', 'basic', 'bnf',
    'c', 'c#', 'c++', 'clojure', 'coffeescript', 'coq', 'css', 'dart', 'dhall', 'diff',
    'docker', 'ebnf', 'elixir', 'elm', 'erlang', 'f#', 'flow', 'fortran', 'gherkin',
    'glsl', 'go', 'graphql', 'groovy', 'haskell', 'hcl', 'html', 'idris', 'java',
    'javascript', 'json', 'julia', 'kotlin', 'latex', 'less', 'lisp', 'livescript',
    'llvm ir', 'lua', 'makefile', 'markdown', 'markup', 'matlab', 'mathematica', 'mermaid',
    'nix', 'notion formula', 'objective-c', 'ocaml', 'pascal', 'perl', 'php', 'plain text',
    'powershell', 'prolog', 'protobuf', 'purescript', 'python', 'r', 'racket', 'reason',
    'ruby', 'rust', 'sass', 'scala', 'scheme', 'scss', 'shell', 'smalltalk', 'solidity',
    'sql', 'swift', 'toml', 'typescript', 'vb.net', 'verilog', 'vhdl', 'visual basic',
    'webassembly', 'xml', 'yaml', 'java/c/c++/c#'
  ]);

  const langMap = {
    // Common aliases
    'js': 'javascript',
    'ts': 'typescript',
    'py': 'python',
    'rb': 'ruby',
    'sh': 'bash',
    'shell': 'shell',
    'zsh': 'shell',
    'yml': 'yaml',
    'md': 'markdown',
    'cpp': 'c++',
    'csharp': 'c#',
    'cs': 'c#',
    'fsharp': 'f#',
    'fs': 'f#',
    'rs': 'rust',
    'objc': 'objective-c',
    'obj-c': 'objective-c',
    'vb': 'visual basic',
    'tex': 'latex',
    'dockerfile': 'docker',
    'make': 'makefile',
    'asm': 'assembly',
    'wasm': 'webassembly',
    'gql': 'graphql',
    'hbs': 'markup',
    'handlebars': 'markup',
    'pug': 'markup',
    'jade': 'markup',
    // Plain text aliases
    'text': 'plain text',
    'txt': 'plain text',
    'plaintext': 'plain text',
    'none': 'plain text',
    '': 'plain text',
    'f#': 'fsharp',
    'vb': 'vb',
    'vbnet': 'vb',
    'csharp': 'csharp',
    'c#': 'csharp',
    'powershell': 'powershell',
    'ps1': 'powershell',
    'dockerfile': 'dockerfile',
    'makefile': 'makefile',
    'cmake': 'makefile',
    'diff': 'diff',
    'patch': 'diff',
  };
  
  if (!lang || !lang.trim()) {
    return 'plain text';
  }
  
  const normalized = lang.toLowerCase().trim();
  
  // First check our mapping
  if (langMap[normalized]) {
    return langMap[normalized];
  }
  
  // Then check if it's already a valid Notion language
  if (validNotionLanguages.has(normalized)) {
    return normalized;
  }
  
  // If not valid, return plain text
  console.warn(`Confluence2Notion: Unknown language "${lang}", defaulting to plain text`);
  return 'plain text';
}

function createImageBlock(url, caption = '') {
  // Validate and clean image URL
  const validUrl = validateAndCleanUrl(url);
  
  if (!validUrl) {
    // Invalid URL - create a callout block with the image link
    // This helps users know there was an image and they can manually upload it
    console.warn('Confluence2Notion: Invalid image URL, creating placeholder:', url);
    
    const imageText = caption ? `Image: ${caption}` : 'Image';
    const imageUrl = url || 'N/A';
    const isValidHttpUrl = imageUrl.startsWith('http://') || imageUrl.startsWith('https://');
    
    // Create a callout with the image URL as a link (if it's a valid HTTP URL)
    const richText = [
      {
        type: 'text',
        text: {
          content: imageText,
        },
      },
    ];
    
    if (isValidHttpUrl) {
      // Add link to view original image
      richText.push({
        type: 'text',
        text: {
          content: ' - View original image',
          link: { url: imageUrl },
        },
      });
    } else {
      // Add the URL as text if it's not a valid HTTP URL
      richText.push({
        type: 'text',
        text: {
          content: ` - URL: ${imageUrl}`,
        },
      });
    }
    
    return {
      type: 'callout',
      callout: {
        rich_text: richText,
        icon: { emoji: '🖼️' },
        color: 'yellow_background',
      },
    };
  }
  
  // Log successful image conversion for debugging
  console.log('Confluence2Notion: Creating image block with URL:', validUrl);
  
  return {
    type: 'image',
    image: {
      type: 'external',
      external: { url: validUrl },
      caption: caption ? parseInlineMarkdown(caption) : [],
    },
  };
}

function createDividerBlock() {
  return {
    type: 'divider',
    divider: {},
  };
}

// ============================================================================
// Table Parser
// ============================================================================
/**
 * Parse Markdown table
 * @param {Array<string>} lines - All lines
 * @param {number} startIndex - Starting line index
 * @returns {Object|null} Table data or null
 */
function parseTable(lines, startIndex) {
  const tableLines = [];
  let i = startIndex;
  let foundSeparator = false;
  
  // Collect table lines
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Check if this looks like a table separator row
    const isSeparator = trimmed.match(/^\|[\s\-:]+(\|[\s\-:]+)*\|\s*$/) ||
                        trimmed.match(/^[\s\-:]+(\|[\s\-:]+)+[\s\-:]*$/);
    
    if (isSeparator) {
      foundSeparator = true;
      i++;
      continue;
    }
    
    // Check if this is a table row (contains | and has multiple cells)
    if (trimmed.includes('|')) {
      const cellCount = trimmed.split('|').length - 1; // Subtract 1 for empty start/end
      if (cellCount >= 1) {
        tableLines.push(trimmed);
        i++;
        continue;
      }
    }
    
    // If we've collected some table lines and hit a non-table line, stop
    if (tableLines.length > 0) {
      break;
    }
    
    // If this doesn't look like a table line and we haven't started collecting, abort
    if (!trimmed.includes('|') || trimmed.split('|').length < 2) {
      return null;
    }
    
    i++;
  }
  
  // Need at least a header row to be a valid table
  if (tableLines.length === 0) {
    return null;
  }
  
  // Parse headers and rows
  const headers = parseTableRow(tableLines[0]);
  
  // If no headers found, this might not be a table
  if (headers.length === 0) {
    return null;
  }
  
  const rows = tableLines.slice(1).map(row => parseTableRow(row));
  
  // A valid table should have at least one row (even if empty) or we found a separator
  // This helps distinguish tables from other pipe-containing content
  if (rows.length === 0 && !foundSeparator && tableLines.length === 1) {
    // Only one line with pipes - might not be a table
    return null;
  }
  
  return {
    headers,
    rows,
    nextIndex: i,
  };
}

/**
 * Parse a table row
 * @param {string} row - Table row string
 * @returns {Array<string>} Cell contents
 */
function parseTableRow(row) {
  if (!row || !row.trim()) {
    return [];
  }
  
  // Remove leading/trailing pipes and whitespace, then split
  let cleaned = row.trim();
  
  // Remove leading pipe if present
  if (cleaned.startsWith('|')) {
    cleaned = cleaned.substring(1);
  }
  
  // Remove trailing pipe if present
  if (cleaned.endsWith('|')) {
    cleaned = cleaned.substring(0, cleaned.length - 1);
  }
  
  // Split by pipe and trim each cell
  const cells = cleaned
    .split('|')
    .map(cell => cell.trim());
  
  // Filter out empty cells only if they're at the end (preserve intentional empty cells)
  // But keep at least one cell even if empty
  while (cells.length > 1 && cells[cells.length - 1] === '' && cells[cells.length - 2] === '') {
    cells.pop();
  }
  
  return cells.length > 0 ? cells : [''];
}

/**
 * Create a Notion table block
 * @param {Array<string>} headers - Header cells
 * @param {Array<Array<string>>} rows - Table rows
 * @returns {Object} Notion table block
 */
function createTableBlock(headers, rows) {
  // Notion tables require table_width and children
  const tableWidth = headers.length;
  
  // Normalize all rows to have the same number of cells as headers
  const normalizedRows = rows.map(row => {
    const normalizedRow = [...row];
    
    // If row has fewer cells than headers, pad with empty strings
    while (normalizedRow.length < tableWidth) {
      normalizedRow.push('');
    }
    
    // If row has more cells than headers, truncate
    if (normalizedRow.length > tableWidth) {
      normalizedRow.splice(tableWidth);
    }
    
    return normalizedRow;
  });
  
  // Create header row
  const headerRow = {
    type: 'table_row',
    table_row: {
      cells: headers.map(header => {
        const richText = parseInlineMarkdown(header);
        // Ensure we have at least one text segment
        return richText.length > 0 ? richText : [{ type: 'text', text: { content: '' } }];
      }),
    },
  };
  
  // Create data rows
  const dataRows = normalizedRows.map(row => ({
    type: 'table_row',
    table_row: {
      cells: row.map(cell => {
        const richText = parseInlineMarkdown(cell);
        // Ensure we have at least one text segment
        return richText.length > 0 ? richText : [{ type: 'text', text: { content: '' } }];
      }),
    },
  }));
  
  return {
    type: 'table',
    table: {
      table_width: tableWidth,
      has_column_header: true,
      has_row_header: false,
      children: [headerRow, ...dataRows],
    },
  };
}

// ============================================================================
// Blockquote and Callout Parser
// ============================================================================
/**
 * Parse blockquote (may be a callout)
 * @param {Array<string>} lines - All lines
 * @param {number} startIndex - Starting line index
 * @returns {Object} Blockquote data
 */
function parseBlockquote(lines, startIndex) {
  const quoteLines = [];
  let i = startIndex;
  
  while (i < lines.length && lines[i].startsWith('> ')) {
    quoteLines.push(lines[i].slice(2));
    i++;
  }
  
  const content = quoteLines.join('\n').trim();
  
  // Check for callout pattern (emoji at start)
  const calloutMatch = content.match(/^([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}])\s*(.+)$/u);
  
  if (calloutMatch) {
    const emoji = calloutMatch[1];
    const text = calloutMatch[2];
    
    // Determine callout type from emoji
    const calloutTypes = {
      'ℹ️': 'info',
      '⚠️': 'warning',
      '📝': 'note',
      '💡': 'tip',
      '✅': 'success',
      '❌': 'error',
      '🔔': 'notification',
      '💬': 'comment',
    };
    
    const type = calloutTypes[emoji] || 'info';
    
    return {
      isCallout: true,
      content: text,
      emoji,
      type,
      nextIndex: i,
    };
  }
  
  return {
    isCallout: false,
    content,
    nextIndex: i,
  };
}

/**
 * Create a Notion callout block
 * @param {string} content - Callout content
 * @param {string} emoji - Emoji icon
 * @param {string} type - Callout type
 * @returns {Object} Notion callout block
 */
function createCalloutBlock(content, emoji = 'ℹ️', type = 'info') {
  const colors = {
    info: 'blue_background',
    warning: 'yellow_background',
    note: 'gray_background',
    tip: 'green_background',
    success: 'green_background',
    error: 'red_background',
    notification: 'purple_background',
    comment: 'gray_background',
  };
  
  return {
    type: 'callout',
    callout: {
      rich_text: parseInlineMarkdown(content),
      icon: { emoji },
      color: colors[type] || 'gray_background',
    },
  };
}

// ============================================================================
// List Parser (with nesting support)
// ============================================================================
/**
 * Parse lists (bulleted, numbered, task) with nesting
 * @param {Array<string>} lines - All lines
 * @param {number} startIndex - Starting line index
 * @returns {Object|null} List data or null
 */
function parseList(lines, startIndex) {
  const line = lines[startIndex];
  
  console.log('Confluence2Notion: parseList called', {
    startIndex,
    line: line.substring(0, 100),
    lineLength: line.length
  });
  
  // Check for task list
  const taskMatch = line.match(/^(\s*)- \[([ x])\]\s+(.+)$/);
  if (taskMatch) {
    console.log('Confluence2Notion: Detected task list');
    return parseNestedList(lines, startIndex, 'task');
  }
  
  // Check for unordered list
  if (line.match(/^(\s*)[-*+]\s+/)) {
    console.log('Confluence2Notion: Detected bullet list');
    return parseNestedList(lines, startIndex, 'bullet');
  }
  
  // Check for ordered list
  if (line.match(/^(\s*)\d+\.\s+/)) {
    console.log('Confluence2Notion: Detected numbered list');
    return parseNestedList(lines, startIndex, 'number');
  }
  
  console.log('Confluence2Notion: No list detected');
  return null;
}

/**
 * Parse nested lists with proper indentation support
 * Uses Notion's children property to create nested list structures
 * @param {Array<string>} lines - All lines
 * @param {number} startIndex - Starting line index
 * @param {string} listType - 'bullet', 'number', or 'task'
 * @returns {Object} List data
 */
function parseNestedList(lines, startIndex, listType) {
  console.log('Confluence2Notion: ===== PARSE NESTED LIST START =====');
  console.log('Confluence2Notion: List type:', listType);
  console.log('Confluence2Notion: Start index:', startIndex);
  console.log('Confluence2Notion: Lines around start (startIndex-2 to startIndex+10):');
  for (let idx = Math.max(0, startIndex - 2); idx < Math.min(lines.length, startIndex + 10); idx++) {
    console.log(`  [${idx}] "${lines[idx]}"`);
  }
  
  // First, collect all list items with their indent levels
  const items = [];
  let i = startIndex;
  let baseIndent = -1;
  
  while (i < lines.length) {
    const line = lines[i];
    
    // Check if line is part of current list type
    let match = null;
    let indent = 0;
    let content = '';
    let checked = false;
    
    if (listType === 'task') {
      match = line.match(/^(\s*)- \[([ x])\]\s+(.+)$/);
      if (match) {
        indent = match[1].length;
        checked = match[2] === 'x';
        content = match[3];
      }
    } else if (listType === 'bullet') {
      match = line.match(/^(\s*)[-*+]\s+(.+)$/);
      if (match) {
        indent = match[1].length;
        content = match[2];
        
        // Remove leading numbering from content if present
        // Bullet lists shouldn't have numbers like "11、" or "22、" in content
        // We need to remove ALL numbering patterns completely
        
        // Debug: log original content
        const originalContentBullet = content;
        
        // Remove all numbering patterns completely
        // Process in order: most specific patterns first, then general patterns
        
        // Pattern 1: Remove duplicate digit patterns with dots (e.g., "13.1、" -> "")
        content = content.replace(/^(\d)\1+\.(\d+)[、.]\s*/, ''); // "13.1、" -> ""
        content = content.replace(/^(\d)\1+\.(\d+)\.(\d+)[、.]\s*/, ''); // "23.2、" -> ""
        content = content.replace(/^(\d)\1+\.(\d+)\.(\d+)\.(\d+)[、.]\s*/, ''); // "25.3.2、" -> ""
        
        // Pattern 2: Remove simple duplicate digits (e.g., "11、" -> "")
        // This regex matches: (\d) captures a digit, \1+ matches one or more of the same digit
        content = content.replace(/^(\d)\1+[、.]\s*/, ''); // "11、" -> ""
        
        // Pattern 3: Remove numbering patterns with brackets (e.g., "1[1、" -> "[")
        // Handle patterns like "1[1、背景说明]" -> "[背景说明]"
        content = content.replace(/^(\d+)\[(\d+)[、.]/, '['); // "1[1、" -> "["
        content = content.replace(/^(\d+)\[(\d+\.\d+)[、.]/, '['); // "1[3.1、" -> "["
        content = content.replace(/^(\d+)\[(\d+\.\d+\.\d+)[、.]/, '['); // "1[3.1.1、" -> "["
        // Handle duplicate patterns with brackets (e.g., "11[11、" -> "[")
        content = content.replace(/^(\d)\1+\[(\d)\2+[、.]/, '['); // "11[11、" -> "["
        
        // Pattern 4: Remove any remaining numbering patterns (catch-all)
        content = content.replace(/^\d+\.\d+\.\d+\.\d+[、.]\s*/, ''); // "5.3.1.1、" -> ""
        content = content.replace(/^\d+\.\d+\.\d+[、.]\s*/, ''); // "5.3.1、" -> ""
        content = content.replace(/^\d+\.\d+[、.]\s*/, ''); // "3.1、" -> ""
        content = content.replace(/^\d+[、.]\s*/, ''); // "1、" or "1. " -> ""
        
        // Pattern 5: Handle patterns with spaces (e.g., "3.1 3.1、")
        content = content.replace(/^\d+\.\d+\s+\d+\.\d+[、.]\s*/, '');
        
        // Debug: log if content was changed
        if (originalContentBullet !== content) {
          console.log('Confluence2Notion: Cleaned numbering in parseNestedList (bullet)', { 
            original: originalContentBullet, 
            cleaned: content,
            lineIndex: i,
            listType: 'bullet'
          });
        } else if (originalContentBullet.match(/^\d+[、.]/)) {
          console.warn('Confluence2Notion: Numbering pattern NOT removed in parseNestedList (bullet)!', {
            content: originalContentBullet,
            lineIndex: i,
            listType: 'bullet',
            testResults: {
              duplicateWithDots: /^(\d)\1+\.(\d+)[、.]\s*/.test(originalContentBullet),
              simpleDuplicate: /^(\d)\1+[、.]\s*/.test(originalContentBullet),
              anyNumber: /^\d+[、.]\s*/.test(originalContentBullet)
            }
          });
        }
      }
    } else if (listType === 'number') {
      match = line.match(/^(\s*)\d+\.\s+(.+)$/);
      if (match) {
        indent = match[1].length;
        content = match[2];
        
        // Debug: log original content
        const originalContent = content;
        
        // Remove leading numbering from content if present
        // Notion will auto-number, so we don't need numbers like "11、" or "22、" in content
        // We need to remove ALL numbering patterns completely, not transform them
        // Pattern: "11、" -> completely remove
        // Pattern: "13.1、" -> completely remove (not transform to "3.1、")
        // Pattern: "23.2、" -> completely remove (not transform to "3.2、")
        // Pattern: "33.3、" -> completely remove (not transform to "3.3、")
        
        // Remove all numbering patterns completely (don't transform, just remove)
        // This includes patterns with leading duplicate digits
        // Process in order: most specific patterns first, then general patterns
        
        // Pattern 1: Remove duplicate digit patterns with dots (e.g., "13.1、" -> "")
        content = content.replace(/^(\d)\1+\.(\d+)[、.]\s*/, ''); // "13.1、" -> ""
        content = content.replace(/^(\d)\1+\.(\d+)\.(\d+)[、.]\s*/, ''); // "23.2、" -> ""
        content = content.replace(/^(\d)\1+\.(\d+)\.(\d+)\.(\d+)[、.]\s*/, ''); // "25.3.2、" -> ""
        
        // Pattern 2: Remove simple duplicate digits (e.g., "11、" -> "")
        content = content.replace(/^(\d)\1+[、.]\s*/, ''); // "11、" -> ""
        
        // Pattern 3: Remove numbering patterns with brackets (e.g., "1[1、" -> "[")
        // Handle patterns like "1[1、背景说明]" -> "[背景说明]"
        content = content.replace(/^(\d+)\[(\d+)[、.]/, '['); // "1[1、" -> "["
        content = content.replace(/^(\d+)\[(\d+\.\d+)[、.]/, '['); // "1[3.1、" -> "["
        content = content.replace(/^(\d+)\[(\d+\.\d+\.\d+)[、.]/, '['); // "1[3.1.1、" -> "["
        // Handle duplicate patterns with brackets (e.g., "11[11、" -> "[")
        content = content.replace(/^(\d)\1+\[(\d)\2+[、.]/, '['); // "11[11、" -> "["
        
        // Pattern 4: Remove any remaining numbering patterns (catch-all)
        content = content.replace(/^\d+\.\d+\.\d+\.\d+[、.]\s*/, ''); // "5.3.1.1、" -> ""
        content = content.replace(/^\d+\.\d+\.\d+[、.]\s*/, ''); // "5.3.1、" -> ""
        content = content.replace(/^\d+\.\d+[、.]\s*/, ''); // "3.1、" -> ""
        content = content.replace(/^\d+[、.]\s*/, ''); // "1、" or "1. " -> ""
        
        // Pattern 5: Handle patterns with spaces (e.g., "3.1 3.1、")
        content = content.replace(/^\d+\.\d+\s+\d+\.\d+[、.]\s*/, '');
        
        // Debug: log if content was changed
        if (originalContent !== content) {
          console.log('Confluence2Notion: Cleaned numbering in parseNestedList (number)', { 
            original: originalContent, 
            cleaned: content,
            lineIndex: i,
            listType: 'number'
          });
        } else if (originalContent.match(/^\d+[、.]/)) {
          console.warn('Confluence2Notion: Numbering pattern NOT removed in parseNestedList (number)!', {
            content: originalContent,
            lineIndex: i,
            listType: 'number',
            testResults: {
              duplicateWithDots: /^(\d)\1+\.(\d+)[、.]\s*/.test(originalContent),
              simpleDuplicate: /^(\d)\1+[、.]\s*/.test(originalContent),
              anyNumber: /^\d+[、.]\s*/.test(originalContent)
            }
          });
        }
      }
    }
    
    if (!match) {
      // Not a list item, check if we should continue
      if (line.trim() === '' && i + 1 < lines.length) {
        // Check next line - if it's a list item, continue
        const nextLine = lines[i + 1];
        const nextMatch = nextLine.match(/^(\s*)([-*+]|\d+\.|-\s*\[[ x]\])\s+/);
        if (nextMatch) {
          const nextIndent = nextMatch[1].length;
          // Continue if next item is at same level or nested
          if (baseIndent === -1 || nextIndent >= baseIndent) {
            i++;
            continue;
          }
        }
      }
      break;
    }
    
    // Set base indent on first item
    if (baseIndent === -1) {
      baseIndent = indent;
    }
    
    // Calculate relative indent level (how many levels nested)
    // Use 2-space indentation as the standard (matching Turndown output)
    const relativeIndent = indent - baseIndent;
    const indentLevel = Math.floor(relativeIndent / 2);
    
    console.log('Confluence2Notion: List item indent calculation', {
      lineIndex: i,
      indent: indent,
      baseIndent: baseIndent,
      relativeIndent: relativeIndent,
      indentLevel: indentLevel,
      content: content.substring(0, 50)
    });
    
    items.push({
      indent: indent,
      indentLevel: indentLevel,
      content: content,
      checked: checked,
      lineIndex: i,
    });
    
    i++;
  }
  
  // Build truly nested structure using Notion's children property
  // Notion API supports up to 2 levels of nesting when appending blocks
  const nestedBlocks = buildNestedList(items, listType, baseIndent);
  
  console.log('Confluence2Notion: Built nested list structure', {
    itemCount: items.length,
    topLevelBlockCount: nestedBlocks.length,
    listType: listType
  });
  
  return {
    blocks: nestedBlocks,
    nextIndex: i,
  };
}

/**
 * Build truly nested list structure using Notion's children property
 * Notion API supports nested children when appending blocks (up to 2 levels deep)
 * @param {Array<Object>} items - List items with indent info
 * @param {string} listType - 'bullet', 'number', or 'task'
 * @param {number} baseIndent - Base indentation level
 * @returns {Array} Notion blocks with proper nesting via children property
 */
function buildNestedList(items, listType, baseIndent) {
  if (items.length === 0) {
    return [];
  }
  
  /**
   * Clean content by removing numbering patterns
   */
  function cleanListContent(content) {
    let cleanContent = content;
    const originalContent = cleanContent;
    
    // Remove all numbering patterns completely
    // Pattern 1: Remove duplicate digit patterns with dots (e.g., "13.1、" -> "")
    cleanContent = cleanContent.replace(/^(\d)\1+\.(\d+)[、.]\s*/, '');
    cleanContent = cleanContent.replace(/^(\d)\1+\.(\d+)\.(\d+)[、.]\s*/, '');
    cleanContent = cleanContent.replace(/^(\d)\1+\.(\d+)\.(\d+)\.(\d+)[、.]\s*/, '');
    
    // Pattern 2: Remove simple duplicate digits (e.g., "11、" -> "")
    cleanContent = cleanContent.replace(/^(\d)\1+[、.]\s*/, '');
    
    // Pattern 3: Remove numbering patterns with brackets
    cleanContent = cleanContent.replace(/^(\d+)\[(\d+)[、.]/, '[');
    cleanContent = cleanContent.replace(/^(\d+)\[(\d+\.\d+)[、.]/, '[');
    cleanContent = cleanContent.replace(/^(\d+)\[(\d+\.\d+\.\d+)[、.]/, '[');
    cleanContent = cleanContent.replace(/^(\d)\1+\[(\d)\2+[、.]/, '[');
    
    // Pattern 4: Remove any remaining numbering patterns
    cleanContent = cleanContent.replace(/^\d+\.\d+\.\d+\.\d+[、.]\s*/, '');
    cleanContent = cleanContent.replace(/^\d+\.\d+\.\d+[、.]\s*/, '');
    cleanContent = cleanContent.replace(/^\d+\.\d+[、.]\s*/, '');
    cleanContent = cleanContent.replace(/^\d+[、.]\s*/, '');
    
    // Pattern 5: Handle patterns with spaces
    cleanContent = cleanContent.replace(/^\d+\.\d+\s+\d+\.\d+[、.]\s*/, '');
    
    if (originalContent !== cleanContent) {
      console.log('Confluence2Notion: Cleaned numbering in buildNestedList', { 
        original: originalContent, 
        cleaned: cleanContent,
        listType: listType
      });
    }
    
    return cleanContent;
  }
  
  /**
   * Create a list item block for the given content
   */
  function createListItemBlock(content, checked = false) {
    const cleanContent = cleanListContent(content);
    
    if (listType === 'task') {
      return createTodoBlock(cleanContent, checked);
    } else if (listType === 'bullet') {
      return createBulletedListItem(cleanContent);
    } else {
      return createNumberedListItem(cleanContent);
    }
  }
  
  // Build a tree structure first, then convert to Notion blocks with children
  // Each node: { item, children: [] }
  const rootNodes = [];
  const nodeStack = []; // Stack of { node, indentLevel }
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const node = {
      item: item,
      children: [],
    };
    
    // Pop stack until we find a parent with lower indent level
    while (nodeStack.length > 0 && nodeStack[nodeStack.length - 1].indentLevel >= item.indentLevel) {
      nodeStack.pop();
    }
    
    if (nodeStack.length === 0) {
      // This is a root-level item
      rootNodes.push(node);
    } else {
      // This is a child of the last item in the stack
      nodeStack[nodeStack.length - 1].node.children.push(node);
    }
    
    // Push this node to the stack
    nodeStack.push({
      node: node,
      indentLevel: item.indentLevel,
    });
  }
  
  /**
   * Flatten tree structure to a linear array with proper nesting
   * Notion API: depth 0 and 1 can have children, depth 2 cannot
   * 
   * Structure:
   * - depth 0 = Level 1 (top) - CAN have children
   * - depth 1 = Level 2 - CAN have children  
   * - depth 2 = Level 3 - CANNOT have children, but displays fine (no marker needed)
   * - depth 3+ = Level 4+ - needs markers [ind4], [ind5]... (flattened after Level 3 parent)
   */
  function flattenTreeToBlocks(nodes, depth, resultArray) {
    for (const node of nodes) {
      let content = node.item.content;
      
      // Only add marker for depth >= 3 (Level 4+)
      // depth 2 (Level 3) can display in Notion but cannot have children
      if (depth >= 3) {
        const level = depth + 1;
        const marker = `[ind${level}]`;
        content = `${marker} ${content}`;
        console.log('Confluence2Notion: Adding indent marker', {
          depth: depth,
          level: level,
          marker: marker,
          content: content.substring(0, 50)
        });
      }
      
      const block = createListItemBlock(content, node.item.checked);
      
      if (depth < 2 && node.children.length > 0) {
        // depth 0 and 1: can use Notion's native children
        const blockType = block.type;
        block[blockType].children = [];
        
        // Recursively process children
        flattenTreeToBlocks(node.children, depth + 1, block[blockType].children);
      } else if (node.children.length > 0) {
        // depth >= 2: cannot have children in Notion
        // Add current block, then flatten its children after it
        resultArray.push(block);
        flattenTreeToBlocks(node.children, depth + 1, resultArray);
        continue; // Skip the push at the end since we already added it
      }
      
      resultArray.push(block);
    }
  }
  
  // Convert all root nodes to blocks
  const blocks = [];
  flattenTreeToBlocks(rootNodes, 0, blocks);
  
  console.log('Confluence2Notion: Final nested list blocks', {
    inputItemCount: items.length,
    outputBlockCount: blocks.length,
    sampleBlock: blocks[0] ? JSON.stringify(blocks[0]).substring(0, 200) : 'none'
  });
  
  return blocks;
}

// ============================================================================
// Page Creation
// ============================================================================
// Store progress state for popup to poll
let currentProgress = { percent: 0, status: '' };

/**
 * Send progress update to popup
 * @param {number} percent - Progress percentage
 * @param {string} status - Status message
 */
function sendProgressUpdate(percent, status) {
  currentProgress = { percent, status };
  
  // Store in chrome.storage for popup to read
  chrome.storage.local.set({ 
    progressUpdate: { 
      percent, 
      status, 
      timestamp: Date.now() 
    } 
  }).catch(() => {
    // Ignore errors
  });
  
  // Also try to send message (in case popup is listening)
  chrome.runtime.sendMessage({
    type: 'PROGRESS_UPDATE',
    percent,
    status,
  }).catch(() => {
    // Ignore errors if no listener (popup might be closed)
  });
}

/**
 * Create a page in Notion
 * @param {Object} params - Page creation parameters
 * @returns {Promise<Object>} Created page info
 */
async function createNotionPage({ title, markdown, parentPageId, apiToken, sourceUrl }) {
  console.log('Confluence2Notion Background: Starting page creation', { title, markdownLength: markdown?.length, parentPageId });
  sendProgressUpdate(60, 'Converting Markdown to Notion blocks...');
  
  // Convert markdown to Notion blocks
  let blocks = markdownToNotionBlocks(markdown || '');
  
  // Ensure blocks is always an array
  if (!blocks || !Array.isArray(blocks)) {
    console.warn('Confluence2Notion: markdownToNotionBlocks returned invalid result, using empty array');
    blocks = [];
  }
  
  // If no blocks, add a placeholder paragraph
  if (blocks.length === 0) {
    console.warn('Confluence2Notion: No blocks generated, adding placeholder');
    blocks.push({
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: '(Content could not be converted)' } }]
      }
    });
  }
  
  sendProgressUpdate(65, `Generated ${blocks.length} blocks`);
  
  // Add source link if requested
  if (sourceUrl) {
    blocks.unshift({
      type: 'callout',
      callout: {
        rich_text: [{
          type: 'text',
          text: {
            content: 'Imported from Confluence: ',
          },
        }, {
          type: 'text',
          text: {
            content: sourceUrl,
            link: { url: sourceUrl },
          },
        }],
        icon: { emoji: '📄' },
        color: 'gray_background',
      },
    });
  }
  
  // Notion API limit: 100 blocks per request
  const MAX_BLOCKS_PER_REQUEST = 100;
  const initialBlocks = blocks.slice(0, MAX_BLOCKS_PER_REQUEST);
  const remainingBlocks = blocks.slice(MAX_BLOCKS_PER_REQUEST);
  
  sendProgressUpdate(70, 'Creating page in Notion...');
  
  // Create the page with initial blocks
  const pageData = {
    parent: { page_id: parentPageId },
    properties: {
      title: {
        title: [{ text: { content: title } }],
      },
    },
    children: initialBlocks,
  };
  
  const page = await notionRequest('/pages', 'POST', pageData, apiToken);
  
  sendProgressUpdate(80, 'Page created, uploading content...');
  
  // Append remaining blocks if any
  if (remainingBlocks.length > 0) {
    const totalChunks = Math.ceil(remainingBlocks.length / MAX_BLOCKS_PER_REQUEST);
    for (let i = 0; i < remainingBlocks.length; i += MAX_BLOCKS_PER_REQUEST) {
      const chunk = remainingBlocks.slice(i, i + MAX_BLOCKS_PER_REQUEST);
      const chunkIndex = Math.floor(i / MAX_BLOCKS_PER_REQUEST) + 1;
      const progress = 80 + Math.floor((chunkIndex / totalChunks) * 15);
      
      sendProgressUpdate(progress, `Uploading blocks ${chunkIndex}/${totalChunks}...`);
      await appendBlocksToPage(page.id, chunk, apiToken);
    }
  }
  
  sendProgressUpdate(95, 'Finalizing...');
  
  return {
    pageId: page.id,
    pageUrl: page.url,
  };
}

/**
 * Append blocks to an existing page (handles pagination)
 * @param {string} pageId - Page ID
 * @param {Array} blocks - Blocks to append
 * @param {string} apiToken - API token
 */
async function appendBlocksToPage(pageId, blocks, apiToken) {
  const MAX_BLOCKS_PER_REQUEST = 100;
  
  // If blocks fit in one request, send them all
  if (blocks.length <= MAX_BLOCKS_PER_REQUEST) {
    await notionRequest(
      `/blocks/${pageId}/children`,
      'PATCH',
      { children: blocks },
      apiToken
    );
    return;
  }
  
  // Otherwise, split into chunks
  for (let i = 0; i < blocks.length; i += MAX_BLOCKS_PER_REQUEST) {
    const chunk = blocks.slice(i, i + MAX_BLOCKS_PER_REQUEST);
    await notionRequest(
      `/blocks/${pageId}/children`,
      'PATCH',
      { children: chunk },
      apiToken
    );
  }
}

// ============================================================================
// Message Handler
// ============================================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Confluence2Notion Background: Received message', message.type);
  
  if (message.type === 'DOWNLOAD_AND_PACKAGE_IMAGES') {
    // Handle async response
    handleDownloadAndPackageImages(message.data)
      .then(result => {
        console.log('Confluence2Notion Background: Image packaging result', result);
        try {
          sendResponse(result);
        } catch (error) {
          console.error('Confluence2Notion Background: Error sending response', error);
        }
      })
      .catch(error => {
        console.error('Confluence2Notion Background: Error packaging images', error);
        try {
          sendResponse({ success: false, error: error.message || String(error) });
        } catch (responseError) {
          console.error('Confluence2Notion Background: Error sending error response', responseError);
        }
      });
    
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'CREATE_NOTION_PAGE') {
    // Handle async response
    handleCreatePage(message.data)
      .then(result => {
        console.log('Confluence2Notion Background: Page creation result', result);
        try {
          sendResponse(result);
        } catch (error) {
          console.error('Confluence2Notion Background: Error sending response', error);
        }
      })
      .catch(error => {
        console.error('Confluence2Notion Background: Error creating page', error);
        try {
          sendResponse({ success: false, error: error.message || String(error) });
        } catch (responseError) {
          console.error('Confluence2Notion Background: Error sending error response', responseError);
        }
      });
    
    return true; // Keep channel open for async response
  }
  
  // Return false if message type not handled
  return false;
});

/**
 * Handle CREATE_NOTION_PAGE message
 * @param {Object} data - Page data
 * @returns {Promise<Object>} Result
 */
/**
 * Extract and validate Notion page ID
 * @param {string} input - Page ID or URL
 * @returns {string} Validated page ID
 */
function extractAndValidatePageId(input) {
  if (!input || !input.trim()) {
    throw new Error('Parent page ID is required');
  }
  
  const trimmed = input.trim();
  
  // Check if it's a URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed);
      const pathname = url.pathname;
      
      // Extract ID from pathname (last 32 characters after last dash)
      const match = pathname.match(/-([a-f0-9]{32})$/i) || pathname.match(/([a-f0-9]{32})$/i);
      if (match) {
        return formatNotionId(match[1]);
      }
      
      throw new Error('Could not extract page ID from URL');
    } catch (error) {
      throw new Error('Invalid Notion page URL format');
    }
  }
  
  // If it's not a URL, treat it as a page ID
  const cleanId = trimmed.replace(/-/g, '');
  
  if (!/^[a-f0-9]{32}$/i.test(cleanId)) {
    throw new Error('Invalid page ID format. Expected 32-character hex string.');
  }
  
  return formatNotionId(cleanId);
}

/**
 * Format a Notion page ID to standard UUID format
 * @param {string} id - Page ID without dashes
 * @returns {string} Formatted UUID
 */
function formatNotionId(id) {
  const cleanId = id.replace(/-/g, '');
  if (cleanId.length !== 32) {
    return id;
  }
  return `${cleanId.substring(0, 8)}-${cleanId.substring(8, 12)}-${cleanId.substring(12, 16)}-${cleanId.substring(16, 20)}-${cleanId.substring(20, 32)}`;
}

async function handleCreatePage(data) {
  try {
    console.log('Confluence2Notion Background: handleCreatePage called', { 
      hasTitle: !!data?.title, 
      hasMarkdown: !!data?.markdown,
      hasParentPageId: !!data?.parentPageId,
      hasApiToken: !!data?.apiToken 
    });
    
    const { title, markdown, parentPageId, apiToken, sourceUrl } = data;
    
    if (!apiToken) {
      throw new Error('Notion API token is required');
    }
    
    if (!title) {
      throw new Error('Page title is required');
    }
    
    if (!markdown) {
      throw new Error('Markdown content is required');
    }
    
    // Extract and validate page ID
    const validatedPageId = extractAndValidatePageId(parentPageId);
    console.log('Confluence2Notion Background: Validated page ID', validatedPageId);
    
    sendProgressUpdate(55, 'Starting page creation...');
    
    const result = await createNotionPage({
      title,
      markdown,
      parentPageId: validatedPageId,
      apiToken,
      sourceUrl,
    });
    
    console.log('Confluence2Notion Background: Page created successfully', result);
    
    return {
      success: true,
      pageUrl: result.pageUrl,
      pageId: result.pageId,
    };
  } catch (error) {
    console.error('Confluence2Notion Background: Error creating page', error);
    sendProgressUpdate(50, `Error: ${error.message}`);
    return {
      success: false,
      error: error.message || String(error),
    };
  }
}

// ============================================================================
// Image Download and Packaging
// ============================================================================
/**
 * Download and package images into a ZIP file
 * @param {Object} data - Image data
 * @returns {Promise<Object>} Result with blob and filename
 */
async function handleDownloadAndPackageImages(data) {
  try {
    const { images, pageTitle } = data;
    
    if (!images || images.length === 0) {
      return {
        success: false,
        error: 'No images to download',
      };
    }
    
    console.log(`Confluence2Notion Background: Downloading ${images.length} images...`);
    
    // JSZip should already be loaded via importScripts at the top of this file
    // In Service Worker context, JSZip UMD assigns to self.JSZip
    const JSZip = self.JSZip || globalThis.JSZip;
    
    if (!JSZip) {
      throw new Error(
        'JSZip library not available. ' +
        'Please ensure src/lib/jszip.min.js exists and is properly loaded. ' +
        'The library should be pre-loaded at the top of service-worker.js using importScripts.'
      );
    }
    
    const zip = new JSZip();
    let downloadedCount = 0;
    const errors = [];
    
    // Download each image
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      try {
        console.log(`Confluence2Notion Background: Downloading image ${i + 1}/${images.length}: ${image.filename}`);
        
        // Fetch the image with CORS support
        const response = await fetch(image.url, {
          mode: 'cors',
          credentials: 'include', // Include cookies for authenticated images
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const blob = await response.blob();
        
        // Add to ZIP
        zip.file(image.filename, blob);
        downloadedCount++;
        
      } catch (error) {
        console.error(`Confluence2Notion Background: Failed to download image ${image.filename}:`, error);
        errors.push({
          filename: image.filename,
          url: image.url,
          error: error.message,
        });
      }
    }
    
    if (downloadedCount === 0) {
      return {
        success: false,
        error: 'Failed to download any images. Check console for details.',
        errors: errors,
      };
    }
    
    console.log(`Confluence2Notion Background: Successfully downloaded ${downloadedCount}/${images.length} images`);
    
    // Generate ZIP file as base64 string (for message passing)
    // ArrayBuffer cannot be serialized in Chrome messages, so we use base64
    const zipBase64 = await zip.generateAsync({
      type: 'base64',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    
    // Create filename
    const safeTitle = (pageTitle || 'confluence-page')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .substring(0, 50);
    const filename = `${safeTitle}-images-${new Date().toISOString().split('T')[0]}.zip`;
    
    return {
      success: true,
      base64: zipBase64,
      filename: filename,
      downloadedCount: downloadedCount,
      totalCount: images.length,
      errors: errors.length > 0 ? errors : undefined,
    };
    
  } catch (error) {
    console.error('Confluence2Notion Background: Error in handleDownloadAndPackageImages', error);
    return {
      success: false,
      error: error.message || String(error),
    };
  }
}

// ============================================================================
// Initialization
// ============================================================================
console.log('Confluence2Notion: Background service worker started');
