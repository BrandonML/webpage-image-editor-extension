// Mock global variables before importing content.js
global.chrome = {
  runtime: {
    onMessage: {
      addListener: jest.fn()
    }
  }
};

global.document = {
  baseURI: 'https://example.com'
};

const {
  extractBackgroundUrls,
  toAbsoluteUrl,
  parseSrcset,
  cleanImageUrl,
  calculateAspectRatio,
  extractFileType,
  isLargeEnough,
  getElementDimensions
} = require('./content.js');

describe('content.js', () => {
  it('loads successfully', () => {
    expect(extractBackgroundUrls).toBeDefined();
  });
});

describe('extractBackgroundUrls', () => {
  it('handles empty or undefined inputs', () => {
    expect(extractBackgroundUrls()).toEqual([]);
    expect(extractBackgroundUrls('')).toEqual([]);
    expect(extractBackgroundUrls('   ')).toEqual([]);
    expect(extractBackgroundUrls(null)).toEqual([]);
    expect(extractBackgroundUrls(undefined)).toEqual([]);
  });

  it('extracts unquoted URLs', () => {
    expect(extractBackgroundUrls('url(https://example.com/image.jpg)')).toEqual(['https://example.com/image.jpg']);
  });

  it('extracts single-quoted URLs', () => {
    expect(extractBackgroundUrls("url('https://example.com/image.jpg')")).toEqual(['https://example.com/image.jpg']);
  });

  it('extracts double-quoted URLs', () => {
    expect(extractBackgroundUrls('url("https://example.com/image.jpg")')).toEqual(['https://example.com/image.jpg']);
  });

  it('extracts multiple URLs in one string', () => {
    const bgString = 'url(img1.jpg), url("img2.png"), url(\'img3.gif\')';
    expect(extractBackgroundUrls(bgString)).toEqual(['img1.jpg', 'img2.png', 'img3.gif']);
  });

  it('handles base64 data URIs', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    expect(extractBackgroundUrls(`url("${dataUri}")`)).toEqual([dataUri]);
  });

  it('ignores strings that do not contain valid url() patterns', () => {
    expect(extractBackgroundUrls('linear-gradient(to right, red, blue)')).toEqual([]);
    expect(extractBackgroundUrls('none')).toEqual([]);
    expect(extractBackgroundUrls('color(red)')).toEqual([]);
  });

  it('handles mixed content with url()', () => {
    const bgString = 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(bg.jpg) center/cover no-repeat';
    expect(extractBackgroundUrls(bgString)).toEqual(['bg.jpg']);
  });

  it('handles spacing inside url()', () => {
    // Note: CSS syntax allows spaces, but the current regex /url\((['"]?)(.*?)\1\)/g
    // will just extract the spaces as part of the URL. Let's test the current behavior.
    expect(extractBackgroundUrls('url(  https://example.com/image.jpg  )')).toEqual(['  https://example.com/image.jpg  ']);
  });
});

describe('calculateAspectRatio', () => {
  it('calculates aspect ratio correctly', () => {
    expect(calculateAspectRatio(1920, 1080)).toBe(1.78);
    expect(calculateAspectRatio(100, 100)).toBe(1);
    expect(calculateAspectRatio(800, 600)).toBe(1.33);
  });

  it('handles zero or missing dimensions gracefully', () => {
    expect(calculateAspectRatio(0, 100)).toBe(0);
    expect(calculateAspectRatio(100, 0)).toBe(0);
    expect(calculateAspectRatio(0, 0)).toBe(0);
    expect(calculateAspectRatio(null, undefined)).toBe(0);
  });
});

describe('parseSrcset', () => {
  it('parses valid srcset strings correctly', () => {
    const srcset = 'image-320w.jpg 320w, image-480w.jpg 480w, image-800w.jpg 800w';
    expect(parseSrcset(srcset)).toEqual(['image-320w.jpg', 'image-480w.jpg', 'image-800w.jpg']);
  });

  it('handles srcset with density descriptors', () => {
    const srcset = 'image-1x.jpg 1x, image-2x.jpg 2x';
    expect(parseSrcset(srcset)).toEqual(['image-1x.jpg', 'image-2x.jpg']);
  });

  it('handles empty, missing, or non-string input gracefully', () => {
    expect(parseSrcset('')).toEqual([]);
    expect(parseSrcset(null)).toEqual([]);
    expect(parseSrcset(undefined)).toEqual([]);
    expect(parseSrcset(false)).toEqual([]);
    expect(parseSrcset(0)).toEqual([]);
    expect(parseSrcset([])).toEqual([]);
    expect(parseSrcset({})).toEqual(['[object']); // Note: Current implementation artifact for objects
  });

  it('handles URLs without descriptors', () => {
    expect(parseSrcset('image.jpg')).toEqual(['image.jpg']);
    expect(parseSrcset('img1.jpg, img2.jpg')).toEqual(['img1.jpg', 'img2.jpg']);
  });

  it('handles excessive whitespace and newlines', () => {
    const srcset = `
      image-320w.jpg   320w,

      image-480w.jpg\t480w  ,
      image-800w.jpg
      800w
    `;
    expect(parseSrcset(srcset)).toEqual(['image-320w.jpg', 'image-480w.jpg', 'image-800w.jpg']);
  });

  it('handles trailing commas and empty entries', () => {
    const srcset = 'image1.jpg 1x, , image2.jpg 2x, , ,';
    expect(parseSrcset(srcset)).toEqual(['image1.jpg', 'image2.jpg']);
  });

  it('documents current behavior for base64 data URIs', () => {
    // Note: The current implementation splits purely by commas, which incorrectly splits base64 strings.
    // This test documents the current behavior. If full data URI support is added later, this test should be updated.
    const base64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII= 1x';
    expect(parseSrcset(base64)).toEqual([
      'data:image/png;base64',
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    ]);
  });
});

describe('toAbsoluteUrl', () => {
  beforeEach(() => {
    global.document = { baseURI: 'https://example.com/page/path' };
  });

  it('handles absolute URLs', () => {
    expect(toAbsoluteUrl('https://other.com/image.jpg')).toBe('https://other.com/image.jpg');
    expect(toAbsoluteUrl('http://insecure.com/img.png')).toBe('http://insecure.com/img.png');
  });

  it('resolves relative URLs based on document baseURI', () => {
    expect(toAbsoluteUrl('/image.jpg')).toBe('https://example.com/image.jpg');
    expect(toAbsoluteUrl('relative.jpg')).toBe('https://example.com/page/relative.jpg');
    expect(toAbsoluteUrl('../up.jpg')).toBe('https://example.com/up.jpg');
  });

  it('rejects unsupported schemes', () => {
    expect(toAbsoluteUrl('data:image/png;base64,...')).toBeNull();
    expect(toAbsoluteUrl('blob:https://example.com/...')).toBeNull();
    expect(toAbsoluteUrl('ftp://example.com/image.jpg')).toBeNull();
    expect(toAbsoluteUrl('javascript:alert(1)')).toBeNull();
  });

  it('handles invalid inputs', () => {
    expect(toAbsoluteUrl(null)).toBeNull();
    expect(toAbsoluteUrl(undefined)).toBeNull();
    expect(toAbsoluteUrl(123)).toBeNull();
    expect(toAbsoluteUrl('')).toBeNull();
    expect(toAbsoluteUrl('   ')).toBeNull();
  });

  it('trims whitespace from URLs', () => {
    expect(toAbsoluteUrl('  https://example.com/image.jpg  ')).toBe('https://example.com/image.jpg');
    expect(toAbsoluteUrl('\t/image.png\n')).toBe('https://example.com/image.png');
  });

  it('handles protocol-relative URLs', () => {
    expect(toAbsoluteUrl('//other.com/image.jpg')).toBe('https://other.com/image.jpg');
  });

  it('handles URLs with query parameters and hash fragments', () => {
    expect(toAbsoluteUrl('/image.jpg?w=100&h=200#section')).toBe('https://example.com/image.jpg?w=100&h=200#section');
  });

  it('rejects unparseable URLs and additional unsupported schemes', () => {
    expect(toAbsoluteUrl('http://[123')).toBeNull(); // Unparseable URL
    expect(toAbsoluteUrl('chrome-extension://abcdefg/image.jpg')).toBeNull();
    expect(toAbsoluteUrl('file:///C:/image.jpg')).toBeNull();
  });
});

describe('extractFileType', () => {
  beforeEach(() => {
    global.document = { baseURI: 'https://example.com' };
  });

  it('extracts extension from simple URLs', () => {
    expect(extractFileType('https://example.com/image.png', 'https://example.com/image.png')).toBe('png');
    expect(extractFileType('https://example.com/photo.JPEG', 'https://example.com/photo.JPEG')).toBe('jpg');
    expect(extractFileType('https://example.com/icon.svg', 'https://example.com/icon.svg')).toBe('svg');
    expect(extractFileType('https://example.com/pic.webp', 'https://example.com/pic.webp')).toBe('webp');
  });

  it('extracts extension from query format parameters', () => {
    expect(extractFileType('https://example.com/image?format=webp', 'https://example.com/image?format=webp')).toBe('webp');
    expect(extractFileType('https://example.com/image?fm=png', 'https://example.com/image?fm=png')).toBe('png');
    expect(extractFileType('https://example.com/image?type=image/jpeg', 'https://example.com/image?type=image/jpeg')).toBe('jpg');
  });

  it('returns unknown for unidentifiable types', () => {
    expect(extractFileType('https://example.com/image.txt', 'https://example.com/image.txt')).toBe('unknown');
    expect(extractFileType('https://example.com/image', 'https://example.com/image')).toBe('unknown');
    expect(extractFileType('data:image/png;base64,...', null)).toBe('unknown');
  });

  it('prefers cleaned URL if raw URL has no type', () => {
    expect(extractFileType('https://example.com/image', 'https://example.com/image.png')).toBe('png');
  });
});

describe('isLargeEnough', () => {
  it('returns true when dimensions are >= MIN_IMAGE_SIZE (32)', () => {
    expect(isLargeEnough({ getBoundingClientRect: () => ({ width: 32, height: 32 }) })).toBe(true);
    expect(isLargeEnough({ getBoundingClientRect: () => ({}), naturalWidth: 100, naturalHeight: 100 })).toBe(true);
  });

  it('returns false when any dimension is < MIN_IMAGE_SIZE (32)', () => {
    expect(isLargeEnough({ getBoundingClientRect: () => ({ width: 31, height: 100 }) })).toBe(false);
    expect(isLargeEnough({ getBoundingClientRect: () => ({ width: 100, height: 10 }) })).toBe(false);
  });
});

describe('getElementDimensions', () => {
  it('prefers natural dimensions over bounding rect', () => {
    const el = {
      naturalWidth: 800,
      naturalHeight: 600,
      getBoundingClientRect: () => ({ width: 100, height: 100 })
    };
    expect(getElementDimensions(el)).toEqual({ width: 800, height: 600 });
  });

  it('falls back to bounding rect if natural dimensions are missing', () => {
    const el = {
      getBoundingClientRect: () => ({ width: 100, height: 100 })
    };
    expect(getElementDimensions(el)).toEqual({ width: 100, height: 100 });
  });

  it('falls back to client dimensions if bounding rect is missing', () => {
    const el = {
      getBoundingClientRect: () => ({}),
      clientWidth: 200,
      clientHeight: 200
    };
    expect(getElementDimensions(el)).toEqual({ width: 200, height: 200 });
  });

  it('returns 0 if no dimensions are found', () => {
    const el = { getBoundingClientRect: () => ({}) };
    expect(getElementDimensions(el)).toEqual({ width: 0, height: 0 });
  });
});

describe('cleanImageUrl', () => {
  beforeEach(() => {
    global.document = { baseURI: 'https://example.com' };
  });

  it('removes sizing parameters from URL queries', () => {
    const url = 'https://example.com/image.jpg?w=500&h=300&q=80&format=webp&other=param';
    expect(cleanImageUrl(url)).toBe('https://example.com/image.jpg?other=param');
  });

  it('removes sizing suffixes from filenames', () => {
    expect(cleanImageUrl('https://example.com/image-500x300.jpg')).toBe('https://example.com/image.jpg');
    expect(cleanImageUrl('https://example.com/image_800w.png')).toBe('https://example.com/image.png');
    expect(cleanImageUrl('https://example.com/image-1024.webp')).toBe('https://example.com/image.webp');
  });

  it('removes hash fragments', () => {
    expect(cleanImageUrl('https://example.com/image.jpg#fragment')).toBe('https://example.com/image.jpg');
  });

  it('leaves standard URLs unchanged', () => {
    expect(cleanImageUrl('https://example.com/simple-image.jpg')).toBe('https://example.com/simple-image.jpg');
  });

  it('returns null for invalid or unsupported URLs', () => {
    expect(cleanImageUrl('data:image/png;base64,...')).toBeNull();
    expect(cleanImageUrl(null)).toBeNull();
  });

  describe('CDN and real-world transformations', () => {
    it('cleans Shopify image URLs', () => {
      expect(cleanImageUrl('https://cdn.shopify.com/s/files/1/0000/0000/products/image_800x800.jpg?v=1234567890'))
        .toBe('https://cdn.shopify.com/s/files/1/0000/0000/products/image.jpg?v=1234567890');

      // Note: the regex in cleanImageUrl doesn't currently handle `_1024x`, so we assert the current behavior
      // which is to leave it unchanged, but it's good to document this in a test.
      expect(cleanImageUrl('https://cdn.shopify.com/s/files/1/0000/0000/products/image_1024x.jpg?v=1234567890'))
        .toBe('https://cdn.shopify.com/s/files/1/0000/0000/products/image_1024x.jpg?v=1234567890');
    });

    it('cleans Imgix image URLs', () => {
      expect(cleanImageUrl('https://example.imgix.net/image.jpg?w=400&h=400&fit=crop&auto=format,compress&q=80'))
        .toBe('https://example.imgix.net/image.jpg');
    });

    it('cleans Cloudinary image URLs', () => {
      expect(cleanImageUrl('https://res.cloudinary.com/demo/image/upload/w_300,h_300,c_fill,q_auto,f_auto/sample.jpg'))
        .toBe('https://res.cloudinary.com/demo/image/upload/w_300,h_300,c_fill,q_auto,f_auto/sample.jpg'); // Note: current logic focuses on queries/filenames, Cloudinary path params are not handled, but let's test current behavior. Or if we want to test queries. Let's test Cloudinary query-based.
      expect(cleanImageUrl('https://res.cloudinary.com/demo/image/upload/sample.jpg?w=300&h=300&q=auto'))
        .toBe('https://res.cloudinary.com/demo/image/upload/sample.jpg');
    });

    it('cleans Unsplash image URLs', () => {
      expect(cleanImageUrl('https://images.unsplash.com/photo-123456?ixlib=rb-1.2.1&w=1080&fit=max&q=80&fm=jpg&crop=entropy&cs=tinysrgb'))
        .toBe('https://images.unsplash.com/photo-123456?cs=tinysrgb');
    });

    it('cleans WordPress / Jetpack Photon URLs', () => {
      expect(cleanImageUrl('https://i0.wp.com/example.com/wp-content/uploads/2023/01/image.jpg?resize=150%2C150&ssl=1'))
        .toBe('https://i0.wp.com/example.com/wp-content/uploads/2023/01/image.jpg?ssl=1');
      expect(cleanImageUrl('https://example.com/wp-content/uploads/2023/01/image-300x200.jpg'))
        .toBe('https://example.com/wp-content/uploads/2023/01/image.jpg');
    });
  });

  describe('Error handling', () => {
    it('returns the absoluteUrl if URL parsing/manipulation throws an error', () => {
      const originalURL = global.URL;
      const testUrl = 'https://example.com/simulate-error.jpg';

      // Mock global URL temporarily to force an error in the try block
      global.URL = class extends originalURL {
        constructor(url, base) {
          if (arguments.length === 1 && url === testUrl) {
            throw new Error('Simulated URL parsing error');
          }
          super(url, base);
        }
      };

      try {
        // toAbsoluteUrl won't throw because it's called with document.baseURI
        // but inside cleanImageUrl it tries `new URL(absoluteUrl)` which will throw
        expect(cleanImageUrl(testUrl)).toBe(testUrl);
      } finally {
        global.URL = originalURL; // Restore
      }
    });
  });
});
