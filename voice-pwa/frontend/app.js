// --- Config ---
const WS_PROTOCOL = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTOCOL}//${location.host}/ws`;

// --- State ---
let ws = null;
let audioContext = null;
let mediaStream = null;
let processor = null;
let isRecording = false;

// --- DOM ---
const btnRecord   = document.getElementById('btn-record');
const btnConfirm  = document.getElementById('btn-confirm');
const statusEl    = document.getElementById('status');
const intentText  = document.getElementById('intent-text');
const intentArea  = document.getElementById('intent-area');
const replyEl     = document.getElementById('reply');

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

        if (msg.type === 'intent') {
            intentText.value = msg.text;
            updateConfirmState();
            setStatus('意図を検出しました');

        } else if (msg.type === 'voxclaw_reply') {
            replyEl.textContent = msg.text;
            setStatus('完了');

        } else if (msg.type === 'error') {
            setStatus(`エラー: ${msg.message}`);
        }
    });
}

connectWs();

// テキスト入力・編集で OK ボタンを制御
intentText.addEventListener('input', updateConfirmState);

// Ctrl/Cmd+Enter で送信
intentText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendIntent();
    }
});

function updateConfirmState() {
    const val = intentText.value;
    const hasText = val.trim().length > 0;
    console.log('[updateConfirmState] value=', JSON.stringify(val), 'hasText=', hasText);
    btnConfirm.disabled = !hasText;
    intentArea.classList.toggle('has-intent', hasText);
}

// --- Recording ---
btnRecord.addEventListener('click', async () => {
    if (isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
});

async function startRecording() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
        setStatus('マイクへのアクセスが拒否されました');
        return;
    }

    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(mediaStream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
        if (!isRecording || !ws || ws.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const pcm16 = float32ToPcm16(float32);
        ws.send(JSON.stringify({ type: 'audio', data: arrayBufferToBase64(pcm16.buffer) }));
    };

    isRecording = true;
    btnRecord.textContent = '■ 停止';
    btnRecord.classList.add('recording');
    setStatus('録音中...');
}

function stopRecording() {
    isRecording = false;
    btnRecord.textContent = '● 話す';
    btnRecord.classList.remove('recording');
    setStatus('処理中...');

    if (processor) { processor.disconnect(); processor = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'audio_end' }));
    }
}

// --- 送信 ---
btnConfirm.addEventListener('click', sendIntent);

function sendIntent() {
    const intent = intentText.value.trim();
    if (!intent || !ws || ws.readyState !== WebSocket.OPEN) return;
    setStatus('Voxclaw に送信中...');
    replyEl.textContent = '';
    ws.send(JSON.stringify({ type: 'confirm', intent }));
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
