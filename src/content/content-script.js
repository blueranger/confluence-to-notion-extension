/**
 * Confluence2Notion - Content Script
 * Handles communication with popup and coordinates page parsing
 */

// ============================================================================
// CRITICAL: Message Listener Setup (MUST be first, before any other code)
// ============================================================================
/**
 * Setup message listener IMMEDIATELY - this must happen before anything else
 * to ensure messages can be received even if other code fails
 */
(function setupMessageListenerImmediately() {
  const messageHandler = (message, sender, sendResponse) => {
    console.log('Confluence2Notion: Received message', message.type);
    
    // Handle messages that don't require dependencies
    if (message.type === 'PING') {
      sendResponse({ pong: true, ready: true });
      return true;
    }
    
    // For other messages, we need to wait for the rest of the script to load
    // But we can still respond to indicate we're here
    try {
      // Try to handle the message if handlers are available
      if (message.type === 'CHECK_PAGE') {
        // Use a simple check that doesn't require parser
        const url = window.location.href.toLowerCase();
        const hostname = window.location.hostname.toLowerCase();
        const looksLikeConfluence = 
          hostname.includes('confluence') ||
          url.includes('/wiki/') ||
          url.includes('/confluence/') ||
          url.includes('/display/') ||
          url.includes('/spaces/') ||
          url.includes('/pages/') ||
          hostname.includes('atlassian.net') ||
          hostname.includes('atlassian.com');
        
        if (looksLikeConfluence) {
          sendResponse({
            isConfluence: true,
            title: document.title || 'Confluence Page',
            url: window.location.href,
            version: 'fallback'
          });
          return true;
        }
        
        // If parser is available, use it
        if (typeof window.ConfluenceParser !== 'undefined' && window.ConfluenceParser.handleCheckPage) {
          const result = window.ConfluenceParser.handleCheckPage();
          sendResponse(result);
          return true;
        }
        
        sendResponse({ isConfluence: false });
        return true;
      }
      
      if (message.type === 'GET_MARKDOWN') {
        // Defer to main handler if available
        if (typeof window.Confluence2NotionHandlers !== 'undefined') {
          const result = window.Confluence2NotionHandlers.handleGetMarkdown(message.options);
          sendResponse(result);
          return true;
        }
        
        sendResponse({
          success: false,
          error: 'Content script not fully loaded. Please wait a moment and try again.'
        });
        return true;
      }
      
      if (message.type === 'COLLECT_INTERNAL_IMAGES') {
        // Check if handler is available
        if (typeof handleCollectInternalImages === 'function') {
          const result = handleCollectInternalImages();
          sendResponse(result);
          return true;
        } else if (typeof window.Confluence2NotionHandlers !== 'undefined' && 
                   typeof window.Confluence2NotionHandlers.handleCollectInternalImages === 'function') {
          // Use handler from window object if available
          const result = window.Confluence2NotionHandlers.handleCollectInternalImages();
          sendResponse(result);
          return true;
        } else {
          // Handler not loaded yet
          sendResponse({
            success: false,
            error: 'Image collection handler not available. Please wait a moment and try again.'
          });
          return true;
        }
      }
      
      sendResponse({ error: 'Unknown message type' });
      return true;
    } catch (error) {
      console.error('Confluence2Notion: Error in message handler', error);
      sendResponse({ 
        success: false, 
        error: error.message || 'Unknown error' 
      });
      return true;
    }
  };
  
  chrome.runtime.onMessage.addListener(messageHandler);
  window.confluence2NotionMessageListenerReady = true;
  console.log('Confluence2Notion: Message listener registered (immediate)');
})();

// ============================================================================
// Turndown Configuration
// ============================================================================
/**
 * Initialize and configure Turndown service
 * @returns {TurndownService} Configured Turndown instance
 */
function initTurndown() {
  // Check if Turndown is loaded
  if (typeof TurndownService === 'undefined') {
    console.error('Confluence2Notion: Turndown not loaded');
    return null;
  }
  
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  });
  
  // Add GFM plugin if available
  if (typeof turndownPluginGfm !== 'undefined') {
    turndownService.use(turndownPluginGfm.gfm);
  }
  
  // Custom rule for nested lists - ensure proper indentation
  // This overrides default behavior to ensure consistent 2-space indentation
  turndownService.addRule('nestedListItem', {
    filter: 'li',
    replacement: function(content, node, options) {
      content = content
        .replace(/^\n+/, '') // Remove leading newlines
        .replace(/\n+$/, '\n') // Collapse trailing newlines
        .replace(/\n/gm, '\n  '); // Indent continuation lines
      
      // Calculate nesting depth by counting parent UL/OL elements
      let depth = 0;
      let parent = node.parentNode;
      while (parent) {
        if (parent.nodeName === 'UL' || parent.nodeName === 'OL') {
          depth++;
        }
        parent = parent.parentNode;
      }
      
      // depth >= 2 means this is a nested list item (one UL/OL is the immediate parent)
      const indent = '  '.repeat(Math.max(0, depth - 1));
      
      // Determine list marker
      let prefix = options.bulletListMarker + ' ';
      const parentList = node.parentNode;
      if (parentList && parentList.nodeName === 'OL') {
        const start = parentList.getAttribute('start');
        const index = Array.prototype.indexOf.call(parentList.children, node);
        prefix = (start ? Number(start) + index : index + 1) + '. ';
      }
      
      // Check for checkbox (task list)
      const checkbox = node.querySelector('input[type="checkbox"]');
      if (checkbox) {
        prefix = '- [' + (checkbox.checked ? 'x' : ' ') + '] ';
      }
      
      return indent + prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
    }
  });
  
  // Custom rule for code blocks - MUST be added before other rules
  // This ensures code blocks are handled correctly with language preservation
  turndownService.addRule('confluenceCodeBlock', {
    filter: (node) => {
      // Match <pre><code> structure OR plain <pre>
      if (node.nodeName !== 'PRE') return false;
      
      // Accept <pre><code> or plain <pre>
      return true;
    },
    replacement: (content, node) => {
      let codeNode = node.firstChild;
      let language = '';
      let codeContent = '';
      
      // Check if first child is <code>
      if (codeNode && codeNode.nodeName === 'CODE') {
        // Extract language from <code> element
        const className = codeNode.getAttribute('class') || '';
        const dataLanguage = codeNode.getAttribute('data-language') || '';
        
        const classMatch = className.match(/language-(\S+)/);
        if (classMatch) {
          language = classMatch[1];
        } else if (dataLanguage) {
          language = dataLanguage;
        }
        
        codeContent = codeNode.textContent || codeNode.innerText || '';
      } else {
        // Plain <pre> without <code>
        const className = node.getAttribute('class') || '';
        const dataLanguage = node.getAttribute('data-language') || '';
        
        const classMatch = className.match(/language-(\S+)/);
        if (classMatch) {
          language = classMatch[1];
        } else if (dataLanguage) {
          language = dataLanguage;
        }
        
        codeContent = node.textContent || node.innerText || '';
      }
      
      // Debug: log code block conversion
      console.log('Confluence2Notion: Converting code block to Markdown', {
        language: language || 'plain text',
        contentLength: codeContent.length,
        contentPreview: codeContent.substring(0, 100),
        hasCodeChild: codeNode && codeNode.nodeName === 'CODE'
      });
      
      // Generate fence (use 3 backticks, or more if code contains them)
      let fence = '```';
      if (codeContent.includes('```')) {
        let fenceCount = 4;
        while (codeContent.includes('`'.repeat(fenceCount))) {
          fenceCount++;
        }
        fence = '`'.repeat(fenceCount);
      }
      
      return `\n\n${fence}${language ? ' ' + language : ''}\n${codeContent}\n${fence}\n\n`;
    },
  });
  
  // Custom rule for Confluence tables - handle tables with rowspan/colspan
  // This properly handles merged cells by tracking spans across rows
  turndownService.addRule('confluenceTable', {
    filter: function (node) {
      if (node.nodeName !== 'TABLE') return false;
      const rows = node.querySelectorAll('tr');
      if (rows.length === 0) return false;
      const firstRow = rows[0];
      const firstRowCells = firstRow.querySelectorAll('th, td');
      return firstRowCells.length > 0;
    },
    replacement: function (content, node) {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (rows.length === 0) return '';
      
      // First pass: determine the actual column count by examining the first row
      // including colspan values
      let columnCount = 0;
      const firstRowCells = rows[0].querySelectorAll('th, td');
      firstRowCells.forEach(cell => {
        const colspan = parseInt(cell.getAttribute('colspan')) || 1;
        columnCount += colspan;
      });
      
      // Create a 2D grid to track cell content (handles rowspan/colspan)
      // grid[row][col] = cell content
      const grid = [];
      for (let i = 0; i < rows.length; i++) {
        grid[i] = new Array(columnCount).fill(null);
      }
      
      // Second pass: fill the grid, handling rowspan and colspan
      rows.forEach((row, rowIndex) => {
        const cells = row.querySelectorAll('td, th');
        let colIndex = 0;
        
        cells.forEach(cell => {
          // Find the next available column in this row
          while (colIndex < columnCount && grid[rowIndex][colIndex] !== null) {
            colIndex++;
          }
          
          if (colIndex >= columnCount) return;
          
          const rowspan = parseInt(cell.getAttribute('rowspan')) || 1;
          const colspan = parseInt(cell.getAttribute('colspan')) || 1;
          
          // Get cell content
          let text = cell.textContent || '';
          text = text.trim().replace(/\n+/g, ' ').replace(/\s+/g, ' ');
          text = text.replace(/\|/g, '\\|');
          text = text || ' ';
          
          // Fill the grid for this cell's span
          for (let r = 0; r < rowspan && (rowIndex + r) < rows.length; r++) {
            for (let c = 0; c < colspan && (colIndex + c) < columnCount; c++) {
              if (r === 0 && c === 0) {
                // First cell gets the content
                grid[rowIndex + r][colIndex + c] = text;
              } else {
                // Spanned cells get empty string (placeholder)
                grid[rowIndex + r][colIndex + c] = ' ';
              }
            }
          }
          
          colIndex += colspan;
        });
      });
      
      // Debug: log the grid
      console.log('Confluence2Notion: Table grid created', {
        rows: rows.length,
        columns: columnCount,
        firstRow: grid[0]
      });
      
      // Third pass: generate Markdown from the grid
      let markdown = '\n\n';
      
      grid.forEach((rowData, rowIndex) => {
        // Fill any remaining null cells with space
        const cellContents = rowData.map(cell => cell === null ? ' ' : cell);
        
        markdown += '| ' + cellContents.join(' | ') + ' |\n';
        
        // Add separator after first row (header)
        if (rowIndex === 0) {
          const separator = '|' + ' --- |'.repeat(columnCount) + '\n';
          markdown += separator;
        }
      });
      
      return markdown + '\n';
    },
  });
  
  // Custom rule for Confluence info panels (converted to blockquotes/callouts)
  turndownService.addRule('infoPanel', {
    filter: (node) => {
      return node.nodeName === 'BLOCKQUOTE' && node.hasAttribute('data-panel-type');
    },
    replacement: (content, node) => {
      const type = node.getAttribute('data-panel-type') || 'info';
      const emoji = {
        info: 'ℹ️',
        warning: '⚠️',
        note: '📝',
        tip: '💡',
      }[type] || 'ℹ️';
      
      // Clean up content
      const cleanedContent = content.trim().replace(/\n{3,}/g, '\n\n');
      
      // If content is empty, just return the emoji
      if (!cleanedContent) {
        return `\n> ${emoji}\n\n`;
      }
      
      return `\n> ${emoji} ${cleanedContent}\n\n`;
    },
  });
  
  // Custom rule for panel content (colored boxes that aren't info panels)
  turndownService.addRule('panelContent', {
    filter: (node) => {
      return node.nodeName === 'DIV' && node.classList.contains('confluence-panel-content');
    },
    replacement: (content, node) => {
      // Preserve the content structure, convert to callout format
      const cleanedContent = content.trim().replace(/\n{3,}/g, '\n\n');
      return `\n> 💡 ${cleanedContent}\n\n`;
    },
  });
  
  // Custom rule for flowcharts - preserve arrow structure
  turndownService.addRule('flowchart', {
    filter: (node) => {
      // Check if content looks like a flowchart
      const text = node.textContent || '';
      // Fix regex: escape - in character class or use alternation
      // Use separate patterns to avoid character class issues
      const hasArrow = text.includes('→') || text.includes('->');
      if (!hasArrow) return false;
      
      // Check for flowchart pattern with different arrow types
      const pattern1 = /[A-Z][a-z]+(?:\s*→\s*[A-Z][a-z]+)+/;
      const pattern2 = /[A-Z][a-z]+(?:\s*->\s*[A-Z][a-z]+)+/;
      const hasPattern = pattern1.test(text) || pattern2.test(text);
      const hasMultipleParts = text.split(/→|->/).length >= 3;
      
      return hasPattern || hasMultipleParts;
    },
    replacement: (content, node) => {
      // Preserve flowchart structure with proper spacing
      let text = content.trim();
      // Normalize arrows
      text = text.replace(/\s*->\s*/g, ' → ');
      text = text.replace(/\s*→\s*/g, ' → ');
      // Preserve line breaks
      text = text.replace(/\n/g, '\n');
      return `\n${text}\n\n`;
    },
  });
  
  // Custom rule for strikethrough (if not handled by GFM)
  turndownService.addRule('strikethrough', {
    filter: ['del', 's', 'strike'],
    replacement: (content) => `~~${content}~~`,
  });
  
  // Custom rule for task lists (Confluence checkboxes)
  turndownService.addRule('taskList', {
    filter: (node) => {
      return node.nodeName === 'LI' && 
             (node.classList.contains('task-list-item') || 
              node.querySelector('input[type="checkbox"]'));
    },
    replacement: (content, node) => {
      const checkbox = node.querySelector('input[type="checkbox"]');
      const checked = checkbox?.checked ? 'x' : ' ';
      return `- [${checked}] ${content.trim()}\n`;
    },
  });
  
  // Custom rule for inline code
  turndownService.addRule('inlineCode', {
    filter: (node) => {
      return node.nodeName === 'CODE' && 
             node.parentNode.nodeName !== 'PRE';
    },
    replacement: (content) => `\`${content}\``,
  });
  
  // Handle images - preserve src
  turndownService.addRule('images', {
    filter: 'img',
    replacement: (content, node) => {
      const alt = node.alt || node.title || node.getAttribute('aria-label') || '';
      // Try multiple sources for image URL
      let src = node.src || 
                node.getAttribute('data-src') || 
                node.getAttribute('data-original') ||
                node.getAttribute('data-lazy-src') ||
                node.getAttribute('data-url') ||
                node.getAttribute('href') ||
                '';
      
      // Handle relative URLs - convert to absolute
      if (src) {
        try {
          // If it's already absolute, use as-is
          if (src.startsWith('http://') || src.startsWith('https://')) {
            // Already absolute - validate it's a proper URL
            try {
              new URL(src);
            } catch (e) {
              console.warn('Confluence2Notion: Invalid absolute URL:', src);
              src = '';
            }
          } else if (src.startsWith('//')) {
            // Protocol-relative URL
            src = window.location.protocol + src;
          } else if (src.startsWith('/')) {
            // Absolute path - use current origin
            src = new URL(src, window.location.origin).href;
          } else if (src.startsWith('data:')) {
            // Data URL - keep as-is (though Notion may not support it)
            console.warn('Confluence2Notion: Data URL detected, Notion may not support it:', src.substring(0, 50) + '...');
          } else {
            // Relative path - resolve against current page URL
            src = new URL(src, window.location.href).href;
          }
        } catch (error) {
          console.warn('Confluence2Notion: Failed to resolve image URL:', src, error);
          // If URL resolution fails, try to construct from current location
          if (src && !src.startsWith('data:')) {
            if (src.startsWith('/')) {
              src = window.location.origin + src;
            } else {
              // For relative paths, try to construct from current path
              const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
              src = baseUrl + src;
            }
          }
        }
      }
      
      // Always include the image in markdown, even if URL might not work
      // The background worker will handle validation and create appropriate placeholders
      return src ? `![${alt}](${src})` : `![${alt}](missing-image)`;
    },
  });
  
  // Handle Confluence attachments
  turndownService.addRule('attachmentLink', {
    filter: (node) => {
      return node.nodeName === 'A' && 
             (node.classList.contains('confluence-embedded-file') ||
              node.href?.includes('/download/attachments/'));
    },
    replacement: (content, node) => {
      const href = node.href || '';
      return `[📎 ${content}](${href})`;
    },
  });
  
  return turndownService;
}

// ============================================================================
// Image Collection
// ============================================================================
/**
 * Collect internal images from the page
 * Internal images are those that are not external URLs (not starting with http:// or https://)
 * or are from the same origin
 * @returns {Object} Collection result
 */
function handleCollectInternalImages() {
  try {
    const images = [];
    const imageElements = document.querySelectorAll('img');
    const currentOrigin = window.location.origin;
    
    imageElements.forEach((img, index) => {
      // Try multiple sources for image URL
      let src = img.src || 
                img.getAttribute('data-src') || 
                img.getAttribute('data-original') ||
                img.getAttribute('data-lazy-src') ||
                img.getAttribute('data-url') ||
                '';
      
      if (!src) return;
      
      // Skip data URLs (they're already embedded)
      if (src.startsWith('data:')) {
        return;
      }
      
      // Convert relative URLs to absolute
      let absoluteUrl = src;
      try {
        if (src.startsWith('//')) {
          absoluteUrl = window.location.protocol + src;
        } else if (src.startsWith('/')) {
          absoluteUrl = new URL(src, window.location.origin).href;
        } else if (!src.startsWith('http://') && !src.startsWith('https://')) {
          absoluteUrl = new URL(src, window.location.href).href;
        }
      } catch (error) {
        console.warn('Confluence2Notion: Failed to resolve image URL:', src, error);
        return;
      }
      
      // Check if it's an internal image (same origin or relative)
      const urlObj = new URL(absoluteUrl);
      const isInternal = urlObj.origin === currentOrigin || 
                        !absoluteUrl.startsWith('http://') && !absoluteUrl.startsWith('https://');
      
      // Also consider images from the same domain as internal
      const isSameDomain = urlObj.hostname === window.location.hostname ||
                         urlObj.hostname.endsWith('.' + window.location.hostname) ||
                         window.location.hostname.endsWith('.' + urlObj.hostname);
      
      if (isInternal || isSameDomain) {
        const alt = img.alt || img.title || img.getAttribute('aria-label') || '';
        const filename = getImageFilename(absoluteUrl, alt, index);
        
        images.push({
          url: absoluteUrl,
          alt: alt,
          filename: filename,
          originalSrc: src,
        });
      }
    });
    
    console.log(`Confluence2Notion: Collected ${images.length} internal images`);
    
    return {
      success: true,
      images: images,
      count: images.length,
    };
  } catch (error) {
    console.error('Confluence2Notion: Error collecting images', error);
    return {
      success: false,
      error: error.message || 'Failed to collect images',
    };
  }
}

/**
 * Get a safe filename for an image
 * @param {string} url - Image URL
 * @param {string} alt - Image alt text
 * @param {number} index - Image index
 * @returns {string} Safe filename
 */
function getImageFilename(url, alt, index) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const extension = pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i)?.[1]?.toLowerCase() || 'png';
    
    // Try to get filename from URL
    let filename = pathname.split('/').pop() || `image-${index + 1}`;
    
    // Remove query parameters from filename
    filename = filename.split('?')[0];
    
    // If no extension, add one
    if (!filename.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i)) {
      filename = `${filename}.${extension}`;
    }
    
    // Clean filename (remove invalid characters)
    filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    
    // If filename is too short or empty, use alt text or index
    if (filename.length < 5) {
      const altBased = alt ? alt.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 50) : '';
      filename = altBased || `image-${index + 1}.${extension}`;
    }
    
    return filename;
  } catch (error) {
    return `image-${index + 1}.png`;
  }
}

// ============================================================================
// Message Handlers
// ============================================================================
/**
 * Handle CHECK_PAGE message
 * @returns {Object} Page check result
 */
function handleCheckPage() {
  // Wait a bit for parser to be available if it's not ready
  if (typeof window.ConfluenceParser === 'undefined') {
    console.warn('Confluence2Notion: Parser not available yet, using fallback detection');
    // Use URL-based fallback
    const url = window.location.href.toLowerCase();
    const hostname = window.location.hostname.toLowerCase();
    
    const looksLikeConfluence = 
      hostname.includes('confluence') ||
      url.includes('/wiki/') ||
      url.includes('/confluence/') ||
      url.includes('/display/') ||
      url.includes('/spaces/') ||
      url.includes('/pages/') ||
      hostname.includes('atlassian.net') ||
      hostname.includes('atlassian.com');
    
    if (looksLikeConfluence) {
      return {
        isConfluence: true,
        title: document.title || 'Confluence Page',
        url: window.location.href,
        version: 'fallback',
      };
    }
    
    return {
      isConfluence: false,
    };
  }
  
  try {
    const detection = window.ConfluenceParser.detectConfluence();
    
    if (!detection.isConfluence) {
      return {
        isConfluence: false,
      };
    }
    
    const title = window.ConfluenceParser.extractTitle(detection.version) || document.title;
    
    return {
      isConfluence: true,
      title: title,
      url: window.location.href,
      version: detection.version,
    };
  } catch (error) {
    console.error('Confluence2Notion: Error in handleCheckPage', error);
    // Fallback to URL-based detection
    const url = window.location.href.toLowerCase();
    if (url.includes('confluence') || url.includes('/spaces/') || url.includes('/pages/')) {
      return {
        isConfluence: true,
        title: document.title || 'Confluence Page',
        url: window.location.href,
        version: 'fallback',
      };
    }
    return { isConfluence: false };
  }
}

/**
 * Handle GET_MARKDOWN message
 * @param {Object} options - Conversion options
 * @returns {Object} Markdown conversion result
 */
function handleGetMarkdown(options = {}) {
  try {
    // Parse the page
    const parseResult = window.ConfluenceParser?.parseConfluencePage();
    
    if (!parseResult?.success) {
      return {
        success: false,
        error: parseResult?.error || 'Failed to parse page',
      };
    }
    
    const { title, htmlContent, metadata } = parseResult.data;
    
    // Initialize Turndown
    const turndownService = initTurndown();
    
    if (!turndownService) {
      return {
        success: false,
        error: 'Markdown converter not available',
      };
    }
    
    // Convert to Markdown
    let markdown = turndownService.turndown(htmlContent);
    
    // Clean up markdown
    markdown = cleanupMarkdown(markdown);
    
    // Debug: Log the exported Markdown
    console.log('Confluence2Notion: ===== EXPORTED MARKDOWN FROM CONFLUENCE =====');
    console.log('Confluence2Notion: Title:', title);
    console.log('Confluence2Notion: Markdown length:', markdown.length);
    console.log('Confluence2Notion: Full Markdown:');
    console.log(markdown);
    console.log('Confluence2Notion: ===== END EXPORTED MARKDOWN =====');
    
    return {
      success: true,
      markdown: markdown,
      title: title,
      metadata: metadata,
    };
    
  } catch (error) {
    console.error('Confluence2Notion: Error converting to Markdown', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Clean up generated Markdown
 * @param {string} markdown - Raw Markdown
 * @returns {string} Cleaned Markdown
 */
function cleanupMarkdown(markdown) {
  let cleaned = markdown;
  const originalLength = cleaned.length;
  
  // Fix malformed nested list patterns like "-   - item" -> "  - item"
  // This happens when Confluence has empty list items containing nested lists
  cleaned = cleaned.replace(/^-\s+- /gm, '  - ');
  cleaned = cleaned.replace(/^-\s{2,}- /gm, '  - ');
  
  // Fix numbered list variant: "1.   - item" -> "  - item"
  cleaned = cleaned.replace(/^\d+\.\s+- /gm, '  - ');
  
  // Fix deeply nested malformed patterns: "-   -   - " -> "    - "
  cleaned = cleaned.replace(/^-\s+- +- /gm, '    - ');
  cleaned = cleaned.replace(/^-\s+-\s+- /gm, '    - ');
  
  // Fix empty list items: "- \n" followed by anything -> remove the empty item
  cleaned = cleaned.replace(/^- *\n(\s*[-*\d])/gm, '$1');
  
  // IMPORTANT: Remove blank lines between list items that should be connected
  // Pattern: list item ending, then blank line(s), then indented list item
  // This ensures nested lists stay connected to their parents
  cleaned = cleaned.replace(/^(- .+)\n\n+(\s+- )/gm, '$1\n$2');
  cleaned = cleaned.replace(/^(\s+- .+)\n\n+(\s+- )/gm, '$1\n$2');
  
  // Also handle: parent item, blank line, then child item with "-   - " pattern that we'll fix
  // First identify pattern: "- parent:\n\n-   - child" and fix it
  cleaned = cleaned.replace(/^(- [^\n]+:)\n\n+-\s+- /gm, '$1\n  - ');
  
  // Fix case where there's a list item followed by blank lines and then deeply indented items
  // Pattern: "  - item:\n\n        - subitem" -> "  - item:\n    - subitem"
  cleaned = cleaned.replace(/^(\s*- [^\n]+)\n\n+(\s{4,}- )/gm, (match, item, subitem) => {
    // Normalize subitem indentation: find current indent and make it 2 more than parent
    const parentIndent = item.match(/^(\s*)/)[1].length;
    const subitemContent = subitem.replace(/^\s+/, '');
    const newIndent = ' '.repeat(parentIndent + 2);
    return `${item}\n${newIndent}${subitemContent}`;
  });
  
  // Remove excessive blank lines (more than 2)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // Remove trailing whitespace on each line
  cleaned = cleaned.replace(/[ \t]+$/gm, '');
  
  // Log if we made any changes
  if (cleaned.length !== originalLength) {
    console.log('Confluence2Notion: cleanupMarkdown fixed formatting', {
      originalLength: originalLength,
      newLength: cleaned.length,
      diff: originalLength - cleaned.length
    });
  }
  
  // Ensure single newline at end
  return cleaned.trim() + '\n';
}

// ============================================================================
// Message Listener
// ============================================================================
/**
 * Setup enhanced message listener (after main handlers are loaded)
 * This provides full functionality once all dependencies are ready
 */
function setupEnhancedMessageListener() {
  // Check if listener is already set up (from immediate setup above)
  if (window.confluence2NotionMessageListenerReady) {
    console.log('Confluence2Notion: Enhanced message handler ready');
    
    // Store handlers for the immediate listener to use
    window.Confluence2NotionHandlers = {
      handleCheckPage: handleCheckPage,
      handleGetMarkdown: handleGetMarkdown,
      handleCollectInternalImages: typeof handleCollectInternalImages === 'function' ? handleCollectInternalImages : undefined,
    };
    
    return;
  }
  
  // Fallback: set up listener if immediate setup didn't work
  const messageHandler = (message, sender, sendResponse) => {
    console.log('Confluence2Notion: Received message (enhanced)', message.type);
    
    try {
      switch (message.type) {
        case 'CHECK_PAGE':
          const checkResult = handleCheckPage();
          sendResponse(checkResult);
          break;
          
        case 'GET_MARKDOWN':
          const markdownResult = handleGetMarkdown(message.options);
          sendResponse(markdownResult);
          break;
          
        case 'COLLECT_INTERNAL_IMAGES':
          const imageResult = typeof handleCollectInternalImages === 'function' 
            ? handleCollectInternalImages() 
            : { success: false, error: 'Handler not available' };
          sendResponse(imageResult);
          break;
          
        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Confluence2Notion: Error handling message', error);
      sendResponse({ 
        success: false, 
        error: error.message || 'Unknown error' 
      });
    }
    
    return true;
  };
  
  chrome.runtime.onMessage.addListener(messageHandler);
  window.confluence2NotionMessageListenerReady = true;
  console.log('Confluence2Notion: Enhanced message listener registered');
}

// Setup enhanced listener after handlers are defined
setupEnhancedMessageListener();

// ============================================================================
// Initialization
// ============================================================================
console.log('Confluence2Notion: Content script loaded');

// Wait for DOM and parser to be ready
function initialize() {
  // Ensure parser is available
  if (typeof window.ConfluenceParser === 'undefined') {
    console.warn('Confluence2Notion: Parser not available, scripts may not be loaded in correct order');
    // Try again after a short delay
    setTimeout(() => {
      if (typeof window.ConfluenceParser !== 'undefined') {
        console.log('Confluence2Notion: Parser now available');
      } else {
        console.warn('Confluence2Notion: Parser still not available after delay');
      }
    }, 200);
  } else {
    console.log('Confluence2Notion: Parser available');
  }
  
  // Signal that content script is ready (even if parser isn't)
  window.confluence2NotionReady = true;
  console.log('Confluence2Notion: Content script ready');
  
  // Send a test message to verify listener is working
  try {
    chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
      // Ignore response - just testing if we can send
    });
  } catch (e) {
    // Ignore - this is just a test
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  // DOM is already ready
  initialize();
}

// Also set ready flag immediately (message listener is already set up)
window.confluence2NotionReady = true;
