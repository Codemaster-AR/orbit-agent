import { app, BrowserWindow, ipcMain, shell, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = path.join(process.cwd(), 'nexus_session.bin');
const CRED_PATH = path.join(process.cwd(), 'credentials.json');
const AUTH_PORT = 3005;

let mainWindow;
let hiddenBrainWindow; // Our invisible Gemini web engine
let oauthConfig;

// The "Nexus Agent" System Prompt
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
    console.error("DEBUG: Auth Init Fail:", e);
  }
}

// 1. THE HIDDEN BRAIN: Loads the Gemini Web App invisibly
async function initHiddenBrain() {
  hiddenBrainWindow = new BrowserWindow({
    show: false, // Keep it invisible
    webPreferences: {
      partition: 'persist:nexus', // Share cookies with the main app
      contextIsolation: true
    }
  });

  await hiddenBrainWindow.loadURL('https://gemini.google.com/app');
  console.log("DEBUG: Nexus Hidden Brain synchronized.");
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
    scope: ['openid', 'email', 'profile'].join(' ')
  }).toString();
  
  shell.openExternal(authUrl.toString());

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://localhost:${AUTH_PORT}`);
        const code = url.searchParams.get('code');
        if (code) {
          res.end('<body style="background:#050505;color:#4B90FF;text-align:center;padding:50px;font-family:sans-serif;"><h1>Nexus Synced!</h1></body>');
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
          
          // Once tokens are saved, refresh the hidden brain session
          if (hiddenBrainWindow) hiddenBrainWindow.reload();
          
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

function setupHandlers() {
  ipcMain.handle('auth-status', () => fs.existsSync(SESSION_PATH));
  ipcMain.handle('auth-login', async () => await startAuthFlow());
  
  // 2. THE BYPASS: Send prompt to the Web UI instead of the API
  ipcMain.handle('generate-content', async (e, p) => {
    console.log("DEBUG: Agent triggering via Web Interface...");
    try {
      if (!p) return "Error: Prompt empty.";
      
      const fullPrompt = `${SYSTEM_PROTOCOL}${p}`;
      
      // Inject JS into the Gemini Website to type and send
      const script = `
        (async () => {
          const input = document.querySelector('.ql-editor');
          if (!input) return "LOGIN_REQUIRED";
          input.innerText = \`${fullPrompt}\`;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          
          const sendBtn = document.querySelector('button[aria-label="Send message"]');
          sendBtn.click();

          // Wait for response to appear and finish generating
          return new Promise((resolve) => {
            const check = setInterval(() => {
              const lastResponse = document.querySelector('.model-response-text:last-of-type');
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
        return "[Nexus]: You need to log in to your Google Account first.";
      }

      // 3. AGENT ACTION HANDLER: Check for [NAVIGATE: url] tags
      const navMatch = responseText.match(/\[NAVIGATE: (.*?)\]/);
      if (navMatch) {
        const targetUrl = navMatch[1].trim();
        console.log("DEBUG: Agent requested navigation to:", targetUrl);
        // We notify the frontend to update the browser window
        mainWindow.webContents.send('auto-navigate', targetUrl);
      }

      return responseText;
    } catch (err) {
      console.error("DEBUG: Web Scrape Fail:", err);
      return `[Critical Error]: Unable to reach Gemini Web Interface.`;
    }
  });

  ipcMain.on('window-min', () => mainWindow.minimize());
  ipcMain.on('window-max', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
  ipcMain.on('window-close', () => mainWindow.close());
}

const loadBackend = async () => {
  const url = 'http://localhost:3001';
  try {
    await mainWindow.loadURL(url);
    mainWindow.show(); 
  } catch (e) {
    setTimeout(loadBackend, 1000);
  }
};

async function createWindow() {
  await initOAuth(); 
  setupHandlers();
  
  // Set up persistent session partition
  const nexusSession = session.fromPartition('persist:nexus');
  nexusSession.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    show: false, 
    webPreferences: { 
      preload: path.join(__dirname, 'preload.cjs'), 
      contextIsolation: true,
      partition: 'persist:nexus',
      webviewTag: true // Keep this enabled for your future browser components
    },
    frame: false,
    backgroundColor: '#050505',
    titleBarStyle: 'hidden'
  });

  // Start the background brain
  initHiddenBrain();
  loadBackend();
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });