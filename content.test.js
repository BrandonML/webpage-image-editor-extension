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
  extractFileType
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

  it('handles empty or missing input', () => {
    expect(parseSrcset('')).toEqual([]);
    expect(parseSrcset(null)).toEqual([]);
    expect(parseSrcset(undefined)).toEqual([]);
  });

  it('handles URLs without descriptors', () => {
    expect(parseSrcset('image.jpg')).toEqual(['image.jpg']);
    expect(parseSrcset('img1.jpg, img2.jpg')).toEqual(['img1.jpg', 'img2.jpg']);
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
});
