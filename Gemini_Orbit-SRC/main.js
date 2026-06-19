// const { app, BrowserWindow } = require('electron');
// const path = require('path');

// function createWindow() {
//   const mainWindow = new BrowserWindow({
//     width: 800,
//     height: 600,
//     webPreferences: {
//       preload: path.join(__dirname, 'preload.cjs')
//     }
//   });

//   mainWindow.loadFile('index.html');
// }

// app.whenReady().then(() => {
//   createWindow();
// });

// app.on('window-all-closed', () => {
//   if (process.platform !== 'darwin') {
//     app.quit();
//   }
// });

import { app, BrowserWindow, ipcMain, shell, session, BrowserView } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';

// 0. GLOBAL BYPASS: Disable User-Agent Client Hints and other detection features
// Google uses these to see the "real" browser behind the UA string.
app.commandLine.appendSwitch('disable-features', 'UserAgentClientHint,IsolateOrigins,site-per-process');
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('excludeSwitches', 'enable-automation');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = path.join(process.cwd(), 'nexus_session.bin');
const CRED_PATH = path.join(process.cwd(), 'credentials.json');
const AUTH_PORT = 3005;

let mainWindow;
let hiddenBrainWindow; 
let oauthConfig;

let browserViews = {};
let tabUrls = {};
let activeTabId = null;

// The "Nexus Agent" System Prompt - Prepend to every prompt
const SYSTEM_PROTOCOL = `[NEXUS SYSTEM OVERRIDE]
You are the Nexus OS Agent. You have control over this Electron interface.
1. To navigate the user's browser, use: [NAVIGATE: url]
2. To scrape the current page for analysis, use: [SCRAPE: current]
3. To provide a UI notification, use: [NOTIFY: message]
Always maintain the Nexus persona. 
----------------------------------
[USER PROMPT]: `;

async function initOAuth() {
  try {
    const resolvedPath = path.resolve(CRED_PATH);
    if (!fs.existsSync(resolvedPath)) return;
    const rawData = await fs.promises.readFile(resolvedPath, 'utf-8');
    const creds = JSON.parse(rawData);
    oauthConfig = creds.installed || creds.web;
  } catch (e) {
    console.error("DEBUG: Nexus Auth Init Fail:", e);
  }
}

// 1. THE HIDDEN BRAIN: Loads Gemini web app invisibly with shared session
async function initHiddenBrain() {
  hiddenBrainWindow = new BrowserWindow({
    show: false, // Set to false to hide the brain window
    webPreferences: {
      partition: 'persist:nexus', 
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
      sandbox: true,
      disableBlinkFeatures: 'AutomationControlled'
    }
  });

  // Windows Chrome User-Agent (User Suggested)
  const windowsUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
  
  // Use the suggested injection method
  await hiddenBrainWindow.loadURL('https://gemini.google.com/app', { userAgent: windowsUA });
  console.log("DEBUG: Nexus Hidden Brain Engine Online.");
}

async function startAuthFlow() {
  if (!oauthConfig) return false;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  
  authUrl.search = new URLSearchParams({
    client_id: oauthConfig.client_id,
    redirect_uri: `http://localhost:${AUTH_PORT}`,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/generative-language.retriever', 
    ].join(' ')
  }).toString();
  
  // Create an internal window for login with all bypasses applied
  const authWindow = new BrowserWindow({
    width: 600,
    height: 800,
    title: "Nexus Login",
    backgroundColor: '#050505',
    webPreferences: {
      partition: 'persist:nexus', // CRITICAL: Save cookies to our shared session
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      disableBlinkFeatures: 'AutomationControlled'
    }
  });

  // Apply clean UA to the login window
  const windowsUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
  
  // Use the suggested loadURL with userAgent
  authWindow.loadURL(authUrl.toString(), { userAgent: windowsUA });

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://localhost:${AUTH_PORT}`);
        const code = url.searchParams.get('code');
        if (code) {
          res.end('<body style="background:#050505;color:#4B90FF;text-align:center;padding:50px;font-family:sans-serif;"><h1>Nexus Synced!</h1><p>You can close this window now.</p></body>');
          
          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              client_id: oauthConfig.client_id,
              client_secret: oauthConfig.client_secret,
              redirect_uri: `http://localhost:${AUTH_PORT}`,
              grant_type: 'authorization_code'
            })
          });

          const tokens = await tokenResponse.json();
          fs.writeFileSync(SESSION_PATH, JSON.stringify({
            ...tokens,
            expiry_date: Date.now() + (tokens.expires_in * 1000)
          }));
          
          // Force refresh
          if (hiddenBrainWindow) hiddenBrainWindow.reload();
          
          setTimeout(() => authWindow.close(), 2000);
          server.close();
          resolve(true);
        }
      } catch (err) {
        res.end('<h1>Auth Failed</h1>');
        server.close();
        reject(err);
      }
    }).listen(AUTH_PORT);
  });
}

function createBrowserView(tabId, url) {
  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: 'persist:nexus', // Share session with the brain
    },
  });

  browserViews[tabId] = view;
  tabUrls[tabId] = url;

  if (url && !url.startsWith('gemini://')) {
    view.webContents.loadURL(url);
  }

  // Event listeners for BrowserView
  view.webContents.on('did-start-loading', () => {
    mainWindow.webContents.send('loading-status', { tabId, isLoading: true });
  });

  view.webContents.on('did-stop-loading', () => {
    mainWindow.webContents.send('loading-status', { tabId, isLoading: false });
  });

  view.webContents.on('page-title-updated', (event, title) => {
    mainWindow.webContents.send('update-title', { tabId, title });
  });

  view.webContents.on('did-navigate', (event, url) => {
    tabUrls[tabId] = url;
    mainWindow.webContents.send('update-url', { tabId, url });
  });

  view.webContents.on('did-navigate-in-page', (event, url) => {
    tabUrls[tabId] = url;
    mainWindow.webContents.send('update-url', { tabId, url });
  });

  // Handle new window requests
  view.webContents.setWindowOpenHandler(({ url }) => {
    mainWindow.webContents.send('request-new-tab', url);
    return { action: 'deny' };
  });

  return view;
}

function setupHandlers() {
  ipcMain.handle('auth-status', () => fs.existsSync(SESSION_PATH));
  ipcMain.handle('auth-login', async () => await startAuthFlow());
  
  // 2. THE HYBRID ENGINE: Prioritize API (Always works), Fallback to Brain
  ipcMain.handle('generate-content', async (e, p) => {
    try {
      if (!p) return "Error: Prompt empty.";

      // PHASE A: Try Direct API if OAuth session exists
      if (fs.existsSync(SESSION_PATH)) {
        try {
          const tokens = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf-8'));
          
          const response = await fetch('http://localhost:3001/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: p }]
            })
          });

          if (response.ok) {
            const data = await response.json();
            // The server returns a simplified object or the full GenAI response
            if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
              return data.candidates[0].content.parts[0].text;
            } else if (data.text) {
              return data.text;
            }
          }
        } catch (apiErr) {
          console.warn("DEBUG: OAuth API fallback failed, trying Hidden Brain...", apiErr);
        }
      }

      // PHASE B: Fallback to Hidden Brain (Web UI Interaction)
      const fullPrompt = `${SYSTEM_PROTOCOL}${p}`;
      
      const script = `
        (async () => {
          const input = document.querySelector('.ql-editor');
          if (!input) return "LOGIN_REQUIRED";
          
          input.innerText = \`${fullPrompt}\`;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          
          const sendBtn = document.querySelector('button[aria-label="Send message"]');
          if (sendBtn) sendBtn.click();

          return new Promise((resolve) => {
            const check = setInterval(() => {
              const responses = document.querySelectorAll('.model-response-text');
              const lastResponse = responses[responses.length - 1];
              const isTyping = document.querySelector('.typing-indicator');
              
              if (lastResponse && !isTyping) {
                clearInterval(check);
                resolve(lastResponse.innerText);
              }
            }, 1000);
          });
        })()
      `;

      const responseText = await hiddenBrainWindow.webContents.executeJavaScript(script);
      
      if (responseText === "LOGIN_REQUIRED") {
        return "[Nexus System]: Google Login required. Please complete the sign-in in the visible 'Brain' window.";
      }

      // COMMAND PROCESSING
      const navMatch = responseText.match(/\[NAVIGATE: (.*?)\]/);
      if (navMatch) {
        const url = navMatch[1].trim();
        mainWindow.webContents.send('auto-navigate', url);
      }

      return responseText;
    } catch (err) {
      console.error("DEBUG: Nexus Engine failure:", err);
      return `[Critical Error]: Nexus Brain is disconnected. Please check your internet and login status.`;
    }
  });

  ipcMain.on('window-min', () => mainWindow.minimize());
  ipcMain.on('window-max', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
  ipcMain.on('window-close', () => mainWindow.close());

  // Tab Management Handlers
  ipcMain.on('create-new-tab', (event, { tabId, url }) => {
    createBrowserView(tabId, url);
  });

  ipcMain.on('switch-tab', (event, tabId) => {
    activeTabId = tabId;
    const view = browserViews[tabId];
    const url = tabUrls[tabId];
    
    if (!view || (url && url.startsWith('gemini://'))) {
      mainWindow.setBrowserView(null);
    } else {
      mainWindow.setBrowserView(view);
      mainWindow.webContents.send('request-bounds-update', tabId);
    }
  });

  ipcMain.on('close-tab', (event, tabId) => {
    const view = browserViews[tabId];
    if (view) {
      if (mainWindow.getBrowserView() === view) {
        mainWindow.setBrowserView(null);
      }
      view.webContents.destroy();
      delete browserViews[tabId];
      delete tabUrls[tabId];
    }
  });

  ipcMain.on('load-url', (event, { tabId, url }) => {
    tabUrls[tabId] = url;
    const view = browserViews[tabId];
    if (view) {
      view.webContents.loadURL(url);
    }
  });

  ipcMain.on('navigate-back', (event, tabId) => {
    const view = browserViews[tabId];
    if (view && view.webContents.canGoBack()) {
      view.webContents.goBack();
    }
  });

  ipcMain.on('navigate-forward', (event, tabId) => {
    const view = browserViews[tabId];
    if (view && view.webContents.canGoForward()) {
      view.webContents.goForward();
    }
  });

  ipcMain.on('refresh-tab', (event, tabId) => {
    const view = browserViews[tabId];
    if (view) {
      view.webContents.reload();
    }
  });

  ipcMain.on('update-bounds', (event, bounds) => {
    const view = browserViews[activeTabId];
    if (view) {
      view.setBounds(bounds);
    }
  });

  ipcMain.on('window-control', (event, action) => {
    if (action === 'close') mainWindow.close();
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
}

const loadBackend = async () => {
  const url = 'http://localhost:3001';
  console.log(`DEBUG: Attempting to load backend from ${url}...`);
  try {
    await mainWindow.loadURL(url);
    console.log("DEBUG: Backend loaded successfully.");
    mainWindow.show(); 
    mainWindow.webContents.openDevTools(); // OPEN DEVTOOLS TO SEE ERRORS
  } catch (e) {
    console.error(`DEBUG: Backend load failed: ${e.message}`);
    setTimeout(loadBackend, 1000);
  }
};

async function createWindow() {
  await initOAuth(); 
  setupHandlers();
  
  const nexusSession = session.fromPartition('persist:nexus');
  
  // 1. WINDOWS CHROME USER-AGENT (User Suggested)
  const windowsUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
  nexusSession.setUserAgent(windowsUA);

  // 2. AGGRESSIVE HEADER CLEANING
  nexusSession.webRequest.onBeforeSendHeaders((details, callback) => {
    // Force the clean UA for every single request
    details.requestHeaders['User-Agent'] = windowsUA;
    
    // Delete any headers that leak Electron/App identity
    delete details.requestHeaders['X-Requested-With'];
    delete details.requestHeaders['X-Electron-Event-ID'];
    delete details.requestHeaders['X-Electron-Display-ID'];
    
    // Also strip Sec-CH-UA hints which can override the UA string
    Object.keys(details.requestHeaders).forEach(header => {
      if (header.toLowerCase().startsWith('sec-ch-ua')) {
        delete details.requestHeaders[header];
      }
    });

    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  // 3. ADVANCED SPOOFING: Masking as a real Windows device
  const spoofScript = `
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
    
    window.chrome = {
      runtime: {},
      loadTimes: function() {},
      csi: function() {},
      app: {}
    };

    if (window.process) delete window.process;
  `;
  
  app.on('web-contents-created', (event, contents) => {
    contents.on('dom-ready', async () => {
      try {
        await contents.executeJavaScript(spoofScript);
        // console.log("DEBUG: Spoof script applied successfully.");
      } catch (err) {
        console.error("DEBUG: Spoof script execution failed:", err);
      }
    });
  });

  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    show: true, 
    webPreferences: { 
      preload: path.join(__dirname, 'preload.cjs'), 
      contextIsolation: true,
      nodeIntegration: false, 
      enableRemoteModule: false,
      sandbox: true,
      disableBlinkFeatures: 'AutomationControlled',
      partition: 'persist:nexus',
      webviewTag: true
    },
    frame: false,
    backgroundColor: '#050505',
    titleBarStyle: 'hidden'
  });

  initHiddenBrain();
  loadBackend();
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
