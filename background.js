// Image Workflow Companion - Manifest V3 service worker.
// Handles extension entry points and performs privileged image fetching for the side panel.

const CONTEXT_MENU_ID = 'processImage';
const PANEL_OPEN_DELAY_MS = 500;
const SIDEBAR_PATH = 'sidebar.html';

/**
 * Enable and open the side panel for only the tab that initiated the action.
 *
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<void>}
 */
const openPanelForTab = async (tab) => {
  if (typeof tab?.id !== 'number' || typeof tab?.windowId !== 'number') {
    throw new Error('No active tab available for side panel.');
  }

  await chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: SIDEBAR_PATH,
    enabled: true
  });

  await chrome.sidePanel.open({ windowId: tab.windowId });
};

/**
 * Toolbar clicks should enable the side panel only for the clicked tab.
 */
chrome.action.onClicked.addListener((tab) => {
  openPanelForTab(tab).catch((error) => {
    console.error('Unable to open side panel for action click:', error);
  });
});

/**
 * Create a single image context menu item when the extension is installed/updated.
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.remove(CONTEXT_MENU_ID, () => {
    // Ignore remove errors; the item may not exist on first install.
    chrome.runtime.lastError;

    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Process with Image Resizer',
      contexts: ['image']
    });
  });
});

/**
 * Open the side panel from an image context menu click and forward the clicked image URL.
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.srcUrl || typeof tab?.windowId !== 'number') {
    return;
  }

  try {
    await openPanelForTab(tab);

    // Give the side panel document time to initialize its runtime message listener.
    setTimeout(() => {
      chrome.runtime.sendMessage({
        action: 'CONTEXT_IMAGE_TARGET',
        url: info.srcUrl
      });
    }, PANEL_OPEN_DELAY_MS);
  } catch (error) {
    console.error('Unable to open side panel for context image:', error);
  }
});

/**
 * Convert a Blob to a data URL. FileReader is used when available, with an
 * ArrayBuffer fallback because extension service workers run in a worker context.
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
const blobToDataUrl = (blob) => {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';

    for (let index = 0; index < bytes.byteLength; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }

    return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
  });
};

/**
 * Fetch remote images from the extension service worker, returning a data URL
 * that can be safely loaded into a canvas without tainting it.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'FETCH_IMAGE_BORS_BYPASS') {
    return false;
  }

  (async () => {
    try {
      const response = await fetch(message.url, {
        credentials: 'omit',
        cache: 'force-cache'
      });

      if (!response.ok) {
        throw new Error(`Image fetch failed with HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);

      sendResponse({ ok: true, dataUrl, contentType: blob.type });
    } catch (error) {
      console.error('Image fetch proxy failed:', error);
      sendResponse({ ok: false, error: error.message || 'Unable to fetch image.' });
    }
  })();

  // Keep the message channel open for the asynchronous fetch response.
  return true;
});
