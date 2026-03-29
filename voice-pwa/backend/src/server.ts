import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import jwt from 'jsonwebtoken';
import { createLiveSession, type GeminiLiveSession } from './gemini.js';
import { sendToVoxclaw } from './voxclaw-client.js';

dotenv.config();

const PORT = parseInt(process.env.VOICE_BACKEND_PORT ?? '8080', 10);
const PASSWORD = process.env.PWA_PASSWORD ?? '123456';
const JWT_SECRET = process.env.JWT_SECRET ?? PASSWORD;
const JWT_EXPIRES_IN = '7d';
const KEYBINDER_URL = 'http://keybinder:3001';
const CRON_PATH = '/app/config/cron.json';
const MEDIA_DIR = '/app/media';

const MIME_TYPES: Record<string, string> = {
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png':  'image/png',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.svg':  'image/svg+xml',
};

function readCron(): any[] {
    if (!fs.existsSync(CRON_PATH)) return [];
    try { return JSON.parse(fs.readFileSync(CRON_PATH, 'utf-8')); } catch { return []; }
}

function writeCron(entries: any[]) {
    fs.mkdirSync(path.dirname(CRON_PATH), { recursive: true });
    fs.writeFileSync(CRON_PATH, JSON.stringify(entries, null, 2));
}

// Message types (frontend ↔ backend protocol)
// Client → Server:
//   { type: 'audio', data: '<base64 PCM16 16kHz mono>' }  ← streaming audio chunks
//   { type: 'audio_end' }                                  ← user stopped speaking
//   { type: 'confirm', intent: '...' }                     ← user pressed OK
// Server → Client:
//   { type: 'intent', text: '...' }        ← real-time intent from Gemini
//   { type: 'voxclaw_reply', text: '...' } ← after confirm
//   { type: 'error', message: '...' }

// ── JWT helpers ───────────────────────────────────────────────────────────────

function signToken(): string {
    return jwt.sign({}, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token: string): boolean {
    try {
        jwt.verify(token, JWT_SECRET);
        return true;
    } catch {
        return false;
    }
}

function getTokenFromRequest(req: IncomingMessage): string | null {
    const url = new URL(req.url ?? '', `http://localhost`);
    return url.searchParams.get('token');
}

function verifyAuthHeader(req: IncomingMessage): boolean {
    const auth = req.headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    return token ? verifyToken(token) : false;
}

async function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    handleRequest(req, res).catch(err => {
        console.error('[server] unhandled error:', err);
        if (!res.headersSent) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'internal server error' }));
        }
    });
});

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // ── /api/skills (JWT required) ───────────────────────────────────────────
    if (req.method === 'GET' && req.url === '/api/skills') {
        if (!verifyAuthHeader(req)) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        const readFrontmatter = (content: string): { name?: string; description?: string } => {
            const m = content.match(/^---\n([\s\S]*?)\n---/);
            if (!m) return {};
            const result: Record<string, string> = {};
            for (const line of m[1].split('\n')) {
                const [k, ...v] = line.split(':');
                if (k && v.length) result[k.trim()] = v.join(':').trim();
            }
            return result;
        };

        const SKILLS_DIR    = '/app/skills';
        const FUNCTIONS_DIR = '/app/functions';

        const skills = fs.existsSync(SKILLS_DIR)
            ? fs.readdirSync(SKILLS_DIR)
                .filter(f => f.endsWith('.md'))
                .map(f => {
                    const content = fs.readFileSync(path.join(SKILLS_DIR, f), 'utf-8');
                    const fm = readFrontmatter(content);
                    return {
                        name:        fm.name        ?? path.basename(f, '.md'),
                        description: fm.description ?? '',
                    };
                })
                .sort((a, b) => a.name.localeCompare(b.name))
            : [];

        const functions = fs.existsSync(FUNCTIONS_DIR)
            ? fs.readdirSync(FUNCTIONS_DIR)
                .filter(f => fs.existsSync(path.join(FUNCTIONS_DIR, f, 'definition.json')))
                .map(f => {
                    const def = JSON.parse(fs.readFileSync(path.join(FUNCTIONS_DIR, f, 'definition.json'), 'utf-8'));
                    return {
                        name:        def.name        ?? f,
                        description: def.description ?? '',
                    };
                })
                .sort((a, b) => a.name.localeCompare(b.name))
            : [];

        res.writeHead(200);
        res.end(JSON.stringify({ skills, functions }));
        return;
    }

    // ── /api/chat/history (JWT required) → voxclaw /api/history ─────────────
    if (req.method === 'GET' && req.url?.startsWith('/api/chat/history')) {
        if (!verifyAuthHeader(req)) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }
        const url = new URL(req.url, 'http://localhost');
        const limit = url.searchParams.get('limit') ?? '50';
        const r = await fetch(`${process.env.VOXCLAW_API_URL}/api/history?channelId=voice&limit=${limit}`);
        res.writeHead(r.status);
        res.end(await r.text());
        return;
    }

    // ── /api/cron (JWT required) ─────────────────────────────────────────────
    if (req.url === '/api/cron' || req.url?.startsWith('/api/cron/')) {
        if (!verifyAuthHeader(req)) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }
        if (req.method === 'GET' && req.url === '/api/cron') {
            res.writeHead(200);
            res.end(JSON.stringify(readCron()));
            return;
        }
        if (req.method === 'POST' && req.url === '/api/cron') {
            const entry = JSON.parse(await readBody(req));
            const entries = readCron();
            const idx = entries.findIndex((e: any) => e.id === entry.id);
            if (idx >= 0) entries[idx] = entry;
            else entries.push(entry);
            writeCron(entries);
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        if (req.method === 'DELETE' && req.url?.startsWith('/api/cron/')) {
            const id = decodeURIComponent(req.url.slice('/api/cron/'.length));
            writeCron(readCron().filter((e: any) => e.id !== id));
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
            return;
        }
    }

    // ── /api/google-auth/ (JWT required) → keybinder /auth/google/ ──────────
    if (req.url?.startsWith('/api/google-auth/')) {
        if (!verifyAuthHeader(req)) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }
        const keybinderPath = req.url.replace('/api/google-auth/', '/auth/google/');
        if (req.method === 'GET') {
            const r = await fetch(`${KEYBINDER_URL}${keybinderPath}`);
            res.writeHead(r.status);
            res.end(await r.text());
            return;
        }
        if (req.method === 'POST') {
            const body = await readBody(req);
            const r = await fetch(`${KEYBINDER_URL}${keybinderPath}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
            res.writeHead(r.status);
            res.end(await r.text());
            return;
        }
    }

    // ── /api/keys (JWT required) ──────────────────────────────────────────────
    if (req.url?.startsWith('/api/keys')) {
        if (!verifyAuthHeader(req)) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }
        if (req.method === 'GET') {
            const r = await fetch(`${KEYBINDER_URL}/keys`);
            res.writeHead(r.status);
            res.end(await r.text());
            return;
        }
        if (req.method === 'POST') {
            const body = await readBody(req);
            const r = await fetch(`${KEYBINDER_URL}/keys`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
            res.writeHead(r.status);
            res.end(await r.text());
            return;
        }
    }

    if (req.method === 'POST' && req.url === '/auth/login') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { password } = JSON.parse(body);
                if (password === PASSWORD) {
                    res.writeHead(200);
                    res.end(JSON.stringify({ token: signToken() }));
                } else {
                    res.writeHead(401);
                    res.end(JSON.stringify({ error: 'Incorrect password' }));
                }
            } catch {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'invalid request' }));
            }
        });
        return;
    }

    // ── /api/tasks/* (JWT required) → voxclaw /api/tasks/* ──────────────────
    if (req.url?.startsWith('/api/tasks')) {
        if (!verifyAuthHeader(req)) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }
        const voxclawUrl = `${process.env.VOXCLAW_API_URL}${req.url}`;
        if (req.method === 'GET') {
            const r = await fetch(voxclawUrl);
            res.writeHead(r.status, { 'Content-Type': 'application/json' });
            res.end(await r.text());
            return;
        }
        if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
            const body = await readBody(req);
            const r = await fetch(voxclawUrl, {
                method: req.method,
                headers: { 'Content-Type': 'application/json' },
                body: body || undefined,
            });
            res.writeHead(r.status, { 'Content-Type': 'application/json' });
            res.end(await r.text());
            return;
        }
    }

    // ── /api/media/:filename (JWT required) ──────────────────────────────────
    if (req.method === 'GET' && req.url?.startsWith('/api/media/')) {
        if (!verifyAuthHeader(req)) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }
        const filename = decodeURIComponent(req.url.slice('/api/media/'.length));
        // Prevent path traversal
        if (filename.includes('/') || filename.includes('..')) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid filename' }));
            return;
        }
        const filePath = path.join(MEDIA_DIR, filename);
        if (!fs.existsSync(filePath)) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }
        const ext = path.extname(filename).toLowerCase();
        const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.writeHead(200);
        fs.createReadStream(filePath).pipe(res);
        return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
}

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
    const token = getTokenFromRequest(req);
    if (!token || !verifyToken(token)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
    });
});

wss.on('connection', (ws: WebSocket) => {
    console.log('[ws] client connected');

    let geminiSession: GeminiLiveSession | null = null;
    let sessionCreating: Promise<GeminiLiveSession> | null = null;

    async function getOrCreateSession(): Promise<GeminiLiveSession> {
        if (geminiSession) return geminiSession;
        if (!sessionCreating) {
            sessionCreating = createLiveSession((intent) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'intent', text: intent }));
                }
            }).then(s => {
                geminiSession = s;
                return s;
            }).catch(err => {
                sessionCreating = null;
                throw err;
            });
        }
        return sessionCreating;
    }

    ws.on('message', async (raw) => {
        let msg: any;
        try {
            msg = JSON.parse(raw.toString());
        } catch {
            ws.send(JSON.stringify({ type: 'error', message: 'invalid JSON' }));
            return;
        }

        if (msg.type === 'audio') {
            try {
                const s = await getOrCreateSession();
                s.sendAudio(Buffer.from(msg.data, 'base64'));
            } catch (err: any) {
                console.error('[gemini] session create error:', err);
                ws.send(JSON.stringify({ type: 'error', message: 'failed to start audio session' }));
            }

        } else if (msg.type === 'audio_end') {
            const s = geminiSession ?? (sessionCreating ? await sessionCreating.catch(() => null) : null);
            s?.endTurn();

        } else if (msg.type === 'confirm') {
            const intent: string = msg.intent;
            if (!intent) return;
            console.log('[confirm] sending to voxclaw:', intent);
            try {
                const reply = await sendToVoxclaw(intent);
                console.log('[voxclaw] reply:', reply);
                ws.send(JSON.stringify({ type: 'voxclaw_reply', text: reply }));
            } catch (err: any) {
                console.error('[confirm] voxclaw error:', err);
                ws.send(JSON.stringify({ type: 'error', message: err.message ?? 'voxclaw error' }));
            }
        }
    });

    ws.on('close', () => {
        console.log('[ws] client disconnected');
        geminiSession?.close();
        geminiSession = null;
    });
});

server.listen(PORT, () => {
    console.log(`[voice-pwa-backend] listening on port ${PORT}`);
});
