const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onListings: (cb) => ipcRenderer.on('listings', (_e, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('load-error', (_e, msg) => cb(msg)),
  refresh: () => ipcRenderer.invoke('refresh'),
  getSearches: () => ipcRenderer.invoke('get-searches'),
  addSearch: (search) => ipcRenderer.invoke('add-search', search),
  markSeen: (id) => ipcRenderer.invoke('mark-seen', id),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  quit: () => ipcRenderer.invoke('quit'),
});
