import { app, BrowserWindow, session, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

// Disable hardware acceleration to prevent GPU crashes
app.disableHardwareAcceleration();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    frame: false,
  });

  // Grant all permissions automatically
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });

  // Handle window controls
  ipcMain.on('window-control', (event, action) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    
    switch (action) {
      case 'close':
        window.close();
        break;
      case 'minimize':
        window.minimize();
        break;
      case 'maximize':
        if (window.isMaximized()) {
          window.unmaximize();
        } else {
          window.maximize();
        }
        break;
    }
  });

  // Modify headers to allow framing for sites that use X-Frame-Options or CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [''],
        'X-Frame-Options': ['ALLOWALL'],
      },
    });
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  win.webContents.on('render-process-gone', (event, detailed) => {
    console.log(`! Renderer process gone: ${detailed.reason} (${detailed.exitCode})`);
  });

  win.webContents.on('unresponsive', () => {
    console.log('! Window became unresponsive');
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
