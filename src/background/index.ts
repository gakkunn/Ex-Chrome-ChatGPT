chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.action === 'openSettings') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/index.html') });
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'reload_extension_dev') {
    chrome.runtime.reload();
  }
});
