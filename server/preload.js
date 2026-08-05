const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onShowSourcePicker: (callback) => {
    ipcRenderer.on('show-source-picker', (_event, sources) => callback(sources));
  },
  selectSource: (sourceId) => ipcRenderer.send('source-selected', sourceId),
});
