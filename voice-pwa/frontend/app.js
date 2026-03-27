// --- Config ---
const WS_PROTOCOL = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTOCOL}//${location.host}/ws`;

// --- State ---
let ws = null;
let audioContext = null;
let mediaStream = null;
let processor = null;
let isRecording = false;
let typingMessageEl = null;

// --- DOM ---
const chatMessages  = document.getElementById('chat-messages');
const btnMic        = document.getElementById('btn-mic');
const inputText     = document.getElementById('input-text');
const btnSend       = document.getElementById('btn-send');

// --- PWA ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
}

// --- Tab switching ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    });
});

// --- WebSocket ---
function connectWs() {
    ws = new WebSocket(WS_URL);
    ws.addEventListener('open', () => console.log('[ws] connected'));
    ws.addEventListener('close', () => {
        console.log('[ws] disconnected, reconnecting...');
        setTimeout(connectWs, 3000);
    });
    ws.addEventListener('error', () => console.error('[ws] error'));
    ws.addEventListener('message', (e) => {
        const msg = JSON.parse(e.data);

        if (msg.type === 'intent') {
            inputText.value = msg.text;
            updateSendState();

        } else if (msg.type === 'voxclaw_reply') {
            removeTyping();
            appendMessage('voxclaw', msg.text);

        } else if (msg.type === 'error') {
            removeTyping();
            appendMessage('voxclaw', `⚠️ ${msg.message}`);
        }
    });
}

connectWs();

// --- Input auto-resize & send button state ---
inputText.addEventListener('input', () => {
    inputText.style.height = 'auto';
    inputText.style.height = inputText.scrollHeight + 'px';
    updateSendState();
});

inputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

function updateSendState() {
    const hasText = inputText.value.trim().length > 0;
    btnSend.classList.toggle('has-text', hasText);
}

// --- Mic ---
btnMic.addEventListener('click', async () => {
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
        appendMessage('voxclaw', '⚠️ マイクへのアクセスが拒否されました');
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
    btnMic.classList.add('recording');
    inputText.value = '';
    updateSendState();
}

function stopRecording() {
    isRecording = false;
    btnMic.classList.remove('recording');

    if (processor) { processor.disconnect(); processor = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'audio_end' }));
    }
}

// --- Send ---
btnSend.addEventListener('click', sendMessage);

function sendMessage() {
    const text = inputText.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

    appendMessage('user', text);
    inputText.value = '';
    inputText.style.height = 'auto';
    updateSendState();
    showTyping();

    ws.send(JSON.stringify({ type: 'confirm', intent: text }));
}

// --- Chat rendering ---
function appendMessage(role, text) {
    const name = role === 'user' ? 'User' : 'Voxclaw';
    const time = formatTime(new Date());

    const el = document.createElement('div');
    el.className = `message ${role}`;
    el.innerHTML = `
        <div class="message-header">
            <span class="message-dot"></span>
            <span class="message-name">${name}</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-body">${escapeHtml(text)}</div>
    `;
    chatMessages.appendChild(el);
    scrollToBottom();
    return el;
}

function showTyping() {
    const time = formatTime(new Date());
    typingMessageEl = document.createElement('div');
    typingMessageEl.className = 'message voxclaw';
    typingMessageEl.innerHTML = `
        <div class="message-header">
            <span class="message-dot"></span>
            <span class="message-name">Voxclaw</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="typing-dots">
            <span></span><span></span><span></span>
        </div>
    `;
    chatMessages.appendChild(typingMessageEl);
    scrollToBottom();
}

function removeTyping() {
    if (typingMessageEl) {
        typingMessageEl.remove();
        typingMessageEl = null;
    }
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// --- Helpers ---
function formatTime(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${d} ${hh}:${mm}`;
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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
