const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron');
const path = require('path');

let mainWin = null;
let pendingScreenCallback = null;

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'Discord Lite'
  });

  // Intercept getDisplayMedia — send source list to renderer for custom picker
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    pendingScreenCallback = callback;
    desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 }
    }).then(sources => {
      const list = sources.map(s => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL()
      }));
      mainWin.webContents.send('show-source-picker', list);
    });
  });

  mainWin.removeMenu();
  mainWin.loadFile('index.html');
}

// Renderer selected a source (or cancelled with null)
ipcMain.on('source-selected', (_event, sourceId) => {
  if (!pendingScreenCallback) return;
  const cb = pendingScreenCallback;
  pendingScreenCallback = null;
  // Deny with null (not {}) — empty object crashes Electron main process
  const deny = () => { try { cb(null); } catch (_) {} };
  if (!sourceId) { deny(); return; }
  desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
    const source = sources.find(s => s.id === sourceId);
    if (source) cb({ video: source, audio: 'loopback' });
    else deny();
  }).catch(() => deny());
});

app.whenReady().then(() => {
  setTimeout(createWindow, 1000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
