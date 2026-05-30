// Image Workflow Companion - DOM image harvester.
// Scans the current page for visible image-like resources and returns clean absolute URLs.

const MIN_IMAGE_SIZE = 32;

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
const parseSrcset = (srcset = '') => srcset
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
 * Add a cleaned URL to a Set if it is usable.
 *
 * @param {Set<string>} results
 * @param {string} candidate
 */
const addCandidate = (results, candidate) => {
  const cleaned = cleanImageUrl(candidate);

  if (cleaned) {
    results.add(cleaned);
  }
};

/**
 * Scan the page for image URLs from img tags, picture sources, and inline backgrounds.
 *
 * @returns {string[]}
 */
const scanDomForImages = () => {
  const results = new Set();

  document.querySelectorAll('img').forEach((image) => {
    if (!isLargeEnough(image)) {
      return;
    }

    addCandidate(results, image.currentSrc || image.src);
    addCandidate(results, image.getAttribute('src'));
    addCandidate(results, image.getAttribute('data-src'));
    addCandidate(results, image.getAttribute('data-original'));

    parseSrcset(image.getAttribute('srcset')).forEach((url) => addCandidate(results, url));
  });

  document.querySelectorAll('picture source[srcset], source[srcset]').forEach((source) => {
    const parent = source.closest('picture');
    const pictureImage = parent?.querySelector('img');

    if (pictureImage && !isLargeEnough(pictureImage)) {
      return;
    }

    parseSrcset(source.getAttribute('srcset')).forEach((url) => addCandidate(results, url));
  });

  document.querySelectorAll('[style*="background"]').forEach((element) => {
    if (!isLargeEnough(element)) {
      return;
    }

    extractBackgroundUrls(element.style.backgroundImage).forEach((url) => addCandidate(results, url));
  });

  return [...results];
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'SCAN_DOM') {
    return false;
  }

  sendResponse({ ok: true, images: scanDomForImages() });
  return false;
});
