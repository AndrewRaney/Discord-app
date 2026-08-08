const { app, BrowserWindow, session, desktopCapturer, ipcMain, dialog, Tray, Menu, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');

// Prefer dark native chrome (avoids Windows accent-colored title bars)
nativeTheme.themeSource = 'dark';

let mainWin = null;
let pendingScreenCallback = null;
let serverProc = null;
let appTray = null;

function waitForPort(port, host = '127.0.0.1', tries = 60) {
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

function waitForHealth(tries = 80) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    let left = tries;
    const tick = () => {
      const req = http.get('http://127.0.0.1:3001/health', (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (res.statusCode === 200) resolve(body);
          else retry();
        });
      });
      req.on('error', retry);
      req.setTimeout(1500, () => { try { req.destroy(); } catch (_) {} retry(); });
      function retry() {
        left -= 1;
        if (left <= 0) reject(new Error('Server health check failed'));
        else setTimeout(tick, 250);
      }
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
  const dataDir = process.env.DISCORD_LITE_DATA
    || (app.isPackaged ? app.getPath('userData') : appRoot);

  // Use Electron as Node so PATH / shell quirks don't break spawning on Windows
  const cmd = process.execPath;
  const env = {
    ...process.env,
    DISCORD_LITE_DATA: dataDir,
    ELECTRON_RUN_AS_NODE: '1',
  };

  const logDir = path.join(dataDir, 'logs');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}
  const logFile = path.join(logDir, 'server-startup.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  try {
    logStream.write(`\n---- ${new Date().toISOString()} starting ${serverJs}\n`);
  } catch (_) {}

  serverProc = spawn(cmd, [serverJs], {
    cwd: appRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
    env
  });
  serverProc.on('error', (err) => {
    console.error('Failed to start backend:', err);
    try { logStream.write('spawn error: ' + err.message + '\n'); } catch (_) {}
  });
  serverProc.on('exit', (code, signal) => {
    console.error('Backend exited', code, signal);
    try { logStream.write(`exit code=${code} signal=${signal}\n`); } catch (_) {}
  });
  if (serverProc.stdout) {
    serverProc.stdout.on('data', (buf) => {
      const t = buf.toString();
      console.log('[server]', t);
      try { logStream.write(t); } catch (_) {}
    });
  }
  if (serverProc.stderr) {
    serverProc.stderr.on('data', (buf) => {
      const t = buf.toString();
      console.error('[server]', t);
      try { logStream.write(t); } catch (_) {}
    });
  }

  return waitForPort(3001)
    .then(() => waitForHealth())
    .catch(async (err) => {
      console.error('Backend wait failed:', err);
      try {
        await waitForHealth(20);
        return;
      } catch (_) {
        dialog.showErrorBox(
          'Iris',
          'Could not start the local server on port 3001.\n\n' +
          'Close other Iris / host windows, then try again.\n\n' +
          'Log: ' + logFile
        );
        throw err;
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
      message: `Iris ${version} is ready to install.`,
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

function getAppIconPath() {
  const candidates = [
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, 'build-resources', 'icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const isHostMode = process.argv.includes('--host') || process.env.DISCORD_LITE_HOST_MODE === '1';
const forceLocal = process.argv.includes('--local') || process.env.DISCORD_LITE_FORCE_LOCAL === '1';

function createWindow() {
  const iconPath = getAppIconPath();
  mainWin = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: iconPath || undefined,
    backgroundColor: '#1a1b1e',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1b1e',
      symbolColor: '#b5bac1',
      height: 32
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'Iris',
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

  if (forceLocal) {
    mainWin.webContents.on('dom-ready', () => {
      mainWin.webContents.executeJavaScript(`
        (function () {
          var want = 'http://127.0.0.1:3001';
          var cur = localStorage.getItem('discordLiteServer') || '';
          if (cur !== want) {
            localStorage.setItem('discordLiteServer', want);
            location.reload();
          }
        })();
      `).catch(() => {});
    });
  }

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
  skipLocalBackend = !isHostMode && !forceLocal && !!(savedServer && !isLocalServerUrl(savedServer));
  if (forceLocal) {
    writeServerAddressFile('http://127.0.0.1:3001');
    skipLocalBackend = false;
    console.log('Force local mode — starting server + Iris window');
  }
  if (skipLocalBackend) {
    console.log('Client-only mode — remote host:', savedServer);
  } else {
    try {
      await startBackend();
    } catch (e) {
      console.error(e);
      app.quit();
      return;
    }
  }

  if (isHostMode) {
    setupHostTray();
    console.log('Host mode — tray icon active. Backend on port 3001.');
  } else {
    createWindow();
    setupAutoUpdates();
    setupTray();
  }

  app.on('activate', () => {
    if (isHostMode) return;
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function setupTray() {
  try {
    const iconPath = getAppIconPath();
    if (!iconPath) return;
    const img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) return;
    appTray = new Tray(img.resize({ width: 16, height: 16 }));
    const label = skipLocalBackend ? 'Iris (client)' : 'Iris';
    appTray.setToolTip(label);
    appTray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open', click: () => { if (mainWin) { mainWin.show(); mainWin.focus(); } } },
      { label: skipLocalBackend ? 'Mode: remote host' : 'Mode: local server', enabled: false },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
    appTray.on('click', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });
  } catch (e) {
    console.warn('Tray setup failed', e);
  }
}

function setupHostTray() {
  try {
    const iconPath = getAppIconPath();
    if (!iconPath) {
      console.warn('Host tray: icon.png missing');
      return;
    }
    const img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) return;
    appTray = new Tray(img.resize({ width: 16, height: 16 }));
    appTray.setToolTip('Iris Host — running');

    const rebuild = async () => {
      let tunnel = '(starting…)';
      try {
        const http = require('http');
        tunnel = await new Promise((resolve) => {
          const req = http.get('http://127.0.0.1:3001/tunnel', (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
              try { resolve(JSON.parse(body).url || '(no url yet)'); }
              catch { resolve('(no url yet)'); }
            });
          });
          req.on('error', () => resolve('(server not ready)'));
          req.setTimeout(2000, () => { try { req.destroy(); } catch (_) {} resolve('(timeout)'); });
        });
      } catch (_) {}
      const short = String(tunnel).length > 48 ? String(tunnel).slice(0, 45) + '…' : String(tunnel);
      appTray.setToolTip(tunnel && tunnel.startsWith('http') ? `Host: ${tunnel}` : 'Iris Host — running');
      appTray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Host running on port 3001', enabled: false },
        { label: short, enabled: false },
        { type: 'separator' },
        {
          label: 'Copy tunnel URL',
          enabled: !!(tunnel && String(tunnel).startsWith('http')),
          click: () => {
            if (tunnel && String(tunnel).startsWith('http')) {
              require('electron').clipboard.writeText(String(tunnel));
            }
          }
        },
        {
          label: 'Open URL file',
          click: () => {
            const f = path.join(process.env.DISCORD_LITE_DATA || app.getPath('userData'), 'Iris-Host-URL.txt');
            const desktop = path.join(require('os').homedir(), 'Desktop', 'Iris-Host-URL.txt');
            const target = fs.existsSync(desktop) ? desktop : f;
            if (fs.existsSync(target)) require('electron').shell.openPath(target);
          }
        },
        { type: 'separator' },
        { label: 'Refresh URL', click: () => rebuild() },
        { label: 'Stop Host', click: () => app.quit() },
      ]));
    };

    rebuild();
    setInterval(rebuild, 15000);
  } catch (e) {
    console.warn('Host tray setup failed', e);
  }
}

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
  if (isHostMode) return; // tray keeps host alive with no window
  if (!skipLocalBackend) stopBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (!skipLocalBackend) stopBackend();
});
