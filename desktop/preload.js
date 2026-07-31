const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onListings: (cb) => ipcRenderer.on('listings', (_e, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('load-error', (_e, msg) => cb(msg)),
  refresh: () => ipcRenderer.invoke('refresh'),
  setMode: (mode) => ipcRenderer.invoke('set-mode', mode),
  minimize: () => ipcRenderer.invoke('minimize'),
  getSearches: () => ipcRenderer.invoke('get-searches'),
  dismiss: (id) => ipcRenderer.invoke('dismiss', id),
  restore: (id) => ipcRenderer.invoke('restore', id),
  addSearch: (search) => ipcRenderer.invoke('add-search', search),
  updateSearch: (search) => ipcRenderer.invoke('update-search', search),
  deleteSearch: (id) => ipcRenderer.invoke('delete-search', id),
  markApplied: (id) => ipcRenderer.invoke('mark-applied', id),
  setStatus: (id, status) => ipcRenderer.invoke('set-status', { id, status }),
  setNotes: (id, notes) => ipcRenderer.invoke('set-notes', { id, notes }),
  getProfile: () => ipcRenderer.invoke('get-profile'),
  addChunk: (chunk) => ipcRenderer.invoke('add-chunk', chunk),
  importResume: () => ipcRenderer.invoke('import-resume'),
  addChunks: (chunks) => ipcRenderer.invoke('add-chunks', chunks),
  deleteChunk: (id) => ipcRenderer.invoke('delete-chunk', id),
  tailorResume: (id) => ipcRenderer.invoke('tailor-resume', id),
  saveText: (content, defaultName) =>
    ipcRenderer.invoke('save-text', { content, defaultName }),
  markSeen: (id) => ipcRenderer.invoke('mark-seen', id),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  quit: () => ipcRenderer.invoke('quit'),
});
