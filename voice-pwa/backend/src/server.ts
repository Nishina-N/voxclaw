import * as dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { createAudioSession, type AudioSession } from './gemini.js';
import { sendToGemiclaw } from './gemiclaw-client.js';

dotenv.config();

const PORT = parseInt(process.env.VOICE_BACKEND_PORT ?? '8080', 10);

// Message types (frontend ↔ backend protocol)
// Client → Server:
//   { type: 'audio', data: '<base64 PCM16 16kHz mono>' }
//   { type: 'end' }
// Server → Client:
//   { type: 'transcript', text: '...' }   ← what Gemini heard
//   { type: 'reply', text: '...' }         ← Gemiclaw's response
//   { type: 'error', message: '...' }

interface AudioMsg { type: 'audio'; data: string; }
interface EndMsg   { type: 'end'; }
type ClientMsg = AudioMsg | EndMsg;

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
    console.log('[ws] client connected');
    let session: AudioSession | null = null;
    let sessionCreating: Promise<AudioSession> | null = null;

    async function getOrCreateSession(): Promise<AudioSession> {
        if (session) return session;
        if (!sessionCreating) {
            sessionCreating = createAudioSession()
                .then(s => { session = s; return s; })
                .catch(err => { sessionCreating = null; throw err; });
        }
        return sessionCreating;
    }

    ws.on('message', async (raw) => {
        let msg: ClientMsg;
        try {
            msg = JSON.parse(raw.toString()) as ClientMsg;
        } catch {
            ws.send(JSON.stringify({ type: 'error', message: 'invalid JSON' }));
            return;
        }

        if (msg.type === 'audio') {
            let s: AudioSession;
            try {
                s = await getOrCreateSession();
            } catch (err: any) {
                console.error('[gemini] session create error:', err);
                ws.send(JSON.stringify({ type: 'error', message: 'failed to start audio session' }));
                return;
            }
            const pcm = Buffer.from(msg.data, 'base64');
            s.sendAudio(pcm);

        } else if (msg.type === 'end') {
            if (!session && !sessionCreating) {
                ws.send(JSON.stringify({ type: 'error', message: 'no active session' }));
                return;
            }

            try {
                const s = session ?? await sessionCreating!;
                session = null;
                sessionCreating = null;
                const transcript = await s.end();

                console.log('[gemini] transcript:', transcript);
                ws.send(JSON.stringify({ type: 'transcript', text: transcript }));

                const reply = await sendToGemiclaw(transcript);
                console.log('[gemiclaw] reply:', reply);
                ws.send(JSON.stringify({ type: 'reply', text: reply }));
            } catch (err: any) {
                console.error('[end] error:', err);
                ws.send(JSON.stringify({ type: 'error', message: err.message ?? 'unknown error' }));
            }
        }
    });

    ws.on('close', () => {
        console.log('[ws] client disconnected');
        session = null;
    });
});

server.listen(PORT, () => {
    console.log(`[voice-pwa-backend] listening on port ${PORT}`);
});
