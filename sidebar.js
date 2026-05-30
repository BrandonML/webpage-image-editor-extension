// Image Workflow Companion - side panel SPA.
// Owns discovery, image ingest, Cropper.js lifecycle, compression options, and downloads.

const SCAN_BLOCKED_URL_PATTERN = /^(chrome|chrome-extension|edge|about|devtools):|^https:\/\/chromewebstore\.google\.com\//i;
const RECEIVING_END_ERROR = 'Receiving end does not exist';

const state = {
  cropper: null,
  currentUrl: '',
  currentDataUrl: '',
  sourceMime: '',
  discoveredImages: []
};

const elements = {
  scanButton: document.querySelector('#scanButton'),
  statusBanner: document.querySelector('#statusBanner'),
  discoveryView: document.querySelector('#discoveryView'),
  workspaceView: document.querySelector('#workspaceView'),
  imageGrid: document.querySelector('#imageGrid'),
  imageCount: document.querySelector('#imageCount'),
  cropperImage: document.querySelector('#cropperImage'),
  backButton: document.querySelector('#backButton'),
  presetSelect: document.querySelector('#presetSelect'),
  qualitySlider: document.querySelector('#qualitySlider'),
  qualityValue: document.querySelector('#qualityValue'),
  convertPngCheckbox: document.querySelector('#convertPngCheckbox'),
  pngBadge: document.querySelector('#pngBadge'),
  downloadButton: document.querySelector('#downloadButton'),
  minWidth: document.querySelector('#minWidth'),
  maxWidth: document.querySelector('#maxWidth'),
  minHeight: document.querySelector('#minHeight'),
  maxHeight: document.querySelector('#maxHeight'),
  fileTypeFilters: document.querySelector('#fileTypeFilters')
};

/**
 * Display a short status message in the side panel.
 *
 * @param {string} message
 */
const setStatus = (message) => {
  elements.statusBanner.textContent = message;
};

/**
 * Promise wrapper for callback-style Chrome APIs.
 *
 * @param {Function} apiCall
 * @returns {Promise<unknown>}
 */
const chromeCall = (apiCall) => new Promise((resolve, reject) => {
  apiCall((response) => {
    const error = chrome.runtime.lastError;

    if (error) {
      reject(new Error(error.message));
      return;
    }

    resolve(response);
  });
});

/**
 * Return the active tab in the current window.
 *
 * @returns {Promise<chrome.tabs.Tab>}
 */
const getActiveTab = async () => {
  const tabs = await chromeCall((callback) => {
    chrome.tabs.query({ active: true, currentWindow: true }, callback);
  });

  return tabs?.[0];
};

/**
 * Determine whether the extension can inject and message a normal webpage tab.
 *
 * Chrome may omit tab.url when the extension only has an activeTab grant, so an
 * absent URL should not be treated as restricted. If Chrome exposes a URL, block
 * known privileged browser pages before attempting content-script messaging.
 *
 * @param {chrome.tabs.Tab} tab
 * @returns {boolean}
 */
const canScanTab = (tab) => !tab?.url || !SCAN_BLOCKED_URL_PATTERN.test(tab.url);

/**
 * Send the scan request to the target tab's content script.
 *
 * @param {number} tabId
 * @returns {Promise<{ok: boolean, images?: {url: string, width: number, height: number, aspectRatio: number, fileType: string}[], error?: string}>}
 */
const requestDomScan = (tabId) => chromeCall((callback) => {
  chrome.tabs.sendMessage(tabId, { action: 'SCAN_DOM' }, callback);
});

/**
 * Inject the current content script into the active tab when the manifest-injected
 * script is unavailable, such as after an extension reload on an already-open tab.
 *
 * @param {number} tabId
 * @returns {Promise<void>}
 */
const injectContentScript = async (tabId) => {
  await chromeCall((callback) => {
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    }, callback);
  });
};

/**
 * Ask the content script in the active tab to harvest image URLs, injecting it on
 * demand if the page does not currently have a receiver for extension messages.
 *
 * @returns {Promise<{url: string, width: number, height: number, aspectRatio: number, fileType: string}[]>}
 */
const scanActiveTab = async () => {
  const tab = await getActiveTab();

  if (typeof tab?.id !== 'number') {
    throw new Error('No active tab found.');
  }

  if (!canScanTab(tab)) {
    throw new Error('This page cannot be scanned by Chrome extensions. Open a regular webpage and try again.');
  }

  let response;

  try {
    response = await requestDomScan(tab.id);
  } catch (error) {
    if (!error.message?.includes(RECEIVING_END_ERROR)) {
      throw error;
    }

    setStatus('Preparing this page for scanning…');
    await injectContentScript(tab.id);
    response = await requestDomScan(tab.id);
  }

  if (!response?.ok) {
    throw new Error(response?.error || 'Unable to scan the current page.');
  }

  return response.images || [];
};

/**
 * Normalize image metadata for new content-script results and older string-only payloads.
 *
 * @param {string|{url: string, width?: number, height?: number, aspectRatio?: number, fileType?: string}} image
 * @returns {{url: string, width: number, height: number, aspectRatio: number, fileType: string}}
 */
const normalizeImageMetadata = (image) => {
  if (typeof image === 'string') {
    return {
      url: image,
      width: 0,
      height: 0,
      aspectRatio: 0,
      fileType: getExtensionFromUrl(image) || 'unknown'
    };
  }

  const width = Number(image.width) || 0;
  const height = Number(image.height) || 0;
  const aspectRatio = Number(image.aspectRatio) || (width && height ? Math.round((width / height) * 100) / 100 : 0);

  return {
    url: image.url,
    width,
    height,
    aspectRatio,
    fileType: image.fileType || getExtensionFromUrl(image.url) || 'unknown'
  };
};

/**
 * Read an optional numeric filter value.
 *
 * @param {HTMLInputElement} input
 * @returns {number|null}
 */
const readNumberFilter = (input) => {
  const value = Number(input.value);
  return Number.isFinite(value) && input.value !== '' ? value : null;
};

/**
 * Build dynamic file-type checkboxes from discovered image metadata.
 */
const renderFileTypeFilters = () => {
  elements.fileTypeFilters.textContent = '';

  const fileTypes = [...new Set(state.discoveredImages.map((image) => image.fileType || 'unknown'))]
    .sort((a, b) => a.localeCompare(b));

  if (!fileTypes.length) {
    const empty = document.createElement('span');
    empty.className = 'empty-filter-state';
    empty.textContent = 'No file types found.';
    elements.fileTypeFilters.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  fileTypes.forEach((fileType) => {
    const label = document.createElement('label');
    label.className = 'file-type-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = fileType;
    checkbox.checked = true;
    checkbox.addEventListener('change', applyDiscoveryFilters);

    const text = document.createElement('span');
    text.textContent = fileType.toUpperCase();

    label.append(checkbox, text);
    fragment.append(label);
  });

  elements.fileTypeFilters.append(fragment);
};

/**
 * Return the checked file types from the dynamic filter group.
 *
 * @returns {Set<string>}
 */
const getSelectedFileTypes = () => new Set(
  [...elements.fileTypeFilters.querySelectorAll('input[type="checkbox"]:checked')]
    .map((checkbox) => checkbox.value)
);

/**
 * Filter the full discovery result set using dimension inputs and checked file types.
 *
 * @returns {{url: string, width: number, height: number, aspectRatio: number, fileType: string}[]}
 */
const getFilteredImages = () => {
  const minWidth = readNumberFilter(elements.minWidth);
  const maxWidth = readNumberFilter(elements.maxWidth);
  const minHeight = readNumberFilter(elements.minHeight);
  const maxHeight = readNumberFilter(elements.maxHeight);
  const selectedFileTypes = getSelectedFileTypes();

  return state.discoveredImages.filter((image) => {
    const width = image.width || 0;
    const height = image.height || 0;

    return selectedFileTypes.has(image.fileType)
      && (minWidth === null || width >= minWidth)
      && (maxWidth === null || width <= maxWidth)
      && (minHeight === null || height >= minHeight)
      && (maxHeight === null || height <= maxHeight);
  });
};

/**
 * Apply active discovery filters and redraw the grid.
 */
const applyDiscoveryFilters = () => {
  renderDiscoveryGrid(getFilteredImages());
};

/**
 * Render the discovery grid with safe, clickable thumbnail buttons and metadata badges.
 *
 * @param {{url: string, width: number, height: number, aspectRatio: number, fileType: string}[]} images
 */
const renderDiscoveryGrid = (images) => {
  elements.imageGrid.textContent = '';
  elements.imageCount.textContent = `${images.length} image${images.length === 1 ? '' : 's'}`;

  if (!images.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'empty-state';
    emptyState.textContent = state.discoveredImages.length
      ? 'No images match the active filters.'
      : 'No eligible images found. Try another page or right-click an image.';
    elements.imageGrid.append(emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();

  images.forEach((imageData) => {
    const button = document.createElement('button');
    button.className = 'image-tile';
    button.type = 'button';
    button.title = imageData.url;
    button.addEventListener('click', () => loadImageIntoWorkspace(imageData.url));

    const image = document.createElement('img');
    image.src = imageData.url;
    image.alt = 'Discovered webpage image';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';

    const metadata = document.createElement('div');
    metadata.className = 'image-metadata';

    const badges = [
      { text: imageData.fileType.toUpperCase(), className: 'file-type' },
      { text: imageData.width && imageData.height ? `${imageData.width}×${imageData.height}` : 'Size unknown' },
      { text: imageData.aspectRatio ? `${imageData.aspectRatio}:1` : 'Ratio unknown' }
    ];

    badges.forEach((badge) => {
      const badgeElement = document.createElement('span');
      badgeElement.className = `metadata-badge ${badge.className || ''}`.trim();
      badgeElement.textContent = badge.text;
      metadata.append(badgeElement);
    });

    button.append(image, metadata);
    fragment.append(button);
  });

  elements.imageGrid.append(fragment);
};

/**
 * Show discovery or workspace view.
 *
 * @param {'discovery'|'workspace'} viewName
 */
const showView = (viewName) => {
  const showWorkspace = viewName === 'workspace';
  elements.discoveryView.classList.toggle('hidden', showWorkspace);
  elements.workspaceView.classList.toggle('hidden', !showWorkspace);
};

/**
 * Infer a MIME type from either a server content type, data URL, or file extension.
 *
 * @param {string} url
 * @param {string} dataUrl
 * @param {string} contentType
 * @returns {string}
 */
const inferMimeType = (url, dataUrl, contentType) => {
  if (contentType?.startsWith('image/')) {
    return contentType.split(';')[0].toLowerCase();
  }

  const dataUrlMatch = dataUrl.match(/^data:(image\/[^;,]+)/i);

  if (dataUrlMatch) {
    return dataUrlMatch[1].toLowerCase();
  }

  const extension = getExtensionFromUrl(url);
  const extensionMap = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif'
  };

  return extensionMap[extension] || 'image/png';
};

/**
 * Get the lowercase file extension from a URL path.
 *
 * @param {string} url
 * @returns {string}
 */
const getExtensionFromUrl = (url) => {
  try {
    const fileName = new URL(url).pathname.split('/').pop() || '';
    const extensionMatch = fileName.match(/\.([a-z0-9]+)$/i);
    return extensionMatch?.[1]?.toLowerCase() || '';
  } catch (_error) {
    return '';
  }
};

/**
 * Fetch an image through the background proxy to avoid canvas CORS tainting.
 *
 * @param {string} url
 * @returns {Promise<{dataUrl: string, contentType: string}>}
 */
const fetchImageDataUrl = async (url) => {
  const response = await chromeCall((callback) => {
    chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_BORS_BYPASS', url }, callback);
  });

  if (!response?.ok) {
    throw new Error(response?.error || 'Unable to fetch image data.');
  }

  return response;
};

/**
 * Destroy the existing Cropper instance and create a fresh one for the given data URL.
 *
 * @param {string} dataUrl
 */
const initializeCropper = (dataUrl) => {
  if (state.cropper) {
    state.cropper.destroy();
    state.cropper = null;
  }

  elements.cropperImage.src = dataUrl;

  state.cropper = new Cropper(elements.cropperImage, {
    viewMode: 1,
    autoCropArea: 0.9,
    responsive: true,
    background: false,
    aspectRatio: Number(elements.presetSelect.value) || 1
  });
};

/**
 * Load a URL into the workspace and prepare all export controls.
 *
 * @param {string} url
 */
const loadImageIntoWorkspace = async (url) => {
  try {
    setStatus('Fetching image through the background proxy…');
    showView('workspace');

    const { dataUrl, contentType } = await fetchImageDataUrl(url);

    state.currentUrl = url;
    state.currentDataUrl = dataUrl;
    state.sourceMime = inferMimeType(url, dataUrl, contentType);

    initializeCropper(dataUrl);
    updateCompressionControls();
    setStatus('Image ready. Adjust the crop and export settings.');
  } catch (error) {
    console.error('Workspace ingest failed:', error);
    setStatus(error.message || 'Unable to load image.');
    showView('discovery');
  }
};

/**
 * Update the slider and PNG warning badge based on the source type and conversion checkbox.
 */
const updateCompressionControls = () => {
  const isPng = state.sourceMime === 'image/png';
  const convertingPng = isPng && elements.convertPngCheckbox.checked;
  const compressionEnabled = !isPng || convertingPng;

  elements.qualitySlider.disabled = !compressionEnabled;
  elements.convertPngCheckbox.disabled = !isPng;
  elements.convertPngCheckbox.parentElement.classList.toggle('hidden', !isPng);
  elements.pngBadge.classList.toggle('hidden', !isPng || convertingPng);
  elements.qualityValue.textContent = `${elements.qualitySlider.value}%`;
};

/**
 * Apply the selected aspect-ratio preset to Cropper.js.
 */
const applyPreset = () => {
  if (!state.cropper) {
    return;
  }

  const value = elements.presetSelect.value;
  state.cropper.setAspectRatio(value === 'free' ? NaN : Number(value));
};

/**
 * Fill transparent pixels with white before exporting PNG content as JPEG.
 *
 * @param {HTMLCanvasElement} sourceCanvas
 * @returns {HTMLCanvasElement}
 */
const flattenCanvasOnWhite = (sourceCanvas) => {
  const flattenedCanvas = document.createElement('canvas');
  flattenedCanvas.width = sourceCanvas.width;
  flattenedCanvas.height = sourceCanvas.height;

  const context = flattenedCanvas.getContext('2d');
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, flattenedCanvas.width, flattenedCanvas.height);
  context.drawImage(sourceCanvas, 0, 0);

  return flattenedCanvas;
};

/**
 * Decide the final export MIME type for the current source image and controls.
 *
 * @returns {string}
 */
const getExportMimeType = () => {
  if (state.sourceMime === 'image/png') {
    return elements.convertPngCheckbox.checked ? 'image/jpeg' : 'image/png';
  }

  return ['image/jpeg', 'image/webp'].includes(state.sourceMime) ? state.sourceMime : 'image/jpeg';
};

/**
 * Convert a MIME type into a safe download extension.
 *
 * @param {string} mimeType
 * @returns {string}
 */
const mimeToExtension = (mimeType) => ({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}[mimeType] || 'jpg');

/**
 * Build a readable file name from the selected image URL.
 *
 * @param {string} url
 * @param {string} extension
 * @returns {string}
 */
const buildDownloadName = (url, extension) => {
  let baseName = 'image';

  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    baseName = pathname.split('/').filter(Boolean).pop() || baseName;
    baseName = baseName.replace(/\.[a-z0-9]+$/i, '') || 'image';
  } catch (_error) {
    // Keep the fallback base name.
  }

  const safeName = baseName.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'image';
  return `${safeName}-processed.${extension}`;
};

/**
 * Convert a canvas to a Blob with Promise ergonomics.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} mimeType
 * @param {number} quality
 * @returns {Promise<Blob>}
 */
const canvasToBlob = (canvas, mimeType, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) {
      resolve(blob);
      return;
    }

    reject(new Error('Canvas export failed.'));
  }, mimeType, quality);
});

/**
 * Export the current crop, create an object URL, and trigger a download.
 */
const downloadCurrentCrop = async () => {
  if (!state.cropper) {
    setStatus('Choose an image before downloading.');
    return;
  }

  try {
    elements.downloadButton.disabled = true;
    setStatus('Exporting cropped image…');

    const croppedCanvas = state.cropper.getCroppedCanvas({
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });

    const mimeType = getExportMimeType();
    const exportCanvas = state.sourceMime === 'image/png' && mimeType === 'image/jpeg'
      ? flattenCanvasOnWhite(croppedCanvas)
      : croppedCanvas;
    const quality = Number(elements.qualitySlider.value) / 100;
    const blob = await canvasToBlob(exportCanvas, mimeType, quality);
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = objectUrl;
    anchor.download = buildDownloadName(state.currentUrl, mimeToExtension(mimeType));
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    setStatus(`Downloaded ${anchor.download}.`);
  } catch (error) {
    console.error('Download failed:', error);
    setStatus(error.message || 'Unable to export image.');
  } finally {
    elements.downloadButton.disabled = false;
  }
};

/**
 * Run a fresh page scan and populate the discovery grid.
 */
const scanAndRender = async () => {
  try {
    elements.scanButton.disabled = true;
    setStatus('Scanning the active page for images…');
    showView('discovery');

    state.discoveredImages = (await scanActiveTab())
      .map(normalizeImageMetadata)
      .filter((image) => image.url);
    renderFileTypeFilters();
    applyDiscoveryFilters();
    setStatus(`Found ${state.discoveredImages.length} eligible image${state.discoveredImages.length === 1 ? '' : 's'}.`);
  } catch (error) {
    console.error('Page scan failed:', error);
    state.discoveredImages = [];
    renderFileTypeFilters();
    renderDiscoveryGrid([]);
    setStatus(`${error.message} Refresh the page and try again.`);
  } finally {
    elements.scanButton.disabled = false;
  }
};

/**
 * Listen for image URLs sent by the background context-menu handler.
 */
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action !== 'CONTEXT_IMAGE_TARGET' || !message.url) {
    return false;
  }

  loadImageIntoWorkspace(message.url);
  return false;
});

// Wire UI events.
elements.scanButton.addEventListener('click', scanAndRender);
elements.backButton.addEventListener('click', () => showView('discovery'));
elements.presetSelect.addEventListener('change', applyPreset);
elements.qualitySlider.addEventListener('input', updateCompressionControls);
elements.convertPngCheckbox.addEventListener('change', updateCompressionControls);
elements.downloadButton.addEventListener('click', downloadCurrentCrop);
[elements.minWidth, elements.maxWidth, elements.minHeight, elements.maxHeight]
  .forEach((input) => input.addEventListener('input', applyDiscoveryFilters));

// Initial boot: registered content script should already be available on normal web pages.
document.addEventListener('DOMContentLoaded', scanAndRender);
