import * as dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { createLiveSession, type GeminiLiveSession } from './gemini.js';
import { sendToVoxclaw } from './voxclaw-client.js';

dotenv.config();

const PORT = parseInt(process.env.VOICE_BACKEND_PORT ?? '8080', 10);
const PASSWORD = process.env.PWA_PASSWORD ?? '123456';
const JWT_SECRET = process.env.JWT_SECRET ?? PASSWORD;
const JWT_EXPIRES_IN = '7d';
const KEYBINDER_URL = 'http://keybinder:3001';

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

const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
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
                    res.end(JSON.stringify({ error: 'パスワードが違います' }));
                }
            } catch {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'invalid request' }));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
});

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
