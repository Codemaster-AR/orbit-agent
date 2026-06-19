// In preload.cjs, find the contextBridge.exposeInMainWorld call
// and add the 'security' object to it.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  windowControl: (action) => ipcRenderer.send('window-control', action),
  auth: {
    login: () => ipcRenderer.invoke('auth-login'),
    status: () => ipcRenderer.invoke('auth-status'),
    generateContent: (prompt) => ipcRenderer.invoke('generate-content', prompt),
  },
  ipcRenderer: {
    send: (channel, data) => {
      let validChannels = [
        'create-new-tab', 'switch-tab', 'close-tab', 'load-url',
        'navigate-back', 'navigate-forward', 'refresh-tab', 'update-bounds'
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
    on: (channel, func) => {
      let validChannels = [
        'update-url', 'update-title', 'loading-status',
        'request-new-tab', 'request-bounds-update',
        'auto-navigate' // Corrected typo from 'auto-Nnavigate'
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.on(channel, (event, ...args) => func(event, ...args));
      }
    },
    removeAllListeners: (channel) => {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  // --- Add the new security block here ---
  security: {
    getSettings: () => ipcRenderer.invoke('get-security-settings'),
    updateSetting: (key, value) => ipcRenderer.send('update-security-setting', { key, value }),
  },
  // --- End of security block ---
});