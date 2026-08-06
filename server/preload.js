const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onShowSourcePicker: (callback) => {
    ipcRenderer.on('show-source-picker', (_event, sources) => callback(sources));
  },
  selectSource: (sourceId) => ipcRenderer.send('source-selected', sourceId),
  setServerAddress: (url) => ipcRenderer.send('set-server-address', url),
  getServerAddress: () => ipcRenderer.invoke('get-server-address'),
});
