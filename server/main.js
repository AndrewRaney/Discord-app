const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

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

function startBackend() {
  const appRoot = getAppRoot();
  const serverJs = path.join(appRoot, 'server.js');
  const dataDir = app.isPackaged ? app.getPath('userData') : appRoot;

  // Packaged: run server with Electron's Node (matches rebuilt sqlite3)
  // Dev: system Node
  const cmd = app.isPackaged ? process.execPath : 'node';
  const env = {
    ...process.env,
    DISCORD_LITE_DATA: dataDir
  };
  if (app.isPackaged) env.ELECTRON_RUN_AS_NODE = '1';

  serverProc = spawn(cmd, [serverJs], {
    cwd: appRoot,
    stdio: 'ignore',
    windowsHide: true,
    shell: !app.isPackaged && process.platform === 'win32',
    env
  });
  serverProc.on('error', (err) => console.error('Failed to start backend:', err));

  return waitForPort(3001).catch(() => {
    return waitForPort(3001, '127.0.0.1', 5).catch(() => {});
  });
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
        pendingScreenCallback({});
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
    if (!sourceId) { cb({}); return; }
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
      const source = sources.find(s => s.id === sourceId);
      if (source) cb({ video: source, audio: 'loopback' });
      else cb({});
    }).catch(() => cb({}));
  });

  await startBackend();
  createWindow();

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
  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => stopBackend());
