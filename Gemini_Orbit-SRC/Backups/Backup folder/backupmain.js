import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = path.join(process.cwd(), 'nexus_session.bin');
const CRED_PATH = path.join(process.cwd(), 'credentials.json');
const AUTH_PORT = 3005;

// Stable May 2026 alias
const GEMINI_MODEL = 'gemini-flash-latest'; 

let mainWindow;
let oauthConfig;

async function initOAuth() {
  try {
    const resolvedPath = path.resolve(CRED_PATH);
    if (!fs.existsSync(resolvedPath)) return;
    const rawData = await fs.promises.readFile(resolvedPath, 'utf-8');
    const creds = JSON.parse(rawData);
    oauthConfig = creds.installed || creds.web;
    console.log("DEBUG: Nexus Auth Config Loaded.");
  } catch (e) {
    console.error("DEBUG: Nexus Auth Init Fail:", e);
  }
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
          console.log("DEBUG: Tokens saved.");
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

async function getGeminiAccessToken() {
  if (!fs.existsSync(SESSION_PATH)) throw new Error("No session found.");
  const tokens = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf-8'));

  if (tokens.access_token && tokens.expiry_date > Date.now() + 60000) return tokens.access_token;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauthConfig.client_id,
      client_secret: oauthConfig.client_secret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token'
    })
  });

  const refreshed = await tokenResponse.json();
  const nextTokens = { ...tokens, ...refreshed, expiry_date: Date.now() + (refreshed.expires_in * 1000) };
  fs.writeFileSync(SESSION_PATH, JSON.stringify(nextTokens));
  return nextTokens.access_token;
}

async function generateGeminiContent(prompt) {
  try {
    const accessToken = await getGeminiAccessToken();
    const projectId = 'gen-lang-client-0391853953'; 

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'x-goog-user-project': projectId 
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ]
        }),
      }
    );

    const data = await response.json();

    // BUG FIX: Catch 429/500 errors before they become [object Object]
    if (!response.ok) {
      console.error("DEBUG: API Error Detail:", data);
      return { 
        error: data.error?.message || `Google API Error (${response.status})` 
      };
    }

    console.log("DEBUG: API response received."); 
    return data;
  } catch (e) {
    console.error("DEBUG: Fetch logic failed:", e.message);
    return { error: e.message };
  }
}

function setupHandlers() {
  ipcMain.handle('auth-status', () => fs.existsSync(SESSION_PATH));
  ipcMain.handle('auth-login', async () => await startAuthFlow());
  
  ipcMain.handle('generate-content', async (e, p) => {
    console.log("DEBUG: Chat IPC triggered with prompt:", p);
    try {
      if (!p) return "Error: Prompt was empty.";
      
      const data = await generateGeminiContent(p);
      
      // BUG FIX: Ensure the error is stringified for the Liquid Glass UI
      if (data.error) {
        return `[System Error]: ${typeof data.error === 'object' ? JSON.stringify(data.error) : data.error}`;
      }

      // BUG FIX: Graceful safety filter exit
      if (data.candidates?.[0]?.finishReason === "SAFETY") {
        return "System: Response blocked by safety filters.";
      }

      if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text;
      }

      console.error("DEBUG: Unexpected response structure:", JSON.stringify(data));
      return "System: Response structure is bugged or empty.";
    } catch (err) {
      console.error("DEBUG: Critical IPC Catch:", err);
      return `[Critical Error]: ${err.message}`;
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
    console.log("DEBUG: Nexus GUI Connected.");
    mainWindow.show(); 
  } catch (e) {
    console.log("DEBUG: Server not ready, retrying...");
    setTimeout(loadBackend, 1000);
  }
};

async function createWindow() {
  await initOAuth(); 
  setupHandlers();
  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    show: false, 
    webPreferences: { 
      preload: path.join(__dirname, 'preload.cjs'), 
      contextIsolation: true 
    },
    frame: false,
    backgroundColor: '#050505',
    titleBarStyle: 'hidden'
  });

  loadBackend();
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });