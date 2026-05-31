// Image Workflow Companion - DOM image harvester.
// Scans the current page for visible image-like resources and returns clean absolute URLs with metadata.

const MIN_IMAGE_SIZE = 32;
const UNKNOWN_FILE_TYPE = 'unknown';

/**
 * Convert a possibly relative URL into an absolute URL and drop unsupported schemes.
 *
 * @param {string} candidate
 * @returns {string|null}
 */
const toAbsoluteUrl = (candidate) => {
  if (!candidate || typeof candidate !== 'string') {
    return null;
  }

  const trimmed = candidate.trim();

  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return null;
  }

  try {
    const url = new URL(trimmed, document.baseURI);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch (_error) {
    return null;
  }
};

/**
 * Parse a srcset attribute and return just the URL candidates.
 *
 * @param {string} srcset
 * @returns {string[]}
 */
const parseSrcset = (srcset) => String(srcset || '')
  .split(',')
  .map((entry) => entry.trim().split(/\s+/)[0])
  .filter(Boolean);

/**
 * Remove common CDN transformation query parameters and filename size suffixes.
 * The goal is to recover a likely original image URL without changing the origin/path too aggressively.
 *
 * @param {string} rawUrl
 * @returns {string|null}
 */
const cleanImageUrl = (rawUrl) => {
  const absoluteUrl = toAbsoluteUrl(rawUrl);

  if (!absoluteUrl) {
    return null;
  }

  try {
    const url = new URL(absoluteUrl);
    const sizingParams = new Set([
      'w', 'h', 'width', 'height', 'resize', 'fit', 'crop', 'quality', 'q',
      'auto', 'dpr', 'format', 'fm', 'ixlib', 's', 'size'
    ]);

    for (const param of [...url.searchParams.keys()]) {
      if (sizingParams.has(param.toLowerCase())) {
        url.searchParams.delete(param);
      }
    }

    url.pathname = url.pathname.replace(
      /(?:[-_](?:\d{2,5}x\d{2,5}|\d{2,5}w|w\d{2,5}|h\d{2,5}|\d{2,5}))(?=\.(?:avif|bmp|gif|jpe?g|png|webp|svg)$)/i,
      ''
    );

    url.hash = '';
    return url.href;
  } catch (_error) {
    return absoluteUrl;
  }
};

/**
 * Determine whether an element is large enough to be useful.
 *
 * @param {Element} element
 * @returns {boolean}
 */
const isLargeEnough = (element) => {
  const rect = element.getBoundingClientRect();
  const width = element.naturalWidth || rect.width || element.clientWidth;
  const height = element.naturalHeight || rect.height || element.clientHeight;

  return width >= MIN_IMAGE_SIZE && height >= MIN_IMAGE_SIZE;
};

/**
 * Extract measured dimensions from an element, preferring intrinsic image dimensions when available.
 *
 * @param {Element} element
 * @returns {{width: number, height: number}}
 */
const getElementDimensions = (element) => {
  const rect = element.getBoundingClientRect();
  const width = Math.round(element.naturalWidth || rect.width || element.clientWidth || 0);
  const height = Math.round(element.naturalHeight || rect.height || element.clientHeight || 0);

  return { width, height };
};

/**
 * Calculate a rounded aspect ratio from dimensions.
 *
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
const calculateAspectRatio = (width, height) => {
  if (!width || !height) {
    return 0;
  }

  return Math.round((width / height) * 100) / 100;
};

/**
 * Extract URL values from a CSS background-image declaration.
 *
 * @param {string} backgroundImage
 * @returns {string[]}
 */
const extractBackgroundUrls = (backgroundImage = '') => {
  const urls = [];
  const pattern = /url\((['"]?)(.*?)\1\)/g;
  let match;

  while ((match = pattern.exec(backgroundImage)) !== null) {
    urls.push(match[2]);
  }

  return urls;
};

/**
 * Infer a friendly file type from URL path, transformation query params, or currentSrc hints.
 *
 * @param {string} rawUrl
 * @param {string} cleanedUrl
 * @returns {string}
 */
const extractFileType = (rawUrl, cleanedUrl) => {
  const imageTypes = new Set(['avif', 'bmp', 'gif', 'jpg', 'jpeg', 'png', 'svg', 'webp']);
  const candidates = [rawUrl, cleanedUrl];

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, document.baseURI);
      const extension = url.pathname.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';

      if (imageTypes.has(extension)) {
        return extension === 'jpeg' ? 'jpg' : extension;
      }

      const queryFormat = ['format', 'fm', 'type']
        .map((param) => url.searchParams.get(param)?.toLowerCase().replace(/^image\//, ''))
        .find((value) => value && imageTypes.has(value));

      if (queryFormat) {
        return queryFormat === 'jpeg' ? 'jpg' : queryFormat;
      }
    } catch (_error) {
      // Continue checking other candidates.
    }
  }

  return UNKNOWN_FILE_TYPE;
};

/**
 * Add a cleaned image candidate and metadata to the result map if it is usable.
 *
 * @param {Map<string, {url: string, width: number, height: number, aspectRatio: number, fileType: string}>} results
 * @param {string} candidate
 * @param {{width: number, height: number}} dimensions
 */
const addCandidate = (results, candidate, dimensions) => {
  const cleaned = cleanImageUrl(candidate);

  if (!cleaned || results.has(cleaned)) {
    return;
  }

  const width = dimensions.width || 0;
  const height = dimensions.height || 0;

  results.set(cleaned, {
    url: cleaned,
    width,
    height,
    aspectRatio: calculateAspectRatio(width, height),
    fileType: extractFileType(candidate, cleaned)
  });
};

/**
 * Scan the page for image URLs from img tags, picture sources, and inline backgrounds.
 *
 * @returns {{url: string, width: number, height: number, aspectRatio: number, fileType: string}[]}
 */
const scanDomForImages = () => {
  const results = new Map();

  document.querySelectorAll('img').forEach((image) => {
    if (!isLargeEnough(image)) {
      return;
    }

    const dimensions = getElementDimensions(image);

    addCandidate(results, image.currentSrc || image.src, dimensions);
    addCandidate(results, image.getAttribute('src'), dimensions);
    addCandidate(results, image.getAttribute('data-src'), dimensions);
    addCandidate(results, image.getAttribute('data-original'), dimensions);

    parseSrcset(image.getAttribute('srcset')).forEach((url) => addCandidate(results, url, dimensions));
  });

  document.querySelectorAll('picture source[srcset], source[srcset]').forEach((source) => {
    const parent = source.closest('picture');
    const pictureImage = parent?.querySelector('img');
    const dimensionElement = pictureImage || source;

    if (pictureImage && !isLargeEnough(pictureImage)) {
      return;
    }

    const dimensions = getElementDimensions(dimensionElement);
    parseSrcset(source.getAttribute('srcset')).forEach((url) => addCandidate(results, url, dimensions));
  });

  document.querySelectorAll('[style*="background"]').forEach((element) => {
    if (!isLargeEnough(element)) {
      return;
    }

    const dimensions = getElementDimensions(element);
    extractBackgroundUrls(element.style.backgroundImage).forEach((url) => addCandidate(results, url, dimensions));
  });

  return [...results.values()];
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'SCAN_DOM') {
    return false;
  }

  sendResponse({ ok: true, images: scanDomForImages() });
  return false;
});

// Export functions for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractBackgroundUrls,
    toAbsoluteUrl,
    parseSrcset,
    cleanImageUrl,
    calculateAspectRatio,
    isLargeEnough,
    getElementDimensions,
    extractFileType,
    scanDomForImages
  };
}
