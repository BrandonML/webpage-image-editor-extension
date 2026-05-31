const setOptionsMock = jest.fn();
const openMock = jest.fn();
const sendMessageMock = jest.fn();
const onClickedActionMock = jest.fn();
const onClickedContextMenusMock = jest.fn();
const onMessageMock = jest.fn();

global.chrome = {
  sidePanel: {
    setOptions: setOptionsMock,
    open: openMock,
  },
  action: {
    onClicked: {
      addListener: onClickedActionMock,
    },
  },
  contextMenus: {
    remove: jest.fn((id, cb) => cb && cb()),
    create: jest.fn(),
    onClicked: {
      addListener: onClickedContextMenusMock,
    },
  },
  runtime: {
    onInstalled: {
      addListener: jest.fn(),
    },
    onMessage: {
      addListener: onMessageMock,
    },
    sendMessage: sendMessageMock,
    lastError: undefined,
  },
};

// We need to capture the listeners added so we can trigger them in tests
let actionClickListener;
let contextMenuClickListener;
let messageListener;

onClickedActionMock.mockImplementation((listener) => {
  actionClickListener = listener;
});

onClickedContextMenusMock.mockImplementation((listener) => {
  contextMenuClickListener = listener;
});

onMessageMock.mockImplementation((listener) => {
  messageListener = listener;
});

global.fetch = jest.fn();
global.btoa = jest.fn((str) => Buffer.from(str, 'binary').toString('base64'));

// Prevent console.error from littering test output unless we're debugging
const originalConsoleError = console.error;

// Import the background script to initialize the listeners
require('./background.js');

describe('background.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch.mockClear();
    console.error = jest.fn();
  });

  afterAll(() => {
    console.error = originalConsoleError;
  });

  it('should open side panel correctly for action click', async () => {
    // A valid tab object
    const tab = {
      id: 123,
      windowId: 456,
    };

    // Simulate clicking the extension action icon
    await actionClickListener(tab);

    expect(setOptionsMock).toHaveBeenCalledWith({
      tabId: 123,
      path: 'sidebar.html',
      enabled: true,
    });

    // open should be called
    expect(openMock).toHaveBeenCalledWith({ tabId: 123 });

    // Verify it doesn't return a rejected promise
    // It is important that setOptions is called *without* await
    // so we can't test that directly with mocks but we can ensure they are both called
  });

  it('should not open side panel if tab properties are missing for action click', async () => {
    const tab = { id: 123 }; // missing windowId

    await actionClickListener(tab);

    expect(setOptionsMock).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
  });

  it('should open side panel correctly for context menu image click', async () => {
    const info = {
      menuItemId: 'processImage',
      srcUrl: 'https://example.com/image.png'
    };
    const tab = {
      id: 789,
      windowId: 101,
    };

    // Use jest fake timers to control the setTimeout
    jest.useFakeTimers();

    // The listener returns a promise resolving after the timeout in the original code,
    // so we just call the listener and await all pending promises / timers.
    const promise = contextMenuClickListener(info, tab);

    // We need to wait for the openPanelForTab promise to resolve before we can advance timers
    await Promise.resolve();
    await Promise.resolve();

    expect(setOptionsMock).toHaveBeenCalledWith({
      tabId: 789,
      path: 'sidebar.html',
      enabled: true,
    });

    expect(openMock).toHaveBeenCalledWith({ tabId: 789 });

    // Fast-forward the setTimeout
    jest.runAllTimers();

    expect(sendMessageMock).toHaveBeenCalledWith({
      action: 'CONTEXT_IMAGE_TARGET',
      url: 'https://example.com/image.png'
    });

    jest.useRealTimers();
  });

  it('should not process context menu clicks for other menu items', async () => {
    const info = {
      menuItemId: 'otherMenu',
      srcUrl: 'https://example.com/image.png'
    };
    const tab = {
      id: 789,
      windowId: 101,
    };

    await contextMenuClickListener(info, tab);

    expect(setOptionsMock).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
  });
});

describe('FETCH_IMAGE_BORS_BYPASS handler', () => {
  beforeEach(() => {
    global.fetch.mockClear();
    console.error = jest.fn();
  });

  it('should process https urls', async () => {
    const sendResponseMock = jest.fn();
    const mockBlob = {
      type: 'image/png',
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8))
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      blob: jest.fn().mockResolvedValue(mockBlob)
    });

    const isAsync = messageListener(
      { action: 'FETCH_IMAGE_BORS_BYPASS', url: 'https://example.com/image.png' },
      {},
      sendResponseMock
    );

    expect(isAsync).toBe(true);

    // wait for async operations to complete
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(global.fetch).toHaveBeenCalledWith('https://example.com/image.png', expect.any(Object));
    expect(sendResponseMock).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('should process http urls', async () => {
    const sendResponseMock = jest.fn();
    const mockBlob = {
      type: 'image/jpeg',
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8))
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      blob: jest.fn().mockResolvedValue(mockBlob)
    });

    messageListener(
      { action: 'FETCH_IMAGE_BORS_BYPASS', url: 'http://example.com/image.jpg' },
      {},
      sendResponseMock
    );

    await new Promise(process.nextTick);
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(global.fetch).toHaveBeenCalledWith('http://example.com/image.jpg', expect.any(Object));
    expect(sendResponseMock).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('should reject non-http/https urls (file:)', async () => {
    const sendResponseMock = jest.fn();

    messageListener(
      { action: 'FETCH_IMAGE_BORS_BYPASS', url: 'file:///etc/passwd' },
      {},
      sendResponseMock
    );

    await new Promise(process.nextTick);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(sendResponseMock).toHaveBeenCalledWith({
      ok: false,
      error: 'Untrusted URL protocol. Only HTTP and HTTPS are allowed.'
    });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Security Error: Untrusted URL protocol'));
  });

  it('should reject invalid urls', async () => {
    const sendResponseMock = jest.fn();

    messageListener(
      { action: 'FETCH_IMAGE_BORS_BYPASS', url: 'not-a-url' },
      {},
      sendResponseMock
    );

    await new Promise(process.nextTick);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(sendResponseMock).toHaveBeenCalledWith({
      ok: false,
      error: 'Invalid URL provided.'
    });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid URL provided:'));
  });
});
