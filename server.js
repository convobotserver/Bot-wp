import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 5000;

app.use(express.json());
app.use(express.static(__dirname));

const BOTS_FILE = './data/bots.json';
const LOGS_FILE = './data/logs.json';
const MAX_LOGS  = 200;

function readBots() {
    try { return JSON.parse(fs.readFileSync(BOTS_FILE, 'utf8')); } catch { return []; }
}
function writeBots(bots) {
    fs.writeFileSync(BOTS_FILE, JSON.stringify(bots, null, 2));
}
function readLogs() {
    try { return JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8')); } catch { return []; }
}
function addLog(type, message) {
    const logs = readLogs();
    logs.push({ time: new Date().toISOString(), type, message });
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
    sseClients.forEach(res => {
        res.write(`data: ${JSON.stringify({ time: new Date().toISOString(), type, message })}\n\n`);
    });
}

const sseClients = new Set();

// SSE live logs
app.get('/api/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const logs = readLogs();
    logs.forEach(log => res.write(`data: ${JSON.stringify(log)}\n\n`));
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
});

// Get all bots
app.get('/api/bots', (req, res) => res.json(readBots()));

// Request pairing code
app.post('/api/pair', (req, res) => {
    const { number, adminNumber } = req.body;
    if (!number || number.length < 10)
        return res.status(400).json({ error: 'Invalid bot number' });
    if (!adminNumber || adminNumber.length < 10)
        return res.status(400).json({ error: 'Admin number is required to control the bot' });

    const bots = readBots();
    const existing = bots.find(b => b.number === number && b.status === 'connected');
    if (existing) return res.status(400).json({ error: 'Bot already connected with this number' });

    const code = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' +
                 Math.random().toString(36).substring(2, 6).toUpperCase();

    addLog('info',    `📱 Pairing code requested for bot +${number}`);
    addLog('info',    `👑 Admin number set: +${adminNumber}`);
    addLog('warn',    `⚠️  Real WhatsApp pairing needs baileys — deploy locally or on VPS`);
    addLog('info',    `🔑 Pairing code: ${code}`);

    res.json({ code, number, adminNumber });
});

// Confirm bot connected
app.post('/api/bots', (req, res) => {
    const { number, name, adminNumber } = req.body;
    if (!number)      return res.status(400).json({ error: 'Bot number required' });
    if (!adminNumber) return res.status(400).json({ error: 'Admin number required' });

    const bots = readBots();
    const existing = bots.findIndex(b => b.number === number);

    const bot = {
        id: Date.now().toString(),
        number,
        name:        name || `Bot +${number}`,
        adminNumber,
        status:      'connected',
        connectedAt: new Date().toISOString(),
        messages:    0
    };

    if (existing >= 0) {
        bots[existing] = { ...bots[existing], ...bot };
    } else {
        bots.push(bot);
    }

    writeBots(bots);
    addLog('success', `✅ Bot +${number} connected | Admin: +${adminNumber}`);
    res.json(bot);
});

// Update admin number for a bot
app.patch('/api/bots/:id/admin', (req, res) => {
    const { adminNumber } = req.body;
    if (!adminNumber || adminNumber.length < 10)
        return res.status(400).json({ error: 'Invalid admin number' });

    const bots = readBots();
    const idx  = bots.findIndex(b => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Bot not found' });

    const old = bots[idx].adminNumber;
    bots[idx].adminNumber = adminNumber;
    writeBots(bots);

    addLog('info', `👑 Admin changed for bot +${bots[idx].number}: +${old} → +${adminNumber}`);
    res.json({ success: true });
});

// Stop a bot
app.delete('/api/bots/:id', (req, res) => {
    const bots = readBots();
    const idx  = bots.findIndex(b => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Bot not found' });

    const bot = bots[idx];
    bots[idx].status    = 'stopped';
    bots[idx].stoppedAt = new Date().toISOString();
    writeBots(bots);

    addLog('warn', `🛑 Bot +${bot.number} stopped by admin +${bot.adminNumber || 'unknown'}`);
    res.json({ success: true });
});

// Remove a bot completely
app.delete('/api/bots/:id/remove', (req, res) => {
    let bots = readBots();
    const bot = bots.find(b => b.id === req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    bots = bots.filter(b => b.id !== req.params.id);
    writeBots(bots);

    addLog('info', `🗑️  Bot +${bot.number} removed`);
    res.json({ success: true });
});

// Get logs
app.get('/api/logs', (req, res) => res.json(readLogs()));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.htm')));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    addLog('info', `🚀 Admin panel started on port ${PORT}`);
});
