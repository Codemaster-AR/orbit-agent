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

// 2. PROXY & SCRAPE ENDPOINTS
app.get("/api/proxy", async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) return res.status(400).send("Missing URL");
  
  try {
    const urlObj = new URL(targetUrl);
    const response = await axios.get(targetUrl, {
      responseType: "arraybuffer",
      // Identity mimicking for M4 Pro environment
      headers: { 
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      timeout: 15000,
    });

    // Strip restrictive headers to allow our Liquid Glass UI to render the page
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
      
      // Inject base tag to fix relative assets
      $('head').prepend(`<base href="${urlObj.origin}${urlObj.pathname}">`);

      // --- CRITICAL: LINK REWRITING ---
      // This ensures that clicking a link updates the URL within our Nexus Proxy
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
          try {
            const absoluteUrl = new URL(href, targetUrl).href;
            $(el).attr('href', `http://localhost:3001/api/proxy?url=${encodeURIComponent(absoluteUrl)}`);
          } catch (e) {
            // Keep original if URL parsing fails
          }
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

app.get("/api/scrape", async (req, res) => {
  const targetUrl = req.query.url as string;
  try {
    const response = await axios.get(targetUrl, { timeout: 10000 });
    const $ = cheerio.load(response.data);
    // Deep clean for the AI context
    $('script, style, nav, footer, iframe, ads').remove();
    res.json({ text: $('body').text().substring(0, 15000).replace(/\s+/g, ' ').trim() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. NEXUS CHAT ENGINE (Modified for Hidden Brain Sync)
// We keep this endpoint but we can now redirect it to the hidden main.js handler
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  const lastUserMessage = messages[messages.length - 1].content;

  try {
    // In our new architecture, the frontend calls the IPC handler directly, 
    // but we'll keep this here as a fallback or for simple API tasks.
    res.json({ status: "Redirecting to IPC Hidden Brain" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. BOOTSTRAP
async function startServer() {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa"
  });

  app.use(vite.middlewares);

  app.listen(PORT, '0.0.0.0', () => {
    console.clear();
    console.log(`\x1b[36m%s\x1b[0m`, `--- NEXUS PROXY ONLINE ---`);
    console.log(`Rewriter Active: Link Persistence Enabled`);
    console.log(`----------------------------\n`);
  });
}

startServer();