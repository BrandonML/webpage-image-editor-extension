const setOptionsMock = jest.fn();
const openMock = jest.fn();
const sendMessageMock = jest.fn();
const onClickedActionMock = jest.fn();
const onClickedContextMenusMock = jest.fn();

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
      addListener: jest.fn(),
    },
    sendMessage: sendMessageMock,
    lastError: undefined,
  },
};

// We need to capture the listeners added so we can trigger them in tests
let actionClickListener;
let contextMenuClickListener;

onClickedActionMock.mockImplementation((listener) => {
  actionClickListener = listener;
});

onClickedContextMenusMock.mockImplementation((listener) => {
  contextMenuClickListener = listener;
});

// Import the background script to initialize the listeners
require('./background.js');

describe('background.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    expect(openMock).toHaveBeenCalledWith({ windowId: 456 });

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

    expect(openMock).toHaveBeenCalledWith({ windowId: 101 });

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
