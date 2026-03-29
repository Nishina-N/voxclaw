// --- Config ---
const WS_PROTOCOL = location.protocol === 'https:' ? 'wss:' : 'ws:';
const TOKEN_KEY = 'voxclaw_token';

// --- Auth ---
const loginScreen   = document.getElementById('login-screen');
const loginPassword = document.getElementById('login-password');
const loginBtn      = document.getElementById('login-btn');
const loginError    = document.getElementById('login-error');

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

function wsUrl() {
    const token = getToken();
    return `${WS_PROTOCOL}//${location.host}/ws?token=${token}`;
}

async function tryLogin(password) {
    loginError.textContent = '';
    try {
        const res = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (res.ok) {
            setToken(data.token);
            loginScreen.classList.add('hidden');
            connectWs();
        } else {
            loginError.textContent = data.error ?? 'Login failed';
        }
    } catch {
        loginError.textContent = 'Connection error';
    }
}

loginBtn.addEventListener('click', () => tryLogin(loginPassword.value));
loginPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryLogin(loginPassword.value);
});

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

// 起動時：トークンがあればそのまま接続、なければログイン画面を表示
if (getToken()) {
    loginScreen.classList.add('hidden');
    connectWs();
}

// bfcache復元時（戻る/進む）: WSが死んでいるので再接続
window.addEventListener('pageshow', (e) => {
    if (e.persisted) connectWs();
});

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
        if (btn.dataset.tab === 'settings') { loadKeys(); loadGoogleStatus(); }
        if (btn.dataset.tab === 'skills') loadSkills();
        if (btn.dataset.tab === 'cron') loadCronTab();
    });
});

// --- WebSocket ---
function connectWs() {
    if (!getToken()) return;
    if (ws) {
        ws.onclose = null; // 再接続ループを防ぐ
        ws.close();
        ws = null;
    }
    ws = new WebSocket(wsUrl());
    ws.addEventListener('open', () => console.log('[ws] connected'));
    ws.addEventListener('close', (e) => {
        if (e.code === 1006 || e.code === 4001) {
            // 認証エラー：トークン削除してログイン画面へ
            clearToken();
            loginScreen.classList.remove('hidden');
            return;
        }
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

// --- Input auto-resize & send button state ---
inputText.addEventListener('input', () => {
    inputText.style.height = 'auto';
    inputText.style.height = inputText.scrollHeight + 'px';
    updateSendState();
});

inputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
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
        appendMessage('voxclaw', '⚠️ Microphone access denied');
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

// --- Skills ---
async function loadSkills() {
    const header = document.getElementById('skills-header');
    const list   = document.getElementById('skills-list');
    try {
        const res = await apiRequest('/api/skills');
        if (!res.ok) { list.innerHTML = '<p style="color:#aaa;text-align:center;padding:20px">Failed to load</p>'; return; }
        const { skills, functions } = await res.json();

        header.textContent = `${skills.length} Skill${skills.length !== 1 ? 's' : ''} / ${functions.length} Function${functions.length !== 1 ? 's' : ''}`;

        list.innerHTML = '';
        renderSkillSection(list, 'Skills', skills);
        renderSkillSection(list, 'Functions', functions);
    } catch {
        list.innerHTML = '<p style="color:#aaa;text-align:center;padding:20px">Failed to load</p>';
    }
}

function renderSkillSection(container, title, items) {
    if (!items.length) return;
    const heading = document.createElement('p');
    heading.className = 'skills-section-title';
    heading.textContent = title;
    container.appendChild(heading);

    for (const item of items) {
        const el = document.createElement('div');
        el.className = 'skill-item';
        el.innerHTML = `
            <div class="skill-item-header">
                <span class="skill-item-name">${escapeHtml(item.name)}</span>
                <span class="skill-item-chevron">▾</span>
            </div>
            ${item.description ? `<div class="skill-item-body">${escapeHtml(item.description)}</div>` : ''}
        `;
        if (item.description) {
            el.querySelector('.skill-item-header').addEventListener('click', () => {
                el.classList.toggle('open');
            });
        } else {
            el.querySelector('.skill-item-chevron').style.visibility = 'hidden';
        }
        container.appendChild(el);
    }
}

// --- Settings ---
async function apiRequest(path, options = {}) {
    return fetch(path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getToken()}`,
            ...(options.headers ?? {}),
        },
    });
}

async function loadGoogleStatus() {
    const el = document.getElementById('google-auth-status');
    if (!el) return;
    try {
        const res = await apiRequest('/api/google-auth/status');
        if (!res.ok) { el.textContent = 'Failed to load'; return; }
        const data = await res.json();
        if (!data.configured) {
            el.textContent = 'not set';
        } else if (data.expired) {
            el.textContent = 'expired';
            el.style.color = '#e55';
        } else {
            const exp = new Date(data.expiry);
            el.textContent = `valid until ${exp.getFullYear()}/${exp.getMonth()+1}/${exp.getDate()}`;
            el.style.color = '#4a4';
        }
    } catch { el.textContent = 'Failed to load'; }
}

// Google OAuth コールバック: ?code= が URL に含まれる場合は自動でトークン交換
(async () => {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (!code || !getToken()) return;
    // URLを綺麗にする
    history.replaceState({}, '', location.pathname);
    try {
        const res = await apiRequest('/api/google-auth/exchange', {
            method: 'POST',
            body: JSON.stringify({ code }),
        });
        if (res.ok) {
            appendMessage('voxclaw', 'Google authentication complete!');
        } else {
            const err = await res.json();
            appendMessage('voxclaw', `⚠️ Google authentication failed: ${err.error}`);
        }
    } catch {
        appendMessage('voxclaw', '⚠️ Error during Google authentication');
    }
})();

async function loadKeys() {
    try {
        const res = await apiRequest('/api/keys');
        if (!res.ok) return;
        const data = await res.json();
        document.querySelectorAll('.key-item').forEach(item => {
            const service = item.dataset.service;
            const key = item.dataset.key;
            const value = data[service]?.[key];
            item.querySelector('.key-item-value').textContent = value ?? 'not set';
        });
    } catch {}
}

document.querySelectorAll('.key-item').forEach(item => {
    const editBtn   = item.querySelector('.key-edit-btn');
    const editArea  = item.querySelector('.key-edit-area');
    const input     = item.querySelector('.key-edit-input');
    const saveBtn   = item.querySelector('.key-save-btn');
    const cancelBtn = item.querySelector('.key-cancel-btn');

    editBtn.addEventListener('click', () => {
        editArea.classList.add('open');
        input.value = '';
        input.focus();
    });

    cancelBtn.addEventListener('click', () => {
        editArea.classList.remove('open');
    });

    saveBtn.addEventListener('click', async () => {
        const value = input.value.trim();
        if (!value) return;
        saveBtn.textContent = 'Saving...';
        saveBtn.disabled = true;
        try {
            const res = await apiRequest('/api/keys', {
                method: 'POST',
                body: JSON.stringify({ service: item.dataset.service, key: item.dataset.key, value }),
            });
            if (res.ok) {
                editArea.classList.remove('open');
                await loadKeys();
            }
        } finally {
            saveBtn.textContent = 'Save';
            saveBtn.disabled = false;
        }
    });
});

// --- Cron ---
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function skillToId(name) {
    return 'cron_' + name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function parseCronSchedule(expr) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [mm, hh, , , dow] = parts;
    const minute = parseInt(mm, 10);
    const hour   = parseInt(hh, 10);
    if (dow === '*')   return { hour, minute, mode: 'daily',    days: [] };
    if (dow === '1-5') return { hour, minute, mode: 'weekdays', days: [] };
    return { hour, minute, mode: 'custom', days: dow.split(',').map(Number) };
}

function cronLabel(entry) {
    if (!entry) return 'not scheduled';
    const s = parseCronSchedule(entry.cron);
    if (!s) return entry.cron;
    const t = `${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')}`;
    if (!entry.enabled) return `off (${t})`;
    if (s.mode === 'daily')    return `Daily ${t}`;
    if (s.mode === 'weekdays') return `Weekdays ${t}`;
    return s.days.map(d => DAY_LABELS[d]).join('/') + ' ' + t;
}

function buildCronExpr(hour, minute, mode, customDays) {
    if (mode === 'daily')    return `${minute} ${hour} * * *`;
    if (mode === 'weekdays') return `${minute} ${hour} * * 1-5`;
    const dow = (customDays.length ? customDays : [0]).sort((a,b) => a-b).join(',');
    return `${minute} ${hour} * * ${dow}`;
}

async function loadCronTab() {
    const list = document.getElementById('cron-list');
    list.innerHTML = '';
    try {
        const [skillsRes, cronRes] = await Promise.all([
            apiRequest('/api/skills'),
            apiRequest('/api/cron'),
        ]);
        if (!skillsRes.ok || !cronRes.ok) throw new Error();
        const { skills } = await skillsRes.json();
        const entries = await cronRes.json();

        const heading = document.createElement('p');
        heading.className = 'skills-section-title';
        heading.textContent = 'Skills';
        list.appendChild(heading);

        for (const skill of skills) {
            const entry = entries.find(e => e.id === skillToId(skill.name)) ?? null;
            list.appendChild(renderCronItem(skill, entry));
        }
    } catch {
        list.innerHTML = '<p style="color:#aaa;text-align:center;padding:20px">Failed to load</p>';
    }
}

function renderCronItem(skill, entry) {
    const id = skillToId(skill.name);
    const s = entry ? (parseCronSchedule(entry.cron) ?? { hour: 9, minute: 0, mode: 'daily', days: [] })
                    : { hour: 9, minute: 0, mode: 'daily', days: [] };

    const el = document.createElement('div');
    el.className = 'skill-item';

    const statusClass = entry ? 'cron-item-status scheduled' : 'cron-item-status';
    el.innerHTML = `
        <div class="skill-item-header">
            <span class="skill-item-name">${escapeHtml(skill.name)}</span>
            <span class="${statusClass}">${escapeHtml(cronLabel(entry))}</span>
            <span class="skill-item-chevron">▾</span>
        </div>
        <div class="skill-item-body cron-form">
            <span class="cron-field-label">Time</span>
            <div class="cron-time-row">
                <input class="cron-time-input cron-hour" type="number" min="0" max="23"
                    value="${s.hour}" />
                <span>:</span>
                <input class="cron-time-input cron-minute" type="number" min="0" max="59"
                    value="${String(s.minute).padStart(2,'0')}" />
            </div>
            <span class="cron-field-label">Repeat</span>
            <div class="cron-repeat-row">
                <label><input type="radio" name="rep_${id}" value="daily"    ${s.mode==='daily'?'checked':''}> Every day</label>
                <label><input type="radio" name="rep_${id}" value="weekdays" ${s.mode==='weekdays'?'checked':''}> Weekdays</label>
                <label><input type="radio" name="rep_${id}" value="custom"   ${s.mode==='custom'?'checked':''}> Custom</label>
            </div>
            <div class="cron-days-row" style="display:${s.mode==='custom'?'flex':'none'}">
                ${DAY_LABELS.map((d,i) => `<label class="cron-day-label"><input type="checkbox" value="${i}" ${s.days.includes(i)?'checked':''}> ${d}</label>`).join('')}
            </div>
            <span class="cron-field-label">Channel ID</span>
            <input class="cron-channel-input" type="text" placeholder="Discord channel ID"
                value="${escapeHtml(entry?.channelId ?? '')}" />
            <div class="cron-enabled-row">
                <span class="cron-field-label">Enabled</span>
                <label class="cron-toggle">
                    <input type="checkbox" class="cron-enabled-check" ${(entry?.enabled ?? true)?'checked':''}>
                    <span class="cron-toggle-slider"></span>
                </label>
            </div>
            <div class="cron-actions">
                <button class="cron-save-btn">Save</button>
                ${entry ? '<button class="cron-delete-btn">Delete</button>' : ''}
            </div>
        </div>
    `;

    // Accordion
    el.querySelector('.skill-item-header').addEventListener('click', () => el.classList.toggle('open'));

    // Show/hide custom days
    el.querySelectorAll(`input[name="rep_${id}"]`).forEach(r => {
        r.addEventListener('change', () => {
            el.querySelector('.cron-days-row').style.display = r.value === 'custom' ? 'flex' : 'none';
        });
    });

    // Save
    el.querySelector('.cron-save-btn').addEventListener('click', async () => {
        const hour    = Math.min(23, Math.max(0, parseInt(el.querySelector('.cron-hour').value, 10) || 0));
        const minute  = Math.min(59, Math.max(0, parseInt(el.querySelector('.cron-minute').value, 10) || 0));
        const mode    = el.querySelector(`input[name="rep_${id}"]:checked`).value;
        const days    = mode === 'custom'
            ? [...el.querySelectorAll('.cron-days-row input:checked')].map(c => parseInt(c.value, 10))
            : [];
        const channel = el.querySelector('.cron-channel-input').value.trim();
        const enabled = el.querySelector('.cron-enabled-check').checked;
        if (!channel) { alert('Channel ID is required'); return; }

        const btn = el.querySelector('.cron-save-btn');
        btn.textContent = 'Saving...'; btn.disabled = true;
        try {
            const res = await apiRequest('/api/cron', {
                method: 'POST',
                body: JSON.stringify({
                    id,
                    cron: buildCronExpr(hour, minute, mode, days),
                    prompt: `[Scheduled task] Execute the '${skill.name}' skill now. This is an automated run — complete the skill from /app/config/skills/ in full, independent of any prior conversation.`,
                    channelId: channel,
                    enabled,
                }),
            });
            if (res.ok) loadCronTab();
        } finally { btn.textContent = 'Save'; btn.disabled = false; }
    });

    // Delete
    const delBtn = el.querySelector('.cron-delete-btn');
    if (delBtn) {
        delBtn.addEventListener('click', async () => {
            delBtn.textContent = 'Deleting...'; delBtn.disabled = true;
            try {
                await apiRequest(`/api/cron/${encodeURIComponent(id)}`, { method: 'DELETE' });
                loadCronTab();
            } finally { delBtn.textContent = 'Delete'; delBtn.disabled = false; }
        });
    }

    return el;
}
