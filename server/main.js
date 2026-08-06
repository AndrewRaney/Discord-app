const { app, BrowserWindow, session, desktopCapturer, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');

let mainWin = null;
let pendingScreenCallback = null;
let serverProc = null;

function waitForPort(port, host = '127.0.0.1', tries = 40) {
  return new Promise((resolve, reject) => {
    let left = tries;
    const tick = () => {
      const socket = net.connect({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        left -= 1;
        if (left <= 0) reject(new Error('Server did not start in time'));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

function getAppRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'app');
  return __dirname;
}

/** True when URL points at this machine / LAN (should run local backend). */
function isLocalServerUrl(urlStr) {
  try {
    let s = String(urlStr || '').trim();
    if (!s) return true;
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    const u = new URL(s);
    const host = (u.hostname || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
    return false;
  } catch (_) {
    return true;
  }
}

let skipLocalBackend = false;

function startBackend() {
  const appRoot = getAppRoot();
  const serverJs = path.join(appRoot, 'server.js');
  const dataDir = app.isPackaged ? app.getPath('userData') : appRoot;

  const cmd = app.isPackaged ? process.execPath : 'node';
  const env = {
    ...process.env,
    DISCORD_LITE_DATA: dataDir
  };
  if (app.isPackaged) env.ELECTRON_RUN_AS_NODE = '1';

  serverProc = spawn(cmd, [serverJs], {
    cwd: appRoot,
    stdio: app.isPackaged ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    windowsHide: true,
    shell: !app.isPackaged && process.platform === 'win32',
    env
  });
  serverProc.on('error', (err) => console.error('Failed to start backend:', err));
  if (serverProc.stderr) {
    serverProc.stderr.on('data', (buf) => console.error('[server]', buf.toString()));
  }
  if (serverProc.stdout) {
    serverProc.stdout.on('data', (buf) => console.log('[server]', buf.toString()));
  }

  return waitForPort(3001).catch(async () => {
    try {
      await waitForPort(3001, '127.0.0.1', 8);
    } catch (_) {
      dialog.showErrorBox(
        'Discord Lite',
        'Could not start the local server on port 3001.\n\nClose any other Discord Lite window and try again.'
      );
    }
  });
}

function setupAutoUpdates() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('electron-updater missing', err);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log('Update available', info && info.version);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const version = (info && info.version) || 'new';
    const result = await dialog.showMessageBox(mainWin || undefined, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Discord Lite ${version} is ready to install.`,
      detail: 'Restart to update. Your friend gets these automatically when you publish a release.'
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err);
  });

  // Check a bit after launch so startup isn't blocked
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => console.error('Update check failed:', err));
  }, 5000);
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'Discord Lite',
    show: false
  });

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
    }).catch((err) => {
      console.error('Failed to list screen sources:', err);
      if (pendingScreenCallback) {
        // null denies the request; {} throws "Video was requested..."
        try { pendingScreenCallback(null); } catch (_) {}
        pendingScreenCallback = null;
      }
    });
  });

  mainWin.removeMenu();
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.loadFile('index.html');
}

app.whenReady().then(async () => {
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

  const addressFile = () => path.join(app.getPath('userData'), 'server-address.txt');

  function readServerAddressFile() {
    try {
      const f = addressFile();
      if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
    } catch (_) {}
    return '';
  }

  function writeServerAddressFile(url) {
    try {
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      fs.writeFileSync(addressFile(), String(url || '').trim(), 'utf8');
    } catch (e) {
      console.warn('Could not save server-address.txt', e);
    }
  }

  ipcMain.handle('get-server-address', () => readServerAddressFile());
  ipcMain.on('set-server-address', (_e, url) => writeServerAddressFile(url));

  const savedServer = readServerAddressFile();
  skipLocalBackend = !!(savedServer && !isLocalServerUrl(savedServer));
  if (skipLocalBackend) {
    console.log('Client-only mode — remote host:', savedServer);
  } else {
    await startBackend();
  }

  createWindow();
  setupAutoUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function stopBackend() {
  if (serverProc && !serverProc.killed) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(serverProc.pid), '/f', '/t'], { windowsHide: true, stdio: 'ignore' });
      } else {
        serverProc.kill();
      }
    } catch (_) {}
    serverProc = null;
  }
}

app.on('window-all-closed', () => {
  if (!skipLocalBackend) stopBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (!skipLocalBackend) stopBackend();
});
