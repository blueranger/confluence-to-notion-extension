/**
 * Confluence Parser
 * Extracts content from Confluence pages (Cloud and Server/Data Center)
 */

// ============================================================================
// Selectors for different Confluence versions
// ============================================================================
// Prevent duplicate declaration if script is injected multiple times
// Check if already initialized
let CONFLUENCE_SELECTORS;
if (typeof window.__CONFLUENCE_SELECTORS__ !== 'undefined') {
  // Already initialized, use existing
  CONFLUENCE_SELECTORS = window.__CONFLUENCE_SELECTORS__;
} else {
  // First time initialization
  CONFLUENCE_SELECTORS = {
    // Confluence Cloud (Atlassian hosted)
    cloud: {
      title: [
        '[data-testid="title-text"] span',
      '[data-testid="title-text"]',
      '.page-title-text',
      'h1[data-testid="title-text"]',
      '.ak-renderer-page-title',
    ],
    content: [
      '[data-testid="page-content-container"]',
      '.ak-renderer-document',
      '#content .wiki-content',
      '#main-content',
      '.page-content',
      '[data-testid="page-content"]',
    ],
    mainContent: [
      '#content',
      '#main-content',
      '[data-testid="page-content-container"]',
    ],
  },
  
  // Confluence Server / Data Center (self-hosted)
  server: {
    title: [
      '#title-text',
      '.pagetitle',
      'h1#title-text',
      '.page-title',
      '#title-heading',
    ],
    content: [
      '#main-content .wiki-content',
      '.confluence-content-body',
      '#main-content',
      '.wiki-content',
      '.confluence-content',
      '#content .wiki-content',
    ],
    mainContent: [
      '#main-content',
      '#content',
      '.main-content',
    ],
  },
  
  // Generic fallbacks
  fallback: {
    title: [
      'h1',
      '.page-title',
      'title',
    ],
    content: [
      '.wiki-content',
      '.content-body',
      'article',
      'main .content',
      '.page-content',
    ],
    mainContent: [
      'main',
      '#main',
      '.main-content',
      '#content',
    ],
  },
};
  
  // Store in window to prevent re-initialization
  window.__CONFLUENCE_SELECTORS__ = CONFLUENCE_SELECTORS;
}

// ============================================================================
// Detection
// ============================================================================
/**
 * Detect if current page is a Confluence page and which version
 * @returns {Object} Detection result { isConfluence, version }
 */
function detectConfluence() {
  // Check for Confluence Cloud indicators
  const cloudIndicators = [
    '[data-testid="page-content-container"]',
    '.ak-renderer-document',
    '[data-testid="title-text"]',
    '.ak-renderer-page',
    'body[data-testid="page-view"]',
  ];
  
  for (const selector of cloudIndicators) {
    if (document.querySelector(selector)) {
      return { isConfluence: true, version: 'cloud' };
    }
  }
  
  // Check for Confluence Server/Data Center indicators
  const serverIndicators = [
    '#main-content .wiki-content',
    '.confluence-content-body',
    '#title-text',
    '.confluence-content',
    'body.theme-default',
    '#main-content',
  ];
  
  for (const selector of serverIndicators) {
    if (document.querySelector(selector) || 
        (selector === 'body.theme-default' && document.body.classList.contains('theme-default'))) {
      return { isConfluence: true, version: 'server' };
    }
  }
  
  // Check URL patterns
  const url = window.location.href.toLowerCase();
  const hostname = window.location.hostname.toLowerCase();
  
  // Check if hostname contains "confluence"
  if (hostname.includes('confluence')) {
    return { isConfluence: true, version: 'fallback' };
  }
  
  const confluenceUrlPatterns = [
    '/wiki/',
    '/confluence/',
    '/display/',
    '/pages/',
    '/spaces/',
  ];
  
  for (const pattern of confluenceUrlPatterns) {
    if (url.includes(pattern)) {
      // Likely Confluence, use fallback selectors
      return { isConfluence: true, version: 'fallback' };
    }
  }
  
  // Check for Confluence-specific meta tags or scripts
  const metaTags = document.querySelectorAll('meta[name], meta[property]');
  for (const meta of metaTags) {
    const name = meta.getAttribute('name') || meta.getAttribute('property') || '';
    if (name.toLowerCase().includes('confluence') || 
        name.toLowerCase().includes('atlassian')) {
      return { isConfluence: true, version: 'fallback' };
    }
  }
  
  return { isConfluence: false, version: null };
}

// ============================================================================
// Content Extraction
// ============================================================================
/**
 * Find element using multiple selectors (tries each until one matches)
 * @param {string} version - Confluence version
 * @param {string} type - Selector type (title, content, mainContent)
 * @returns {HTMLElement|null} Found element or null
 */
function findElement(version, type) {
  const selectors = CONFLUENCE_SELECTORS[version]?.[type] || 
                    CONFLUENCE_SELECTORS.fallback[type] || [];
  
  // Ensure selectors is an array
  const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
  
  // Try each selector until one matches
  for (const selector of selectorArray) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }
  
  return null;
}

/**
 * Extract page title
 * @param {string} version - Confluence version
 * @returns {string} Page title
 */
function extractTitle(version) {
  const element = findElement(version, 'title');
  
  if (element) {
    const title = element.textContent?.trim();
    if (title) return title;
  }
  
  // Fallback: try document title and clean it
  const docTitle = document.title;
  if (docTitle) {
    // Remove common suffixes like " - Confluence" or " | Confluence"
    const cleaned = docTitle
      .replace(/\s*[-|]\s*Confluence.*$/i, '')
      .replace(/\s*[-|]\s*.*Confluence.*$/i, '')
      .trim();
    if (cleaned) return cleaned;
  }
  
  // Last resort
  return 'Untitled';
}

/**
 * Extract page content as HTML
 * @param {string} version - Confluence version
 * @returns {string} HTML content
 */
function extractContent(version) {
  const element = findElement(version, 'content');
  
  if (!element) {
    console.warn('Confluence2Notion: Could not find content element, trying fallbacks...');
    
    // Try to find any content-like element
    const fallbackSelectors = [
      'article',
      'main',
      '.content',
      '[role="main"]',
      '.page-body',
    ];
    
    for (const selector of fallbackSelectors) {
      const fallback = document.querySelector(selector);
      if (fallback && fallback.textContent.trim().length > 50) {
        const clone = fallback.cloneNode(true);
        cleanupContent(clone);
        return clone.innerHTML;
      }
    }
    
    return '';
  }
  
  // Clone the element to avoid modifying the actual page
  const clone = element.cloneNode(true);
  
  // Clean up the content
  cleanupContent(clone);
  
  return clone.innerHTML;
}

/**
 * Clean up extracted content
 * @param {HTMLElement} element - Element to clean
 */
function cleanupContent(element) {
  if (!element) return;
  
  // Remove scripts
  element.querySelectorAll('script').forEach(el => el.remove());
  
  // Remove styles
  element.querySelectorAll('style').forEach(el => el.remove());
  
  // Remove hidden elements
  element.querySelectorAll('[hidden], .hidden, [style*="display: none"], [style*="display:none"]')
    .forEach(el => el.remove());
  
  // Remove elements with aria-hidden
  element.querySelectorAll('[aria-hidden="true"]').forEach(el => {
    // Keep if it's content (like collapsed sections), only remove UI elements
    if (!el.textContent || el.textContent.trim().length < 10) {
      el.remove();
    }
  });
  
  // Remove edit buttons and controls using pattern-based selectors
  const uiSelectorPatterns = [
    // Edit-related
    '[data-testid*="edit" i]',
    '[data-testid*="Edit"]',
    '.edit-button',
    '.inline-comment-marker',
    '.comment-marker',
    '.annotation-marker',
    
    // Page metadata and info
    '.page-metadata',
    '.page-version-info',
    '.page-history',
    '.page-permissions',
    '.page-labels',
    '.page-watchers',
    '.page-restrictions',
    '.page-info',
    '.page-status',
    
    // Navigation and structure
    '.page-breadcrumbs',
    '.page-navigation',
    '.page-toc',
    '.page-sidebar',
    '.page-footer',
    '.page-header',
    
    // Actions and controls
    '.page-actions',
    '.page-header-actions',
    '[data-testid="page-actions"]',
    '.page-toolbar',
    '.page-controls',
    '.page-menu',
    '.page-options',
    '.page-settings',
    
    // Social and sharing
    '.page-share',
    '.page-share-button',
    '.page-subscribe',
    '.page-watch',
    '.page-like',
    
    // Utility buttons
    '.page-help',
    '.page-feedback',
    '.page-report',
    '.page-export',
    '.page-print',
    '.page-email',
  ];
  
  // Remove elements matching patterns
  uiSelectorPatterns.forEach(selector => {
    try {
      element.querySelectorAll(selector).forEach(el => el.remove());
    } catch (e) {
      // Ignore invalid selectors
    }
  });
  
  // Remove elements with data-testid containing action/control keywords
  const actionKeywords = ['edit', 'Edit', 'action', 'Action', 'control', 'Control', 'button', 'Button'];
  actionKeywords.forEach(keyword => {
    try {
      element.querySelectorAll(`[data-testid*="${keyword}"]`).forEach(el => {
        // Only remove if it's clearly a UI element (not content)
        const text = el.textContent?.trim() || '';
        if (text.length < 20 || el.classList.contains('button') || el.tagName === 'BUTTON') {
          el.remove();
        }
      });
    } catch (e) {
      // Ignore errors
    }
  });
  
  // Remove comments sections
  element.querySelectorAll(
    '#comments-section, .comment-thread, .comments-section, ' +
    '.page-comments, .comments-container, .comment-list, ' +
    '[data-testid*="comment"], [data-testid*="Comment"]'
  ).forEach(el => el.remove());
  
  // Remove like/reaction buttons
  element.querySelectorAll(
    '.like-button, .reactions-container, .reaction-button, ' +
    '.page-reactions, .reactions-list, .reaction-item, ' +
    '[data-testid*="reaction"], [data-testid*="Reaction"], ' +
    '[data-testid*="like"], [data-testid*="Like"]'
  ).forEach(el => el.remove());
  
  // Remove navigation elements
  element.querySelectorAll(
    '.page-navigation, .page-nav, .page-breadcrumbs, ' +
    '.breadcrumbs, .page-path, .page-location'
  ).forEach(el => el.remove());
  
  // Remove metadata elements
  element.querySelectorAll(
    '.page-metadata, .page-info, .page-details, ' +
    '.page-properties, .page-attributes, .page-tags, ' +
    '.page-labels, .page-categories, .page-topics'
  ).forEach(el => el.remove());
  
  // Remove share/social elements
  element.querySelectorAll(
    '.page-share, .share-button, .social-share, ' +
    '.page-subscribe, .subscribe-button, .page-watch, ' +
    '.watch-button, .page-follow, .follow-button'
  ).forEach(el => el.remove());
  
  // Clean up Confluence macros
  cleanupMacros(element);
  
  // Clean up empty elements (but keep structural ones)
  cleanupEmptyElements(element);
}

/**
 * Handle Confluence-specific macros
 * @param {HTMLElement} element - Element containing macros
 */
function cleanupMacros(element) {
  if (!element) return;
  
  // ============================================================================
  // IMPORTANT: Code blocks MUST be processed FIRST, before info panels
  // Otherwise, code blocks inside info panels get wrapped incorrectly
  // ============================================================================
  
  // Code blocks - Confluence uses various structures
  // Most common: <div class="code panel pdl conf-macro output-block" data-macro-name="code">
  const codeBlockSelectors = [
    // Confluence specific - most important first
    '.code.panel',                    // Main Confluence code block class
    'div.code.panel.pdl',             // Confluence code panel
    '[data-macro-name="code"]',       // Confluence macro
    '[data-macro-name="markdown"]',   // Markdown macro
    '.conf-macro.output-block[data-macro-name="code"]', // Specific code macro
    // Standard selectors
    '.code-block',
    '.codeContent',
    '.syntaxhighlighter',
    '.highlight',
    '.highlight-source',
    '.source-code',
    '.code-macro',
    '.ak-renderer-code-block',
    // Fallback
    'pre:not(:has(code))',            // Plain pre without code inside
  ];
  
  // Track processed elements to avoid duplicates
  const processedCodeBlocks = new Set();
  
  codeBlockSelectors.forEach(selector => {
    element.querySelectorAll(selector).forEach(codeBlock => {
      // Skip if already processed
      if (processedCodeBlocks.has(codeBlock)) return;
      
      // Skip if it's inside another code block we've already processed
      let parent = codeBlock.parentElement;
      while (parent) {
        if (processedCodeBlocks.has(parent)) return;
        parent = parent.parentElement;
      }
      
      processedCodeBlocks.add(codeBlock);
      
      // Debug: log what we found
      console.log('Confluence2Notion: Processing code block', {
        selector: selector,
        className: codeBlock.className,
        dataMacroName: codeBlock.getAttribute('data-macro-name'),
        outerHTMLPreview: codeBlock.outerHTML.substring(0, 300)
      });
      
      // Try to extract language from various sources
      let language = 'plain text';
      const dataMacroName = codeBlock.getAttribute('data-macro-name') || '';
      
      // Check for language in data attributes
      language = codeBlock.getAttribute('data-lang') ||
                codeBlock.getAttribute('data-language') ||
                codeBlock.getAttribute('data-highlight-language') ||
                '';
      
      // Check in class names
      if (!language) {
        const classMatch = codeBlock.className.match(/language-(\w+)/i) ||
                          codeBlock.className.match(/brush[:\s]+(\w+)/i) ||
                          codeBlock.className.match(/syntax-(\w+)/i);
        if (classMatch) language = classMatch[1];
      }
      
      // Check nested code element for language
      const nestedCode = codeBlock.querySelector('code');
      if (!language && nestedCode) {
        const nestedLang = nestedCode.getAttribute('data-language') ||
                          nestedCode.className.match(/language-(\w+)/i)?.[1];
        if (nestedLang) language = nestedLang;
      }
      
      // Special handling for markdown macro
      if (dataMacroName === 'markdown') {
        language = 'markdown';
      }
      
      // Try to detect language from content (Python class definition)
      if (!language || language === 'plain text') {
        const contentPreview = (codeBlock.textContent || '').substring(0, 200);
        if (contentPreview.match(/^class\s+\w+.*:/m) || contentPreview.match(/def\s+\w+\s*\(/)) {
          language = 'python';
        } else if (contentPreview.match(/^\s*\{[\s\S]*"[\w_]+":/)) {
          language = 'json';
        } else if (contentPreview.match(/function\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=/)) {
          language = 'javascript';
        }
      }
      
      // Normalize language
      language = language || 'plain text';
      
      // Extract code content - handle various structures
      let codeContent = '';
      
      // Method 1: Look for nested <code> or <pre> elements
      let codeElement = codeBlock.querySelector('code, pre');
      
      // Method 2: Look for content containers specific to Confluence
      if (!codeElement) {
        codeElement = codeBlock.querySelector('.codeContent, .code-content, .code-body, .code-text, .preformatted');
      }
      
      if (codeElement) {
        // Get text content, preserving whitespace
        codeContent = codeElement.textContent || codeElement.innerText || '';
      } else {
        // Method 3: The code block itself contains the content
        // Handle <br> tags as line breaks
        const clone = codeBlock.cloneNode(true);
        
        // Replace <br> with newlines
        clone.querySelectorAll('br').forEach(br => {
          br.replaceWith('\n');
        });
        
        // Remove any non-content elements (like expand controls)
        clone.querySelectorAll('.expand-control, .expand-icon, button, .linenumber, .line-numbers').forEach(el => el.remove());
        
        codeContent = clone.textContent || clone.innerText || '';
      }
      
      // Clean up the content
      codeContent = codeContent
        .replace(/^\s*\n/, '')     // Remove leading empty line
        .replace(/\n\s*$/, '');    // Remove trailing empty line
      
      // Debug: log extracted content
      console.log('Confluence2Notion: Code block content extracted', {
        language: language,
        contentLength: codeContent.length,
        contentPreview: codeContent.substring(0, 200),
        hasNestedCodeElement: !!codeElement
      });
      
      // Create standardized <pre><code> structure
      const pre = document.createElement('pre');
      const codeEl = document.createElement('code');
      
      if (language && language !== 'plain text') {
        codeEl.className = `language-${language}`;
        codeEl.setAttribute('data-language', language);
      }
      
      codeEl.textContent = codeContent;
      pre.appendChild(codeEl);
      codeBlock.replaceWith(pre);
    });
  });
  
  // ============================================================================
  // Now process Info panels (after code blocks have been extracted)
  // ============================================================================
  
  // Info panels (Information, Warning, Note, Tip)
  // Note: Be careful not to match code panels (.code.panel)
  const infoPanelSelectors = [
    '.confluence-information-macro',
    '.information-macro',
    '.panel:not(.code)',              // Exclude code panels
    '[data-macro-name="info"]',
    '[data-macro-name="note"]',
    '[data-macro-name="warning"]',
    '[data-macro-name="tip"]',
    '[data-macro-name="Tip"]',
    '[data-macro-name="TIP"]',
    '.ak-note-panel',
    '.ak-info-panel',
    '.ak-warning-panel',
    '.ak-tip-panel',
    '.ak-tip',
    '.tip-macro',
    '.confluence-tip-macro',
    '[data-macro-type="tip"]',
    '[data-macro-type="Tip"]',
    // Confluence Cloud specific
    '[data-testid="tip-panel"]',
    '[data-testid="tip-macro"]',
  ];
  
  infoPanelSelectors.forEach(selector => {
    element.querySelectorAll(selector).forEach(panel => {
      // Skip if this is a code block (already processed or shouldn't be wrapped)
      if (panel.classList.contains('code') || 
          panel.getAttribute('data-macro-name') === 'code' ||
          panel.getAttribute('data-macro-name') === 'markdown') {
        return;
      }
      
      let type = 'info';
      
      // Determine panel type
      if (panel.classList.contains('confluence-information-macro-information') ||
          panel.classList.contains('information-macro-information') ||
          panel.classList.contains('ak-info-panel') ||
          panel.getAttribute('data-macro-name') === 'info') {
        type = 'info';
      } else if (panel.classList.contains('confluence-information-macro-warning') ||
                 panel.classList.contains('information-macro-warning') ||
                 panel.classList.contains('ak-warning-panel') ||
                 panel.getAttribute('data-macro-name') === 'warning') {
        type = 'warning';
      } else if (panel.classList.contains('confluence-information-macro-note') ||
                 panel.classList.contains('information-macro-note') ||
                 panel.classList.contains('ak-note-panel') ||
                 panel.getAttribute('data-macro-name') === 'note') {
        type = 'note';
      } else if (panel.classList.contains('confluence-information-macro-tip') ||
                 panel.classList.contains('information-macro-tip') ||
                 panel.classList.contains('ak-tip-panel') ||
                 panel.classList.contains('ak-tip') ||
                 panel.classList.contains('tip-macro') ||
                 panel.classList.contains('confluence-tip-macro') ||
                 panel.getAttribute('data-macro-name')?.toLowerCase() === 'tip' ||
                 panel.getAttribute('data-macro-type')?.toLowerCase() === 'tip' ||
                 panel.getAttribute('data-testid')?.includes('tip') ||
                 panel.getAttribute('title')?.toLowerCase().includes('tip')) {
        type = 'tip';
      }
      
      const body = panel.querySelector('.confluence-information-macro-body') ||
                   panel.querySelector('.information-macro-body') ||
                   panel.querySelector('.panel-body') ||
                   panel.querySelector('.ak-note-panel-body') ||
                   panel.querySelector('.ak-tip-panel-body') ||
                   panel.querySelector('.tip-macro-body') ||
                   panel.querySelector('[data-testid="tip-panel-body"]') ||
                   panel.querySelector('.panel-content') ||
                   panel;
      
      // IMPORTANT: Extract any code blocks (<pre>) from inside the panel
      // Code blocks should NOT be inside the blockquote
      const codeBlocksInside = body.querySelectorAll('pre');
      const extractedCodeBlocks = [];
      codeBlocksInside.forEach(pre => {
        // Clone the pre element
        const clone = pre.cloneNode(true);
        extractedCodeBlocks.push(clone);
        // Remove from body
        pre.remove();
      });
      
      const content = body.innerHTML || panel.innerHTML;
      const wrapper = document.createElement('blockquote');
      wrapper.setAttribute('data-panel-type', type);
      wrapper.className = `confluence-panel confluence-panel-${type}`;
      wrapper.innerHTML = content;
      
      // Replace the panel with the wrapper
      panel.replaceWith(wrapper);
      
      // Insert extracted code blocks AFTER the blockquote
      if (extractedCodeBlocks.length > 0) {
        let insertPoint = wrapper;
        extractedCodeBlocks.forEach(codeBlock => {
          insertPoint.after(codeBlock);
          insertPoint = codeBlock;
        });
      }
    });
  });
  
  // Expand macros (show content, remove expand functionality)
  const expandSelectors = [
    '.expand-container',
    '.expand',
    '.expand-control',
    '.collapsible',
    '.collapse',
    '[data-macro-name="expand"]',
    '.ak-expand',
  ];
  
  expandSelectors.forEach(selector => {
    element.querySelectorAll(selector).forEach(expand => {
      const content = expand.querySelector('.expand-content') ||
                     expand.querySelector('.expand-body') ||
                     expand.querySelector('.collapsible-content') ||
                     expand.querySelector('.collapse-content') ||
                     expand.querySelector('.ak-expand-content');
      
      if (content) {
        const div = document.createElement('div');
        div.className = 'expanded-content';
        div.innerHTML = content.innerHTML;
        expand.replaceWith(div);
      } else {
        // If no content wrapper, just remove the expand button/control
        const controls = expand.querySelectorAll('.expand-control, .expand-button, .collapse-button, .expand-toggle');
        controls.forEach(ctrl => ctrl.remove());
      }
    });
  });
  
  // Status macros / Lozenge badges
  const statusSelectors = [
    '.status-macro',
    '.aui-lozenge',
    '.lozenge',
    '.status',
    '.badge',
    '.label',
    '[data-macro-name="status"]',
    '.ak-renderer-status',
  ];
  
  statusSelectors.forEach(selector => {
    element.querySelectorAll(selector).forEach(status => {
      const text = status.textContent.trim();
      if (text) {
        const span = document.createElement('span');
        span.className = 'confluence-status';
        span.textContent = `[${text}]`;
        status.replaceWith(span);
      }
    });
  });
  
  // User mentions
  const userMentionSelectors = [
    '.confluence-userlink',
    '.user-hover',
    '.user-mention',
    '.mention',
    '[data-username]',
    '[data-user-key]',
    '.ak-renderer-user-mention',
  ];
  
  userMentionSelectors.forEach(selector => {
    element.querySelectorAll(selector).forEach(mention => {
      const username = mention.getAttribute('data-username') ||
                      mention.getAttribute('data-user-key') ||
                      mention.textContent.trim() ||
                      mention.getAttribute('title') ||
                      '';
      
      if (username) {
        const span = document.createElement('span');
        span.className = 'confluence-user-mention';
        span.textContent = `@${username}`;
        mention.replaceWith(span);
      }
    });
  });
  
  // Page links (convert to readable format)
  const pageLinkSelectors = [
    '.confluence-page-link',
    '.page-link',
    '[data-page-id]',
    '[data-page-title]',
    '.ak-renderer-page-link',
  ];
  
  pageLinkSelectors.forEach(selector => {
    element.querySelectorAll(selector).forEach(link => {
      const pageTitle = link.getAttribute('data-page-title') ||
                       link.getAttribute('title') ||
                       link.textContent.trim() ||
                       '';
      
      if (pageTitle && link.tagName === 'A') {
        link.textContent = pageTitle;
        // Keep the href for proper link conversion
      }
    });
  });
  
  // Table of Contents macro (remove completely - not needed in Notion)
  // TOC is auto-generated in Notion, so we don't need to convert it
  const tocSelectors = [
    '.toc-macro',
    '.table-of-contents',
    '[data-macro-name="toc"]',
    '[data-macro-name="TOC"]',
    '[data-macro-name="table-of-contents"]',
    '.confluence-toc-macro',
    '.ak-toc-macro',
    '[data-testid="toc-macro"]',
    '[data-testid="table-of-contents"]',
    // Confluence Cloud specific
    '.ak-renderer-toc',
    '.toc',
  ];
  
  tocSelectors.forEach(selector => {
    element.querySelectorAll(selector).forEach(toc => {
      // Remove TOC completely - Notion has its own TOC feature
      toc.remove();
    });
  });
  
  // JIRA issue links (preserve but clean up)
  element.querySelectorAll('.jira-issue, .issue-link, [data-issue-key]').forEach(issue => {
    const issueKey = issue.getAttribute('data-issue-key') ||
                    issue.textContent.trim() ||
                    '';
    if (issueKey && issue.tagName === 'A') {
      issue.textContent = issueKey;
    }
  });
  
  // Attachment links (preserve but mark)
  element.querySelectorAll('.confluence-embedded-file, .attachment-link, [data-attachment-id]').forEach(attachment => {
    if (attachment.tagName === 'A') {
      attachment.classList.add('confluence-attachment');
      // Keep the link as-is for proper conversion
    }
  });
  
  // Diagram and flowchart macros (draw.io, Gliffy, etc.)
  const diagramSelectors = [
    '.diagram-macro',
    '.drawio-macro',
    '.gliffy-macro',
    '[data-macro-name="drawio"]',
    '[data-macro-name="gliffy"]',
    '[data-macro-name="diagram"]',
    '.confluence-diagram',
    '.ak-renderer-diagram',
  ];
  
  diagramSelectors.forEach(selector => {
    element.querySelectorAll(selector).forEach(diagram => {
      // Try to extract diagram image or description
      const img = diagram.querySelector('img');
      const title = diagram.getAttribute('data-title') || 
                   diagram.querySelector('.diagram-title, .macro-title')?.textContent ||
                   'Diagram';
      
      if (img && img.src) {
        // Replace with image
        const imgEl = document.createElement('img');
        imgEl.src = img.src;
        imgEl.alt = title;
        imgEl.title = title;
        diagram.replaceWith(imgEl);
      } else {
        // Replace with description or title
        const div = document.createElement('div');
        div.className = 'diagram-placeholder';
        div.innerHTML = `<strong>📊 ${title}</strong><br><em>Diagram content preserved in text format</em>`;
        if (diagram.textContent.trim()) {
          div.innerHTML += '<br>' + diagram.textContent.trim();
        }
        diagram.replaceWith(div);
      }
    });
  });
  
  // Panel macros (colored boxes) - preserve structure better
  const panelSelectors = [
    '.panel',
    '.confluence-panel',
    '[data-macro-name="panel"]',
    '.ak-panel',
  ];
  
  panelSelectors.forEach(selector => {
    element.querySelectorAll(selector).forEach(panel => {
      // Check if it's already an info panel (handled above)
      if (panel.classList.contains('confluence-information-macro') ||
          panel.classList.contains('information-macro')) {
        return; // Skip, already handled
      }
      
      // Extract panel content and preserve structure
      const content = panel.innerHTML || panel.textContent;
      const title = panel.getAttribute('data-title') ||
                   panel.querySelector('.panel-title, .macro-title')?.textContent ||
                   '';
      
      // Create a div to preserve the panel content
      const wrapper = document.createElement('div');
      wrapper.className = 'confluence-panel-content';
      
      if (title) {
        const titleEl = document.createElement('strong');
        titleEl.textContent = title;
        wrapper.appendChild(titleEl);
        wrapper.appendChild(document.createElement('br'));
      }
      
      // Preserve the content
      if (panel.innerHTML) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = panel.innerHTML;
        wrapper.appendChild(tempDiv);
      } else {
        wrapper.textContent = content;
      }
      
      panel.replaceWith(wrapper);
    });
  });
  
  // Process flowcharts and process flows (text with arrows)
  // Look for patterns like "A → B → C" and preserve them
  element.querySelectorAll('*').forEach(node => {
    if (node.children.length === 0 && node.textContent) {
      // Check if text contains flow indicators
      const text = node.textContent;
      if (text.includes('→') || text.includes('->') || text.match(/[A-Z][a-z]+(?:\s*→\s*[A-Z][a-z]+)+/)) {
        // This might be a flowchart - preserve the structure
        node.innerHTML = text
          .replace(/\s*→\s*/g, ' → ')
          .replace(/\s*->\s*/g, ' → ');
      }
    }
  });
  
  // Remove macro wrappers that don't add value
  element.querySelectorAll('.macro, .confluence-macro, [data-macro-name]').forEach(macro => {
    // Only remove if it's empty or just a wrapper
    if (!macro.textContent.trim() || macro.children.length === 0) {
      macro.remove();
    }
  });
}

/**
 * Clean up empty elements (but keep structural ones)
 * @param {HTMLElement} element - Element to clean
 */
function cleanupEmptyElements(element) {
  if (!element) return;
  
  // Remove empty elements (but keep br, hr, img, etc.)
  const emptyElements = element.querySelectorAll('*');
  emptyElements.forEach(el => {
    // Skip structural elements
    if (['BR', 'HR', 'IMG', 'INPUT', 'META', 'LINK'].includes(el.tagName)) {
      return;
    }
    
    // Skip if it has meaningful attributes
    if (el.hasAttribute('id') || el.hasAttribute('class') || el.hasAttribute('data-')) {
      // Check if it has meaningful content
      const text = el.textContent?.trim() || '';
      const hasChildren = el.children.length > 0;
      const hasImages = el.querySelectorAll('img').length > 0;
      
      if (!text && !hasChildren && !hasImages) {
        // Empty element with no meaningful content
        el.remove();
      }
    } else {
      // No meaningful attributes, check if empty
      const text = el.textContent?.trim() || '';
      const hasChildren = el.children.length > 0;
      const hasImages = el.querySelectorAll('img').length > 0;
      
      if (!text && !hasChildren && !hasImages) {
        el.remove();
      }
    }
  });
}

/**
 * Get page metadata
 * @returns {Object} Page metadata
 */
function getPageMetadata() {
  const url = window.location.href;
  
  return {
    url: url,
    timestamp: new Date().toISOString(),
    space: extractSpaceKey(),
    pageId: extractPageId(),
    spaceName: extractSpaceName(),
  };
}

/**
 * Extract Confluence space key from URL
 * @returns {string|null} Space key
 */
function extractSpaceKey() {
  const url = window.location.href;
  
  // Cloud format: /wiki/spaces/SPACEKEY/...
  const cloudMatch = url.match(/\/wiki\/spaces\/([^/?]+)/);
  if (cloudMatch) return cloudMatch[1];
  
  // Server format: /display/SPACEKEY/...
  const serverMatch = url.match(/\/display\/([^/?]+)/);
  if (serverMatch) return serverMatch[1];
  
  // Alternative format: /confluence/display/SPACEKEY/...
  const altMatch = url.match(/\/confluence\/display\/([^/?]+)/);
  if (altMatch) return altMatch[1];
  
  return null;
}

/**
 * Extract Confluence page ID from URL
 * @returns {string|null} Page ID
 */
function extractPageId() {
  const url = window.location.href;
  
  // Cloud format: /wiki/spaces/SPACEKEY/pages/PAGEID/...
  const cloudMatch = url.match(/\/pages\/(\d+)/);
  if (cloudMatch) return cloudMatch[1];
  
  // Server format: /display/SPACEKEY/PAGEID or /pages/viewpage.action?pageId=PAGEID
  const serverMatch = url.match(/\/display\/[^/]+\/(\d+)/);
  if (serverMatch) return serverMatch[1];
  
  const paramMatch = url.match(/[?&]pageId=(\d+)/);
  if (paramMatch) return paramMatch[1];
  
  return null;
}

/**
 * Extract Confluence space name (if available in DOM)
 * @returns {string|null} Space name
 */
function extractSpaceName() {
  // Try to find space name in DOM
  const spaceElement = document.querySelector('[data-space-key], .space-name, .space-title');
  if (spaceElement) {
    return spaceElement.textContent?.trim() || spaceElement.getAttribute('data-space-name');
  }
  
  // Try meta tags
  const metaSpace = document.querySelector('meta[property="og:site_name"], meta[name="space-name"]');
  if (metaSpace) {
    return metaSpace.getAttribute('content');
  }
  
  return null;
}

// ============================================================================
// Public API
// ============================================================================
/**
 * Parse the current Confluence page
 * @returns {Object} Parsed page data
 */
function parseConfluencePage() {
  const detection = detectConfluence();
  
  if (!detection.isConfluence) {
    return {
      success: false,
      error: 'Not a Confluence page',
    };
  }
  
  try {
    const title = extractTitle(detection.version);
    const htmlContent = extractContent(detection.version);
    const metadata = getPageMetadata();
    
    return {
      success: true,
      data: {
        title,
        htmlContent,
        metadata,
        version: detection.version,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Export for use in content script
// Prevent duplicate assignment if script is injected multiple times
if (typeof window !== 'undefined' && typeof window.ConfluenceParser === 'undefined') {
  window.ConfluenceParser = {
    detectConfluence,
    parseConfluencePage,
    extractTitle,
    extractContent,
    getPageMetadata,
  };
}
