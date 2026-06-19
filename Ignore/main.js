const { app, BrowserWindow, ipcMain } = require('electron');
const { Stagehand } = require('@browserbasehq/stagehand');
require('dotenv').config();

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

ipcMain.on('run-agent', async (event, userPrompt) => {
    try {
        event.reply('status-update', '🤖 Launching Orbit browser...');

        const stagehand = new Stagehand({
            env: "LOCAL", // Launches on your desktop natively
            apiKey: process.env.STAGEHAND_API_KEY,
            modelName: "gemini-2.5-flash", 
            modelClientOptions: {
                apiKey: process.env.GEMINI_API_KEY,
            },
        });

        await stagehand.init();
        const page = stagehand.page;

        event.reply('status-update', '🌐 Navigating to Bing...');
        await page.goto("https://www.bing.com");

        event.reply('status-update', `🔍 Running: "${userPrompt}"`);
        
        await page.act({ 
            action: `Type '${userPrompt}' into the search bar and navigate to the destination.` 
        });

        event.reply('status-update', '🎉 Orbit task completed!');
        await new Promise(resolve => setTimeout(resolve, 5000));
        await stagehand.close();
        event.reply('status-update', 'Status: Idle');

    } catch (error) {
        event.reply('status-update', `❌ Error: ${error.message}`);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});