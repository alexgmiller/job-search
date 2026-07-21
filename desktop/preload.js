const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onListings: (cb) => ipcRenderer.on('listings', (_e, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('load-error', (_e, msg) => cb(msg)),
  refresh: () => ipcRenderer.invoke('refresh'),
  getSearches: () => ipcRenderer.invoke('get-searches'),
  getApplied: () => ipcRenderer.invoke('get-applied'),
  addSearch: (search) => ipcRenderer.invoke('add-search', search),
  updateSearch: (search) => ipcRenderer.invoke('update-search', search),
  deleteSearch: (id) => ipcRenderer.invoke('delete-search', id),
  markApplied: (id) => ipcRenderer.invoke('mark-applied', id),
  setStatus: (id, status) => ipcRenderer.invoke('set-status', { id, status }),
  setNotes: (id, notes) => ipcRenderer.invoke('set-notes', { id, notes }),
  markSeen: (id) => ipcRenderer.invoke('mark-seen', id),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  quit: () => ipcRenderer.invoke('quit'),
});
