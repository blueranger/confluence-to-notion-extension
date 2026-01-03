/**
 * Confluence2Notion - Popup Script
 * Handles the popup UI logic and coordinates with content script and background worker
 */

// ============================================================================
// Constants
// ============================================================================
const STORAGE_KEYS = {
  API_TOKEN: 'notionApiToken',
  PARENT_PAGE_ID: 'defaultParentPageId',
  INCLUDE_IMAGES: 'includeImages',
  ADD_SOURCE_LINK: 'addSourceLink',
};

// ============================================================================
// DOM Elements
// ============================================================================
const views = {
  settings: document.getElementById('settings-view'),
  main: document.getElementById('main-view'),
  processing: document.getElementById('processing-view'),
  success: document.getElementById('success-view'),
  error: document.getElementById('error-view'),
  notConfluence: document.getElementById('not-confluence-view'),
};

const elements = {
  // Settings
  apiToken: document.getElementById('api-token'),
  parentPageId: document.getElementById('parent-page-id'),
  saveSettings: document.getElementById('save-settings'),
  
  // Main
  confluenceTitle: document.getElementById('confluence-title'),
  targetPage: document.getElementById('target-page'),
  changeTarget: document.getElementById('change-target'),
  includeImages: document.getElementById('include-images'),
  addSourceLink: document.getElementById('add-source-link'),
  sendToNotion: document.getElementById('send-to-notion'),
  downloadInternalImages: document.getElementById('download-internal-images'),
  openSettings: document.getElementById('open-settings'),
  
  // Processing
  processingStatus: document.getElementById('processing-status'),
  progress: document.getElementById('progress'),
  progressPercentage: document.getElementById('progress-percentage'),
  
  // Success
  notionLink: document.getElementById('notion-link'),
  done: document.getElementById('done'),
  
  // Error
  errorMessage: document.getElementById('error-message'),
  retry: document.getElementById('retry'),
  back: document.getElementById('back'),
};

// ============================================================================
// State
// ============================================================================
let currentState = {
  isConfluencePage: false,
  pageTitle: '',
  pageUrl: '',
  settings: {
    apiToken: '',
    parentPageId: '',
    includeImages: true,
    addSourceLink: true,
  },
};

// ============================================================================
// View Management
// ============================================================================
/**
 * Show a specific view and hide all others
 * @param {string} viewName - Name of the view to show
 */
function showView(viewName) {
  Object.entries(views).forEach(([name, element]) => {
    if (name === viewName) {
      element.classList.remove('hidden');
    } else {
      element.classList.add('hidden');
    }
  });
}

/**
 * Update progress bar and status text
 * @param {number} percent - Progress percentage (0-100)
 * @param {string} status - Status message
 */
function updateProgress(percent, status) {
  const clampedPercent = Math.min(Math.max(percent, 0), 100);
  elements.progress.style.width = `${clampedPercent}%`;
  elements.processingStatus.textContent = status;
  elements.progressPercentage.textContent = `${Math.round(clampedPercent)}%`;
}

// ============================================================================
// Storage Operations
// ============================================================================
/**
 * Load settings from Chrome storage
 * @returns {Promise<Object>} Settings object
 */
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(Object.values(STORAGE_KEYS), (result) => {
      resolve({
        apiToken: result[STORAGE_KEYS.API_TOKEN] || '',
        parentPageId: result[STORAGE_KEYS.PARENT_PAGE_ID] || '',
        includeImages: result[STORAGE_KEYS.INCLUDE_IMAGES] !== false,
        addSourceLink: result[STORAGE_KEYS.ADD_SOURCE_LINK] !== false,
      });
    });
  });
}

/**
 * Save settings to Chrome storage
 * @param {Object} settings - Settings to save
 * @returns {Promise<void>}
 */
async function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({
      [STORAGE_KEYS.API_TOKEN]: settings.apiToken,
      [STORAGE_KEYS.PARENT_PAGE_ID]: settings.parentPageId,
      [STORAGE_KEYS.INCLUDE_IMAGES]: settings.includeImages,
      [STORAGE_KEYS.ADD_SOURCE_LINK]: settings.addSourceLink,
    }, resolve);
  });
}

// ============================================================================
// Tab Communication
// ============================================================================
/**
 * Get the current active tab
 * @returns {Promise<chrome.tabs.Tab>}
 */
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Check if we can inject scripts into the current page
 * @param {number} tabId - Tab ID
 * @returns {Promise<boolean>} True if injection is possible
 */
async function canInjectScripts(tabId) {
  try {
    // Try to check if we can access the page
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';
    
    // Cannot inject into special pages
    if (url.startsWith('chrome://') || 
        url.startsWith('chrome-extension://') ||
        url.startsWith('edge://') ||
        url.startsWith('about:')) {
      return false;
    }
    
    // Check if page is accessible
    if (tab.status !== 'complete') {
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Cannot check script injection:', error);
    return false;
  }
}

/**
 * Inject a simple test script to verify injection works
 * @param {number} tabId - Tab ID
 * @returns {Promise<boolean>} True if test script works
 */
async function testScriptInjection(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // Set a test flag
        window.__confluence2notion_test__ = true;
        return true;
      }
    });
    return result[0]?.result === true;
  } catch (error) {
    console.error('Test injection failed:', error);
    return false;
  }
}

/**
 * Inject content scripts into the page
 * @param {number} tabId - Tab ID
 * @returns {Promise<{success: boolean, error?: string}>} Injection result
 */
async function injectContentScripts(tabId) {
  try {
    // First, test if we can inject at all
    const canTestInject = await testScriptInjection(tabId);
    if (!canTestInject) {
      return {
        success: false,
        error: 'Cannot inject scripts into this page (test injection failed)'
      };
    }
    
    // Check if we can inject
    const canInject = await canInjectScripts(tabId);
    if (!canInject) {
      const tab = await chrome.tabs.get(tabId);
      return {
        success: false,
        error: `Cannot inject scripts into page type: ${tab.url?.substring(0, 50)}...`
      };
    }
    
    console.log('Injecting content scripts...');
    
    // Inject scripts one by one to better handle errors
    const scriptFiles = [
      'src/lib/turndown.js',
      'src/lib/turndown-plugin-gfm.js',
      'src/content/confluence-parser.js',
      'src/content/content-script.js'
    ];
    
    for (const file of scriptFiles) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: [file],
        });
        console.log(`✓ Injected: ${file}`);
      } catch (fileError) {
        console.error(`✗ Failed to inject ${file}:`, fileError);
        // Continue with other files - some might already be injected
      }
    }
    
    // Verify injection by testing actual message response
    try {
      // Wait a bit for scripts to initialize
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Test if we can actually communicate
      const testResponse = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      if (testResponse && testResponse.pong) {
        console.log('✓ Content script verified - responding to messages');
        return { success: true };
      } else {
        console.warn('⚠ Content script injected but not responding to PING');
        return { success: true }; // Still return success, might need more time
      }
    } catch (verifyError) {
      console.warn('Could not verify script injection:', verifyError.message);
      // Check status anyway
      try {
        const checkResult = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => {
            return {
              listenerReady: typeof window.confluence2NotionMessageListenerReady !== 'undefined',
              scriptReady: typeof window.confluence2NotionReady !== 'undefined',
              parserAvailable: typeof window.ConfluenceParser !== 'undefined'
            };
          }
        });
        const status = checkResult[0]?.result;
        console.log('Script status:', status);
      } catch (e) {
        // Ignore
      }
      // Still return success - verification might fail but scripts could be working
      return { success: true };
    }
    
  } catch (error) {
    console.error('Script injection failed:', error);
    return {
      success: false,
      error: error.message || 'Unknown injection error'
    };
  }
}

/**
 * Test if content script is responding
 * @param {number} tabId - Tab ID
 * @returns {Promise<boolean>} True if script responds
 */
async function testContentScriptConnection(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return response && response.pong === true;
  } catch (error) {
    return false;
  }
}

/**
 * Send a message to the content script with retry logic
 * @param {Object} message - Message to send
 * @param {number} retries - Number of retries
 * @returns {Promise<any>} Response from content script
 */
async function sendToContentScript(message, retries = 5) {
  const tab = await getCurrentTab();
  
  // First, test if content script is responding
  const isResponding = await testContentScriptConnection(tab.id);
  console.log('Content script responding:', isResponding);
  
  // If not responding, try to inject
  let scriptsInjected = false;
  if (!isResponding) {
    console.log('Content script not responding, attempting injection...');
    const injectResult = await injectContentScripts(tab.id);
    if (injectResult.success) {
      scriptsInjected = true;
      // Wait for scripts to initialize
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // Test again
      const stillNotResponding = !(await testContentScriptConnection(tab.id));
      if (stillNotResponding) {
        console.warn('Scripts injected but still not responding');
      }
    }
  }
  
  // Now try to send the actual message
  for (let i = 0; i < retries; i++) {
    try {
      // Set a timeout for the message
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, message),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Message timeout')), 5000)
        )
      ]);
      
      if (response) {
        return response;
      }
      
      throw new Error('Empty response from content script');
    } catch (error) {
      console.log(`Attempt ${i + 1}/${retries} failed:`, error.message);
      
      // If receiving end doesn't exist, try to inject scripts again
      if (error.message.includes('Receiving end does not exist') || 
          error.message.includes('Could not establish connection') ||
          error.message.includes('message port closed') ||
          error.message.includes('Message timeout')) {
        
        if (i < retries - 1) {
          // Try to inject again or wait longer
          if (!scriptsInjected) {
            console.log('Attempting to inject content scripts...');
            const injectResult = await injectContentScripts(tab.id);
            if (injectResult.success) {
              scriptsInjected = true;
            }
          }
          
          // Wait longer each retry
          const waitTime = 600 + (i * 200); // 600ms, 800ms, 1000ms, etc.
          console.log(`Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          
          // Test connection before retrying
          const testResult = await testContentScriptConnection(tab.id);
          console.log('Connection test after wait:', testResult);
          
          continue;
        }
      }
      
      // If this is the last retry, provide detailed error
      if (i === retries - 1) {
        const url = tab.url || 'unknown';
        
        // Test one more time
        const finalTest = await testContentScriptConnection(tab.id);
        
        let errorMsg = '';
        if (scriptsInjected) {
          if (finalTest) {
            errorMsg = 'Content script is responding but message handling failed. ';
            errorMsg += 'Please check the browser console for errors.';
          } else {
            errorMsg = 'Content script injected but not responding. ';
            errorMsg += 'This might be due to page security restrictions or script errors. ';
            errorMsg += 'Please refresh the page and try again.';
          }
        } else {
          errorMsg = 'Could not inject content script. ';
          errorMsg += `URL: ${url.substring(0, 80)}... `;
          errorMsg += 'Please ensure you are on a Confluence page and refresh the page.';
        }
        throw new Error(errorMsg);
      }
    }
  }
  
  throw new Error('Failed to communicate with content script after retries');
}

/**
 * Check if content script is already loaded and message listener is ready
 * @param {number} tabId - Tab ID
 * @returns {Promise<boolean>} True if script is loaded and listener is ready
 */
async function isContentScriptLoaded(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const ready = typeof window.confluence2NotionReady !== 'undefined' && 
                     window.confluence2NotionReady === true;
        const listenerReady = typeof window.confluence2NotionMessageListenerReady !== 'undefined' &&
                             window.confluence2NotionMessageListenerReady === true;
        return ready && listenerReady;
      }
    });
    return results[0]?.result === true;
  } catch (error) {
    console.log('Could not check if content script is loaded:', error);
    return false;
  }
}

/**
 * Check if the current page is a Confluence page
 * @returns {Promise<Object>} Page info or null
 */
async function checkConfluencePage() {
  try {
    const tab = await getCurrentTab();
    
    // Check URL first for quick detection
    const url = tab.url || '';
    const hostname = new URL(url).hostname.toLowerCase();
    
    // Quick check: if URL looks like Confluence, inject scripts
    const looksLikeConfluence = 
      hostname.includes('confluence') ||
      url.includes('/wiki/') ||
      url.includes('/confluence/') ||
      url.includes('/display/') ||
      url.includes('/spaces/') ||
      url.includes('/pages/') ||
      hostname.includes('atlassian.net') ||
      hostname.includes('atlassian.com');
    
    if (!looksLikeConfluence) {
      return { isConfluence: false };
    }
    
    // Check if content script is already loaded (from manifest)
    const alreadyLoaded = await isContentScriptLoaded(tab.id);
    console.log('Content script already loaded:', alreadyLoaded);
    
    // Try to inject scripts if not already loaded
    if (looksLikeConfluence && !alreadyLoaded) {
      try {
        console.log('Pre-injecting scripts for Confluence page...');
        const injectResult = await injectContentScripts(tab.id);
        if (injectResult.success) {
          console.log('Scripts pre-injected successfully');
          // Wait for scripts to initialize
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          console.warn('Pre-injection failed:', injectResult.error);
          // Continue anyway - sendToContentScript will retry
        }
      } catch (injectError) {
        // Script might already be injected, or page might not allow injection
        console.log('Initial script injection note:', injectError.message);
        // Continue anyway - sendToContentScript will retry
      }
    } else if (alreadyLoaded) {
      console.log('Content script already loaded from manifest, waiting for initialization...');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Then check if it's a Confluence page (with retry logic built in)
    try {
      const response = await sendToContentScript({ type: 'CHECK_PAGE' });
      return response;
    } catch (error) {
      // If message fails, scripts might not be ready
      console.error('Failed to check page:', error);
      
      // Return fallback based on URL if it looks like Confluence
      if (looksLikeConfluence) {
        console.log('Using fallback detection based on URL');
        return {
          isConfluence: true,
          title: tab.title || 'Confluence Page',
          url: url,
          version: 'fallback'
        };
      }
      
      // Re-throw the error with more context
      throw new Error(
        `Cannot access Confluence page: ${error.message}. ` +
        `Please ensure you are on a Confluence page and refresh the page.`
      );
    }
  } catch (error) {
    console.error('Error checking page:', error);
    // Fallback: if URL looks like Confluence, assume it is
    const tab = await getCurrentTab();
    const url = tab.url || '';
    if (url.includes('confluence') || url.includes('/spaces/') || url.includes('/pages/')) {
      return { 
        isConfluence: true, 
        title: tab.title || 'Confluence Page',
        url: url,
        version: 'fallback'
      };
    }
    return { isConfluence: false };
  }
}

// ============================================================================
// Main Flow
// ============================================================================
/**
 * Initialize the popup
 */
async function init() {
  // Load settings
  currentState.settings = await loadSettings();
  
  // Update UI with saved settings
  elements.apiToken.value = currentState.settings.apiToken;
  elements.parentPageId.value = currentState.settings.parentPageId;
  elements.includeImages.checked = currentState.settings.includeImages;
  elements.addSourceLink.checked = currentState.settings.addSourceLink;
  
  // Check if we have required settings
  if (!currentState.settings.apiToken || !currentState.settings.parentPageId) {
    showView('settings');
    return;
  }
  
  // Check if current page is Confluence
  const pageInfo = await checkConfluencePage();
  
  if (!pageInfo.isConfluence) {
    showView('notConfluence');
    return;
  }
  
  // Update state and show main view
  currentState.isConfluencePage = true;
  currentState.pageTitle = pageInfo.title;
  currentState.pageUrl = pageInfo.url;
  
  elements.confluenceTitle.textContent = pageInfo.title || 'Untitled';
  elements.targetPage.textContent = shortenPageId(currentState.settings.parentPageId);
  
  showView('main');
}

/**
 * Handle the send to Notion action
 */
async function handleSendToNotion() {
  showView('processing');
  updateProgress(0, 'Preparing...');
  
  // Set up progress listener for messages from background worker
  const progressListener = (message, sender, sendResponse) => {
    if (message.type === 'PROGRESS_UPDATE') {
      updateProgress(message.percent, message.status);
    }
    return false; // Don't send response
  };
  
  chrome.runtime.onMessage.addListener(progressListener);
  
  // Also poll chrome.storage for progress updates (fallback)
  const progressPollInterval = setInterval(async () => {
    try {
      const result = await chrome.storage.local.get('progressUpdate');
      if (result.progressUpdate) {
        const { percent, status, timestamp } = result.progressUpdate;
        // Only use if recent (within last 5 seconds)
        if (Date.now() - timestamp < 5000) {
          updateProgress(percent, status);
        }
      }
    } catch (error) {
      // Ignore errors
    }
  }, 300); // Poll every 300ms
  
  try {
    // Step 1: Parse Confluence page
    updateProgress(5, 'Detecting Confluence page...');
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Step 2: Extract HTML content
    updateProgress(10, 'Extracting page content...');
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Step 3: Get Markdown content from content script
    updateProgress(20, 'Converting HTML to Markdown...');
    const contentResponse = await sendToContentScript({
      type: 'GET_MARKDOWN',
      options: {
        includeImages: elements.includeImages.checked,
      },
    });
    
    if (!contentResponse.success) {
      throw new Error(contentResponse.error || 'Failed to extract content');
    }
    
    updateProgress(40, 'Markdown conversion complete');
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Step 4: Convert Markdown to Notion blocks and create page
    updateProgress(50, 'Preparing to send to Notion...');
    
    // Validate parent page ID before sending
    const parentPageId = extractNotionPageId(currentState.settings.parentPageId) || 
                         currentState.settings.parentPageId;
    
    if (!isValidNotionPageId(parentPageId)) {
      throw new Error(
        'Invalid parent page ID. Please check your settings.\n\n' +
        'The page ID should be a 32-character hex string. ' +
        'You can copy it from the end of your Notion page URL.'
      );
    }
    
    // Create a promise that resolves when the page is created
    // The background worker will send progress updates via messages
    console.log('Confluence2Notion Popup: Sending CREATE_NOTION_PAGE message', {
      hasTitle: !!currentState.pageTitle,
      hasMarkdown: !!contentResponse.markdown,
      markdownLength: contentResponse.markdown?.length,
      hasParentPageId: !!parentPageId,
      hasApiToken: !!currentState.settings.apiToken,
    });
    
    const createPagePromise = chrome.runtime.sendMessage({
      type: 'CREATE_NOTION_PAGE',
      data: {
        title: currentState.pageTitle,
        markdown: contentResponse.markdown,
        parentPageId: parentPageId,
        apiToken: currentState.settings.apiToken,
        sourceUrl: elements.addSourceLink.checked ? currentState.pageUrl : null,
      },
    }).catch(error => {
      console.error('Confluence2Notion Popup: Error sending message', error);
      throw new Error(`Failed to send message to background worker: ${error.message}`);
    });
    
    // Add timeout to prevent hanging (5 minutes for large pages)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        console.error('Confluence2Notion Popup: Request timed out after 5 minutes');
        reject(new Error('Request timed out after 5 minutes. Please check the background worker console for errors.'));
      }, 300000); // 5 minutes
    });
    
    console.log('Confluence2Notion Popup: Waiting for response...');
    const result = await Promise.race([createPagePromise, timeoutPromise]);
    console.log('Confluence2Notion Popup: Received response', result);
    
    // Final progress update
    updateProgress(100, 'Done!');
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to create Notion page');
    }
    
    // Remove progress listener and polling
    chrome.runtime.onMessage.removeListener(progressListener);
    clearInterval(progressPollInterval);
    
    // Clear progress storage
    chrome.storage.local.remove('progressUpdate').catch(() => {});
    
    // Show success after a brief delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Show success
    elements.notionLink.href = result.pageUrl;
    showView('success');
    
  } catch (error) {
    // Remove progress listener and polling on error
    chrome.runtime.onMessage.removeListener(progressListener);
    if (typeof progressPollInterval !== 'undefined') {
      clearInterval(progressPollInterval);
    }
    
    // Clear progress storage
    chrome.storage.local.remove('progressUpdate').catch(() => {});
    
    console.error('Error:', error);
    elements.errorMessage.textContent = error.message;
    showView('error');
  }
}

/**
 * Handle download internal images
 */
async function handleDownloadInternalImages() {
  showView('processing');
  updateProgress(0, 'Collecting images...');
  
  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('Could not get current tab');
    }
    
    // Send message to content script to collect internal images
    updateProgress(10, 'Scanning page for images...');
    const imageResponse = await sendToContentScript({
      type: 'COLLECT_INTERNAL_IMAGES',
    });
    
    if (!imageResponse.success) {
      throw new Error(imageResponse.error || 'Failed to collect images');
    }
    
    const images = imageResponse.images || [];
    
    if (images.length === 0) {
      updateProgress(100, 'No internal images found');
      await new Promise(resolve => setTimeout(resolve, 2000));
      showView('main');
      return;
    }
    
    updateProgress(30, `Found ${images.length} images. Downloading...`);
    
    // Send to background worker to download and package
    const downloadResponse = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_AND_PACKAGE_IMAGES',
      data: {
        images: images,
        pageTitle: currentState.pageTitle || 'confluence-page',
      },
    });
    
    if (!downloadResponse.success) {
      throw new Error(downloadResponse.error || 'Failed to download images');
    }
    
    updateProgress(90, 'Creating package...');
    
    // Download the ZIP file
    // ZIP is passed as base64 string (ArrayBuffer cannot be serialized in Chrome messages)
    const base64 = downloadResponse.base64;
    if (!base64) {
      throw new Error('No file data received');
    }
    
    // Convert base64 to Blob
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'application/zip' });
    
    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadResponse.filename || 'confluence-images.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    updateProgress(100, `Downloaded ${images.length} images!`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    showView('main');
    
  } catch (error) {
    console.error('Error downloading images:', error);
    elements.errorMessage.textContent = error.message || 'Failed to download images';
    showView('error');
  }
}

/**
 * Handle save settings
 */
async function handleSaveSettings() {
  const rawApiToken = elements.apiToken.value.trim();
  const rawParentPageId = elements.parentPageId.value.trim();
  
  // Validate API token
  if (!rawApiToken) {
    alert('Please enter your Notion API token');
    elements.apiToken.focus();
    return;
  }
  
  // Validate and extract parent page ID
  if (!rawParentPageId) {
    alert('Please enter a parent page ID or Notion page URL');
    elements.parentPageId.focus();
    return;
  }
  
  const extractedPageId = extractNotionPageId(rawParentPageId);
  
  if (!extractedPageId || !isValidNotionPageId(extractedPageId)) {
    alert(
      'Invalid Notion page ID or URL.\n\n' +
      'You can enter either:\n' +
      '• A Notion page URL (e.g., https://www.notion.so/PageName-2dadca9a3fff80278295e23720dd2a53)\n' +
      '• A page ID (e.g., 2dadca9a3fff80278295e23720dd2a53)\n\n' +
      'The page ID is the 32-character hex string at the end of the Notion page URL.'
    );
    elements.parentPageId.focus();
    return;
  }
  
  const settings = {
    apiToken: rawApiToken,
    parentPageId: extractedPageId, // Use extracted and formatted ID
    includeImages: elements.includeImages.checked,
    addSourceLink: elements.addSourceLink.checked,
  };
  
  // Update the input field with the formatted ID
  elements.parentPageId.value = extractedPageId;
  
  // Save and reinitialize
  await saveSettings(settings);
  currentState.settings = settings;
  
  // Re-check and show appropriate view
  init();
}

// ============================================================================
// Utility Functions
// ============================================================================
/**
 * Extract page ID from Notion URL or return the ID if already extracted
 * @param {string} input - Notion URL or page ID
 * @returns {string|null} Extracted page ID or null if invalid
 */
function extractNotionPageId(input) {
  if (!input || !input.trim()) {
    return null;
  }
  
  const trimmed = input.trim();
  
  // Check if it's a URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed);
      
      // Handle different Notion URL formats:
      // https://www.notion.so/PageName-2dadca9a3fff80278295e23720dd2a53
      // https://www.notion.so/2dadca9a3fff80278295e23720dd2a53
      // https://notion.so/PageName-2dadca9a3fff80278295e23720dd2a53
      
      const pathname = url.pathname;
      
      // Extract ID from pathname (last 32 characters after last dash)
      const match = pathname.match(/-([a-f0-9]{32})$/i) || pathname.match(/([a-f0-9]{32})$/i);
      if (match) {
        return formatNotionId(match[1]);
      }
      
      // Try to extract from query parameters
      const pageId = url.searchParams.get('pageId');
      if (pageId) {
        return formatNotionId(pageId);
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
  
  // If it's not a URL, treat it as a page ID
  // Remove any dashes and check if it's a valid 32-character hex string
  const cleanId = trimmed.replace(/-/g, '');
  
  if (/^[a-f0-9]{32}$/i.test(cleanId)) {
    return formatNotionId(cleanId);
  }
  
  return null;
}

/**
 * Format a Notion page ID to standard UUID format (with dashes)
 * @param {string} id - Page ID without dashes
 * @returns {string} Formatted UUID
 */
function formatNotionId(id) {
  // Remove existing dashes
  const cleanId = id.replace(/-/g, '');
  
  // Notion IDs are 32 hex characters
  if (cleanId.length !== 32) {
    return id; // Return as-is if invalid length
  }
  
  // Format as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return `${cleanId.substring(0, 8)}-${cleanId.substring(8, 12)}-${cleanId.substring(12, 16)}-${cleanId.substring(16, 20)}-${cleanId.substring(20, 32)}`;
}

/**
 * Validate Notion page ID format
 * @param {string} pageId - Page ID to validate
 * @returns {boolean} True if valid
 */
function isValidNotionPageId(pageId) {
  if (!pageId) return false;
  
  // Remove dashes and check if it's 32 hex characters
  const cleanId = pageId.replace(/-/g, '');
  return /^[a-f0-9]{32}$/i.test(cleanId);
}

/**
 * Shorten a page ID for display
 * @param {string} pageId - Full page ID
 * @returns {string} Shortened ID
 */
function shortenPageId(pageId) {
  if (!pageId) return '-';
  const cleanId = pageId.replace(/-/g, '');
  if (cleanId.length <= 12) return pageId;
  return `${cleanId.substring(0, 8)}...`;
}

// ============================================================================
// Event Listeners
// ============================================================================
elements.saveSettings.addEventListener('click', handleSaveSettings);
elements.sendToNotion.addEventListener('click', handleSendToNotion);
elements.downloadInternalImages.addEventListener('click', handleDownloadInternalImages);
elements.openSettings.addEventListener('click', () => showView('settings'));
elements.done.addEventListener('click', () => showView('main'));
elements.retry.addEventListener('click', handleSendToNotion);
elements.back.addEventListener('click', () => showView('main'));

elements.changeTarget.addEventListener('click', () => {
  const newInput = prompt(
    'Enter new parent page ID or Notion page URL:',
    currentState.settings.parentPageId
  );
  
  if (newInput && newInput.trim()) {
    const extractedId = extractNotionPageId(newInput.trim());
    
    if (!extractedId || !isValidNotionPageId(extractedId)) {
      alert(
        'Invalid Notion page ID or URL.\n\n' +
        'You can enter either:\n' +
        '• A Notion page URL (e.g., https://www.notion.so/PageName-2dadca9a3fff80278295e23720dd2a53)\n' +
        '• A page ID (e.g., 2dadca9a3fff80278295e23720dd2a53)'
      );
      return;
    }
    
    currentState.settings.parentPageId = extractedId;
    saveSettings(currentState.settings);
    elements.targetPage.textContent = shortenPageId(extractedId);
  }
});

// Sync checkbox changes to storage
elements.includeImages.addEventListener('change', async () => {
  currentState.settings.includeImages = elements.includeImages.checked;
  await saveSettings(currentState.settings);
});

elements.addSourceLink.addEventListener('change', async () => {
  currentState.settings.addSourceLink = elements.addSourceLink.checked;
  await saveSettings(currentState.settings);
});

// ============================================================================
// Initialize
// ============================================================================
document.addEventListener('DOMContentLoaded', init);
