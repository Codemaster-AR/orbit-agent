import axios from "axios";
import * as cheerio from "cheerio";
import express from "express";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import path from "path";
import fs from "fs";
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

// 2. PROXY & SCRAPE ENDPOINTS
app.get("/api/proxy", async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) return res.status(400).send("Missing URL");
  
  try {
    const urlObj = new URL(targetUrl);
    const response = await axios.get(targetUrl, {
      responseType: "arraybuffer",
      headers: { 
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      timeout: 15000,
    });

    Object.keys(response.headers).forEach(key => {
      if (!['x-frame-options', 'content-security-policy', 'frame-ancestors', 'set-cookie'].includes(key.toLowerCase())) {
        res.setHeader(key, response.headers[key] as string);
      }
    });

    res.setHeader("X-Frame-Options", "ALLOWALL");
    const contentType = String(response.headers["content-type"] || "");

    if (contentType.includes("text/html")) {
      let html = response.data.toString("utf-8");
      const $ = cheerio.load(html);
      $('head').prepend(`<base href="${urlObj.origin}${urlObj.pathname}">`);

      // LINK REWRITING: Keeps clicks inside our Nexus Proxy
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
          try {
            const absoluteUrl = new URL(href, targetUrl).href;
            $(el).attr('href', `http://localhost:3001/api/proxy?url=${encodeURIComponent(absoluteUrl)}`);
          } catch (e) {}
        }
      });

      res.send($.html());
    } else {
      res.send(response.data);
    }
  } catch (error: any) {
    res.status(500).send(`Proxy Error: ${error.message}`);
  }
});

// 3. BACKGROUND BRAIN SYNC (Restored for Server-side AI tasks)
app.get("/api/scrape", async (req, res) => {
  const targetUrl = req.query.url as string;
  try {
    // Check if we have an active session to use for authenticated scraping if needed
    if (fs.existsSync(TOKEN_PATH) && oauth2Client) {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
      oauth2Client.setCredentials(tokens);
    }

    const response = await axios.get(targetUrl, { timeout: 10000 });
    const $ = cheerio.load(response.data);
    $('script, style, nav, footer, iframe, ads').remove();
    res.json({ text: $('body').text().substring(0, 15000).replace(/\s+/g, ' ').trim() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. FALLBACK CHAT HANDLER
// In case the Electron IPC fails, the server can still talk to the API 
// using the restored scopes from nexus_session.bin
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!fs.existsSync(TOKEN_PATH)) {
    return res.status(401).json({ error: "No active Nexus session. Please login." });
  }

  try {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    oauth2Client.setCredentials(tokens);
    
    // Refresh check to keep the Master Key active
    const tokenResponse = await oauth2Client.getAccessToken();
    const currentToken = tokenResponse.token;

    if (!currentToken) throw new Error("Failed to retrieve master access token.");

    // Direct REST call using the "Retriever" scope permissions
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`,
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

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. BOOTSTRAP
async function startServer() {
  console.log("DEBUG: Starting Vite server in middleware mode...");
  try {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });

    console.log("DEBUG: Vite server created. Attaching middleware...");
    app.use(vite.middlewares);

    // Explicitly serve index.html for SPA routing
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        // Read index.html from root
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        // Transform index.html with Vite (injects HMR script, etc.)
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });

    console.log(`DEBUG: Attempting to listen on port ${PORT}...`);
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\x1b[36m%s\x1b[0m`, `--- NEXUS PROXY ONLINE ---`);
      console.log(`Auth Strategy: Master Scope / Hidden Brain Hybrid`);
      console.log(`----------------------------\n`);
    });
  } catch (err) {
    console.error("DEBUG: Failed to start server:", err);
  }
}

startServer();