import express from "express";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import path from "path";
import fs from "fs";
import axios from "axios";
import * as cheerio from "cheerio";
import { OAuth2Client } from "google-auth-library";

const app = express();
const PORT = 3001;

// --- CONFIGURATION ---
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const TOKEN_PATH = path.join(process.cwd(), "nexus_session.bin");

let oauth2Client: OAuth2Client;

if (fs.existsSync(CREDENTIALS_PATH)) {
  const keys = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const config = keys.installed || keys.web;
  oauth2Client = new OAuth2Client(
    config.client_id, 
    config.client_secret, 
    `http://localhost:3005`
  );
}

// 1. MIDDLEWARE
app.use(cors({ origin: '*' }));
app.use(express.json());

// Logger for debugging race conditions
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  next();
});

// 2. PROXY & SCRAPE ENDPOINTS
app.get("/api/proxy", async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) return res.status(400).send("Missing URL");
  
  try {
    const urlObj = new URL(targetUrl);
    const response = await axios.get(targetUrl, {
      responseType: "arraybuffer",
      headers: { "User-Agent": "Mozilla/5.0 NexusEngine/1.0" },
      timeout: 15000,
    });

    // Strip restrictive headers to allow iframe embedding
    Object.keys(response.headers).forEach(key => {
      if (!['x-frame-options', 'content-security-policy', 'frame-ancestors'].includes(key.toLowerCase())) {
        res.setHeader(key, response.headers[key] as string);
      }
    });

    res.setHeader("X-Frame-Options", "ALLOWALL");
    const contentType = String(response.headers["content-type"] || "");

    if (contentType.includes("text/html")) {
      let html = response.data.toString("utf-8");
      const $ = cheerio.load(html);
      // Inject base tag to fix relative assets (images/css)
      $('head').prepend(`<base href="${urlObj.origin}${urlObj.pathname}">`);
      res.send($.html());
    } else {
      res.send(response.data);
    }
  } catch (error: any) {
    res.status(500).send(`Proxy Error: ${error.message}`);
  }
});

app.get("/api/scrape", async (req, res) => {
  const targetUrl = req.query.url as string;
  try {
    const response = await axios.get(targetUrl, { timeout: 10000 });
    const $ = cheerio.load(response.data);
    $('script, style, nav, footer').remove();
    res.json({ text: $('body').text().substring(0, 20000).trim() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. NEXUS CHAT ENGINE (OAuth2 Streaming)
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!fs.existsSync(TOKEN_PATH)) {
    return res.status(401).json({ error: "No active Nexus session. Please login." });
  }

  try {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    oauth2Client.setCredentials(tokens);
    
    // Refresh check: Ensure the local session stays in sync with Google
    const tokenResponse = await oauth2Client.getAccessToken();
    const currentToken = tokenResponse.token;

    if (tokenResponse.res) {
      const updatedTokens = { ...tokens, ...tokenResponse.res.data };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedTokens));
      console.log("DEBUG: Nexus session synchronized.");
    }
    
    if (!currentToken) throw new Error("Failed to retrieve access token.");

    // Using direct REST streaming for better compatibility with OAuth Bearer tokens
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: messages.map((m: any) => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
          }))
        })
      }
    );

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    if (!response.body) throw new Error("ReadableStream not available.");
    const reader = response.body.getReader();

    // Prevent memory leaks if the user closes the window
    req.on('close', () => {
      reader.cancel();
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = new TextDecoder().decode(value);
      // Filter SSE prefix if using alt=sse, or pass through JSON
      res.write(chunk);
    }

    res.end();

  } catch (err: any) {
    console.error("CRITICAL: Nexus Chat Error -", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// 4. BOOTSTRAP
async function startServer() {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa"
  });

  // IMPORTANT: API routes must come BEFORE Vite middleware
  app.use(vite.middlewares);

  app.listen(PORT, '0.0.0.0', () => {
    console.clear();
    console.log(`\x1b[36m%s\x1b[0m`, `--- NEXUS ENGINE ONLINE ---`);
    console.log(`Endpoint: http://localhost:${PORT}`);
    console.log(`M4 Pro Performance Mode: Active`);
    console.log(`----------------------------\n`);
  });
}

startServer();