import * as dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { createLiveSession, type GeminiLiveSession } from './gemini.js';
import { sendToVoxclaw } from './voxclaw-client.js';

dotenv.config();

const PORT = parseInt(process.env.VOICE_BACKEND_PORT ?? '8080', 10);

// Message types (frontend ↔ backend protocol)
// Client → Server:
//   { type: 'audio', data: '<base64 PCM16 16kHz mono>' }  ← streaming audio chunks
//   { type: 'audio_end' }                                  ← user stopped speaking
//   { type: 'confirm', intent: '...' }                     ← user pressed OK
// Server → Client:
//   { type: 'intent', text: '...' }      ← real-time intent from Gemini
//   { type: 'voxclaw_reply', text: '...' } ← after confirm
//   { type: 'error', message: '...' }

const server = createServer();
const wss = new WebSocketServer({ server });

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
