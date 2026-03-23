// --- Config ---
const WS_PROTOCOL = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTOCOL}//${location.host}/ws`;

// --- State ---
let ws = null;
let mediaRecorder = null;
let isRecording = false;

// --- DOM ---
const btnRecord  = document.getElementById('btn-record');
const statusEl   = document.getElementById('status');
const transcript = document.getElementById('transcript');
const reply      = document.getElementById('reply');

// --- PWA ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
}

// --- WebSocket ---
function connectWs() {
    ws = new WebSocket(WS_URL);

    ws.addEventListener('open', () => setStatus('接続済み'));
    ws.addEventListener('close', () => {
        setStatus('切断。再接続中...');
        setTimeout(connectWs, 3000);
    });
    ws.addEventListener('error', () => setStatus('接続エラー'));
    ws.addEventListener('message', (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'transcript') {
            transcript.textContent = msg.text;
            setStatus('Gemiclaw に送信中...');
        } else if (msg.type === 'reply') {
            reply.textContent = msg.text;
            setStatus('完了');
        } else if (msg.type === 'error') {
            setStatus(`エラー: ${msg.message}`);
        }
    });
}

connectWs();

// --- Recording ---
btnRecord.addEventListener('click', async () => {
    if (isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
});

async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Resample to 16kHz mono PCM16 via AudioContext
    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(ctx.destination);

    processor.onaudioprocess = (e) => {
        if (!isRecording) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const pcm16 = float32ToPcm16(float32);
        const b64 = arrayBufferToBase64(pcm16.buffer);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'audio', data: b64 }));
        }
    };

    isRecording = true;
    btnRecord.textContent = '■ 停止';
    btnRecord.classList.add('recording');
    setStatus('録音中...');
    transcript.textContent = '';
    reply.textContent = '';

    // Store refs for cleanup
    btnRecord._cleanup = () => {
        processor.disconnect();
        source.disconnect();
        ctx.close();
        stream.getTracks().forEach((t) => t.stop());
    };
}

function stopRecording() {
    isRecording = false;
    btnRecord.textContent = '● 話す';
    btnRecord.classList.remove('recording');
    setStatus('処理中...');

    if (btnRecord._cleanup) {
        btnRecord._cleanup();
        btnRecord._cleanup = null;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'end' }));
    }
}

// --- Helpers ---
function setStatus(msg) {
    statusEl.textContent = msg;
}

function float32ToPcm16(float32) {
    const pcm = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm;
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
}
