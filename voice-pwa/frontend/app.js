// --- Config ---
const WS_PROTOCOL = location.protocol === 'https:' ? 'wss:' : 'ws:';
const TOKEN_KEY = 'voxclaw_token';
const INTENT_MODE_KEY = 'voxclaw_intent_mode';
const SPEECH_LANG_KEY = 'voxclaw_speech_lang';
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UI_LANG_KEY = 'voxclaw_ui_lang';
const FONT_SIZE_KEY = 'voxclaw_font_size';
const HISTORY_PAGE = 30;

// --- i18n ---
const STRINGS = {
    en: {
        voice_input_section:   'Voice Input',
        intent_mode_label:     'Recognition Mode',
        intent_mode_standard:  'Standard',
        intent_mode_faithful:  'Faithful',
        intent_mode_desc:      '<b>Standard</b>: Gemini extracts an intent summary<br><b>Faithful</b>: Preserves conditions, negations, and context verbatim.',
        input_lang_label:      'Input Language',
        input_lang_auto:       'Auto detect',
        input_lang_note:       'Specifying a language may improve recognition accuracy.',
        display_section:       'Display',
        font_size_label:       'Font Size',
        lang_label:            'Language',
        mic_denied:            '⚠️ Microphone access denied',
        google_auth_ok:        'Google authentication complete!',
        google_auth_fail:      '⚠️ Google authentication failed: ',
        google_auth_error:     '⚠️ Error during Google authentication',
        tasks_loading:         'Loading…',
        tasks_empty:           'No tasks yet',
        tasks_failed:          'Failed to load',
    },
    ja: {
        voice_input_section:   '音声入力',
        intent_mode_label:     '音声認識モード',
        intent_mode_standard:  '標準',
        intent_mode_faithful:  '発話忠実',
        intent_mode_desc:      '<b>標準</b>: Geminiが意図を要約して抽出<br><b>発話忠実</b>: 条件・否定・背景をそのまま保持。文字起こしベース。',
        input_lang_label:      '入力言語',
        input_lang_auto:       '自動検出',
        input_lang_note:       '「自動検出」以外を選ぶと認識精度が向上することがあります。',
        display_section:       'Display',
        font_size_label:       '文字サイズ',
        lang_label:            '言語 / Language',
        mic_denied:            '⚠️ マイクへのアクセスが拒否されました',
        google_auth_ok:        'Google認証が完了しました！',
        google_auth_fail:      '⚠️ Google認証に失敗しました: ',
        google_auth_error:     '⚠️ Google認証中にエラーが発生しました',
        tasks_loading:         '読み込み中…',
        tasks_empty:           'タスクはまだありません',
        tasks_failed:          '読み込みに失敗しました',
    },
};

function getUiLang() { return localStorage.getItem(UI_LANG_KEY) ?? 'ja'; }
function setUiLang(l) { localStorage.setItem(UI_LANG_KEY, l); }
function t(key) { return STRINGS[getUiLang()]?.[key] ?? STRINGS.en[key] ?? key; }

function applyLang() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (el.dataset.i18nHtml) {
            el.innerHTML = t(key);
        } else {
            el.textContent = t(key);
        }
    });
    // Update dynamic labels that depend on stored state
    const modeLabel = document.getElementById('intent-mode-label');
    if (modeLabel) {
        const mode = getIntentMode();
        modeLabel.textContent = mode === 'faithful' ? t('intent_mode_faithful') : t('intent_mode_standard');
    }
}

function getFontSize() { return localStorage.getItem(FONT_SIZE_KEY) ?? '1'; }
function setFontSize(v) { localStorage.setItem(FONT_SIZE_KEY, v); }

function applyFontSize(value) {
    const html = document.documentElement;
    html.classList.remove('font-medium', 'font-large');
    if (value === '1') html.classList.add('font-medium');
    else if (value === '2') html.classList.add('font-large');
}

// Apply on load
applyFontSize(getFontSize());
// applyLang() called after DOM functions are defined (end of file)

// --- Auth ---
const loginScreen   = document.getElementById('login-screen');
const loginPassword = document.getElementById('login-password');
const loginBtn      = document.getElementById('login-btn');
const loginError    = document.getElementById('login-error');

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }
function forceLogout() { clearToken(); loginScreen.classList.remove('hidden'); }

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
            loadHistory();
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
let activeMicBtn = null;   // mic button currently in use
let activeInput = null;    // input field currently targeted by mic
let lastSeenTimestamp = null;
let oldestTimestamp   = null;

// --- DOM ---
const chatMessages  = document.getElementById('chat-messages');
const btnMic        = document.getElementById('btn-mic');
const inputText     = document.getElementById('input-text');
const btnSend       = document.getElementById('btn-send');
const intentContext = document.getElementById('intent-context');
const btnTaskMic    = document.getElementById('btn-task-mic');
const taskAddInput  = document.getElementById('task-add-input');

// 起動時：認証設定を確認してから接続
(async () => {
    let authRequired = true;
    try {
        const res = await fetch('/api/config');
        if (res.ok) authRequired = (await res.json()).authRequired ?? true;
    } catch { /* ネットワークエラー時はデフォルトで認証あり */ }

    if (!authRequired || getToken()) {
        loginScreen.classList.add('hidden');
        loadHistory();
        connectWs();
    }
})()

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
        if (btn.dataset.tab === 'settings') { loadKeys(); loadGoogleStatus(); initIntentModeUI(); initSpeechLangUI(); initFontSizeUI(); initLangUI(); }
        if (btn.dataset.tab === 'skills') loadSkills();
        if (btn.dataset.tab === 'cron') loadCronTab();
        if (btn.dataset.tab === 'task') loadTaskTab();
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
    ws.addEventListener('open', () => {
        console.log('[ws] connected');
        sendModeToServer(getIntentMode());
        sendLanguageToServer(getSpeechLanguage());
    });
    ws.addEventListener('close', (e) => {
        if (isRecording) stopRecording();
        if (e.code === 4001) {
            // 認証エラー（サーバー明示）：ログアウト
            forceLogout();
            return;
        }
        // 1006はネットワーク切断・スリープ復帰など。再接続を試みる
        console.log('[ws] disconnected, reconnecting...');
        setTimeout(connectWs, 3000);
    });
    ws.addEventListener('error', () => console.error('[ws] error'));
    ws.addEventListener('message', (e) => {
        const msg = JSON.parse(e.data);

        if (msg.type === 'intent') {
            if (activeInput) activeInput.value = msg.text;
            if (activeInput === inputText) {
                // Chat: draft dimming and context display
                if (msg.isFinal === false) {
                    inputText.classList.add('intent-draft');
                } else {
                    inputText.classList.remove('intent-draft');
                }
                if (msg.context) {
                    intentContext.textContent = msg.context;
                    intentContext.classList.add('visible');
                } else if (msg.isFinal !== false) {
                    intentContext.textContent = '';
                    intentContext.classList.remove('visible');
                }
                updateSendState();
            }

        } else if (msg.type === 'voxclaw_reply') {
            removeTyping();
            appendMessage('voxclaw', msg.text);
            // Advance cursor so poll doesn't re-append this reply from DB
            lastSeenTimestamp = new Date().toISOString();

        } else if (msg.type === 'error') {
            removeTyping();
            appendMessage('voxclaw', `⚠️ ${msg.message}`);
            lastSeenTimestamp = new Date().toISOString();
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
function setupMicButton(micBtn, targetInput) {
    micBtn.addEventListener('click', async () => {
        if (isRecording && activeMicBtn === micBtn) {
            stopRecording();
        } else {
            if (isRecording) stopRecording(); // stop any other active recording
            await startRecording(micBtn, targetInput);
        }
    });
}
setupMicButton(btnMic, inputText);
setupMicButton(btnTaskMic, taskAddInput);

async function startRecording(micBtn, targetInput) {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
        appendMessage('voxclaw', t('mic_denied'));
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
    activeMicBtn = micBtn;
    activeInput = targetInput;
    micBtn.classList.add('recording');
    targetInput.value = '';
    if (targetInput === inputText) updateSendState();
}

function stopRecording() {
    isRecording = false;
    activeMicBtn?.classList.remove('recording');
    activeMicBtn = null;
    activeInput = null;

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
    inputText.classList.remove('intent-draft');
    intentContext.textContent = '';
    intentContext.classList.remove('visible');
    inputText.style.height = 'auto';
    updateSendState();
    showTyping();

    ws.send(JSON.stringify({ type: 'confirm', intent: text }));
}

// --- Chat rendering ---
function renderMessageBody(text) {
    // Replace [image:filename] with <img> tags (src loaded async via JWT fetch); escape everything else
    const parts = text.split(/(\[image:[^\]]+\])/g);
    return parts.map(part => {
        const m = part.match(/^\[image:([^\]]+)\]$/);
        if (m) {
            const filename = m[1];
            return `<img class="chat-image" data-media="${encodeURIComponent(filename)}" alt="${escapeHtml(filename)}" loading="lazy">`;
        }
        return `<span>${linkify(escapeHtml(part))}</span>`;
    }).join('');
}

async function loadMediaImages(container) {
    const imgs = [...container.querySelectorAll('img[data-media]')];
    await Promise.all(imgs.map(async (img) => {
        const filename = img.dataset.media;
        try {
            const res = await fetch(`/api/media/${filename}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` },
            });
            if (!res.ok) return;
            const blob = await res.blob();
            img.src = URL.createObjectURL(blob);
        } catch { /* ignore */ }
    }));
}

function appendMessage(role, text, date) {
    const name = role === 'user' ? 'User' : 'Voxclaw';
    const time = formatTime(date ?? new Date());

    const el = document.createElement('div');
    el.className = `message ${role}`;
    el.innerHTML = `
        <div class="message-header">
            <span class="message-dot"></span>
            <span class="message-name">${name}</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-body">${renderMessageBody(text)}</div>
    `;
    chatMessages.appendChild(el);
    loadMediaImages(el);
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

function linkify(str) {
    return str.replace(/https?:\/\/[^\s<>"']+/g, url =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
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

// --- Chat history ---
function getShowMoreBtn() {
    return document.getElementById('show-more-btn');
}

function prependMessage(role, text, date) {
    const name = role === 'voxclaw' ? 'Voxclaw' : 'You';
    const time = date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const el = document.createElement('div');
    el.className = `message ${role}`;
    el.innerHTML = `
        <div class="message-header">
            <span class="message-dot"></span>
            <span class="message-name">${name}</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-body">${renderMessageBody(text)}</div>`;
    chatMessages.insertBefore(el, chatMessages.firstChild);
}

async function loadHistory() {
    try {
        const res = await apiRequest(`/api/chat/history?limit=${HISTORY_PAGE}`);
        if (!res.ok) return;
        const messages = await res.json();
        for (const msg of messages) {
            appendMessage(msg.is_bot ? 'voxclaw' : 'user', msg.content, new Date(msg.timestamp));
            if (!lastSeenTimestamp || msg.timestamp > lastSeenTimestamp) lastSeenTimestamp = msg.timestamp;
            if (!oldestTimestamp   || msg.timestamp < oldestTimestamp)   oldestTimestamp   = msg.timestamp;
        }
        updateShowMoreBtn(messages.length === HISTORY_PAGE);
        scrollToBottom();
    } catch { /* ignore — history is best-effort */ }
}

async function loadMoreHistory() {
    if (!oldestTimestamp) return;
    const btn = getShowMoreBtn();
    if (btn) btn.textContent = '...';
    try {
        const res = await apiRequest(`/api/chat/history?limit=${HISTORY_PAGE}&before=${encodeURIComponent(oldestTimestamp)}`);
        if (!res.ok) return;
        const messages = await res.json();
        const scrollHeightBefore = chatMessages.scrollHeight;
        // Prepend in reverse so oldest ends up at top
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            prependMessage(msg.is_bot ? 'voxclaw' : 'user', msg.content, new Date(msg.timestamp));
            if (!oldestTimestamp || msg.timestamp < oldestTimestamp) oldestTimestamp = msg.timestamp;
        }
        // Keep scroll position stable
        chatMessages.scrollTop += chatMessages.scrollHeight - scrollHeightBefore;
        updateShowMoreBtn(messages.length === HISTORY_PAGE);
    } catch { /* ignore */ }
}

function updateShowMoreBtn(hasMore) {
    let btn = getShowMoreBtn();
    if (!hasMore) { if (btn) btn.remove(); return; }
    if (!btn) {
        btn = document.createElement('div');
        btn.id = 'show-more-btn';
        btn.textContent = 'Show more';
        btn.addEventListener('click', loadMoreHistory);
        chatMessages.insertBefore(btn, chatMessages.firstChild);
    } else {
        btn.textContent = 'Show more';
    }
}

async function pollNewMessages() {
    if (!getToken()) return;
    try {
        const res = await apiRequest(`/api/chat/history?limit=${HISTORY_PAGE}`);
        if (!res.ok) return;
        const messages = await res.json();
        let hasNew = false;
        for (const msg of messages) {
            if (lastSeenTimestamp && msg.timestamp <= lastSeenTimestamp) continue;
            // Only show bot messages from polling — user messages are already shown
            // optimistically in sendMessage(), so polling them causes duplicates.
            if (msg.is_bot) {
                appendMessage('voxclaw', msg.content, new Date(msg.timestamp));
                hasNew = true;
            }
            if (!lastSeenTimestamp || msg.timestamp > lastSeenTimestamp) lastSeenTimestamp = msg.timestamp;
        }
        if (hasNew) scrollToBottom();
    } catch { /* ignore */ }
}

setInterval(pollNewMessages, 15000);

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

// --- Intent mode ---
function getIntentMode() { return localStorage.getItem(INTENT_MODE_KEY) ?? 'standard'; }
function setIntentMode(mode) { localStorage.setItem(INTENT_MODE_KEY, mode); }

function sendModeToServer(mode) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'set_mode', mode }));
    }
}

// --- Speech language ---
function getSpeechLanguage() { return localStorage.getItem(SPEECH_LANG_KEY) ?? ''; }
function setSpeechLanguage(lang) { localStorage.setItem(SPEECH_LANG_KEY, lang); }

function sendLanguageToServer(lang) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'set_language', language: lang }));
    }
}

function initSpeechLangUI() {
    const select = document.getElementById('speech-lang-select');
    if (!select) return;
    select.value = getSpeechLanguage();
    select.addEventListener('change', () => {
        setSpeechLanguage(select.value);
        sendLanguageToServer(select.value);
    });
}

function updateSliderFill(slider) {
    const pct = (parseInt(slider.value) / 2) * 100;
    slider.style.background = `linear-gradient(to right, #1a1a1a ${pct}%, #1a1a1a ${pct}%, #e5e5e5 ${pct}%, #e5e5e5 100%)`;
}

function initFontSizeUI() {
    const slider = document.getElementById('font-size-slider');
    if (!slider) return;
    slider.value = getFontSize();
    updateSliderFill(slider);
    slider.addEventListener('input', () => {
        setFontSize(slider.value);
        applyFontSize(slider.value);
        updateSliderFill(slider);
    });
}

function initLangUI() {
    const select = document.getElementById('ui-lang-select');
    if (!select) return;
    select.value = getUiLang();
    select.addEventListener('change', () => {
        setUiLang(select.value);
        applyLang();
        // Re-init intent mode label after lang change
        initIntentModeUI();
    });
}

function initIntentModeUI() {
    const toggle = document.getElementById('intent-mode-toggle');
    const label  = document.getElementById('intent-mode-label');
    if (!toggle || !label) return;

    const mode = getIntentMode();
    toggle.checked = mode === 'faithful';
    label.textContent = mode === 'faithful' ? t('intent_mode_faithful') : t('intent_mode_standard');

    toggle.addEventListener('change', () => {
        const newMode = toggle.checked ? 'faithful' : 'standard';
        setIntentMode(newMode);
        label.textContent = newMode === 'faithful' ? t('intent_mode_faithful') : t('intent_mode_standard');
        sendModeToServer(newMode);
    });
}

// --- Settings ---
async function apiRequest(path, options = {}) {
    const res = await fetch(path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getToken()}`,
            ...(options.headers ?? {}),
        },
    });
    if (res.status === 401) {
        forceLogout();
    }
    return res;
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
            appendMessage('voxclaw', t('google_auth_ok'));
        } else {
            const err = await res.json();
            appendMessage('voxclaw', t('google_auth_fail') + err.error);
        }
    } catch {
        appendMessage('voxclaw', t('google_auth_error'));
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
    if (!editBtn) return;
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
function skillToId(name) {
    return 'cron_' + name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// Extract skill name from cron entry prompt
function skillNameFromEntry(entry) {
    const m = entry?.prompt?.match(/Execute the skill "(.+)" now/);
    return m ? m[1] : null;
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

function formatCronHeaderTime(s, entry) {
    if (!entry) return '';
    const h12 = s.hour % 12 || 12;
    const ampm = s.hour < 12 ? 'AM' : 'PM';
    const t = `${String(h12).padStart(2,'0')}:${String(s.minute).padStart(2,'0')} ${ampm}`;
    const modeLabel = s.mode === 'daily' ? 'Everyday'
                    : s.mode === 'weekdays' ? 'Weekdays'
                    : 'Custom';
    return `${t} / ${modeLabel}`;
}

async function loadCronTab() {
    const list = document.getElementById('cron-list');
    list.innerHTML = '';
    try {
        const [skillsRes, cronRes] = await Promise.all([
            apiRequest('/api/skills'),
            apiRequest('/api/cron'),
        ]);
        if (!skillsRes.ok) throw new Error(`skills ${skillsRes.status}`);
        if (!cronRes.ok)   throw new Error(`cron ${cronRes.status}`);
        const { skills } = await skillsRes.json();
        const entries = await cronRes.json();

        // Match entries to skills (by prompt extraction, with skillToId fallback)
        const matchSkill = (entry) =>
            skills.find(s => skillNameFromEntry(entry) === s.name || skillToId(s.name) === entry.id) ?? null;

        // Only render entries that match a known skill
        const scheduled = entries.filter(e => matchSkill(e));
        const enabledCount  = scheduled.filter(e => e.enabled).length;
        const disabledCount = scheduled.filter(e => !e.enabled).length;
        if (scheduled.length > 0) {
            const summary = document.createElement('p');
            summary.className = 'cron-summary';
            summary.textContent =
                `${enabledCount} Enable Cron${enabledCount !== 1 ? 's' : ''} / ${disabledCount} Disable Cron${disabledCount !== 1 ? 's' : ''}`;
            list.appendChild(summary);
        }

        for (const entry of scheduled) {
            const skill = matchSkill(entry);
            list.appendChild(renderCronItem(skill, entry));
        }

        // "+" add button
        const addBar = document.createElement('div');
        addBar.id = 'cron-add-bar';
        addBar.innerHTML = `<button id="cron-add-btn"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
        list.appendChild(addBar);

        document.getElementById('cron-add-btn').addEventListener('click', () => {
            showCronAddPicker(skills, list);
        });
    } catch (err) {
        console.error('[cron] load failed:', err);
        list.innerHTML = '<p style="color:#aaa;text-align:center;padding:20px">Failed to load</p>';
    }
}

function showCronAddPicker(skills, list) {
    document.querySelector('.cron-add-picker')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'cron-add-picker';
    overlay.innerHTML = `
        <div class="cron-add-picker-inner">
            <p class="cron-add-picker-title">Select a skill to schedule</p>
            ${skills.map(s => `<div class="cron-add-skill-opt" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</div>`).join('')}
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
        if (!e.target.closest('.cron-add-picker-inner')) { overlay.remove(); return; }
        const opt = e.target.closest('.cron-add-skill-opt');
        if (!opt) return;
        const skill = skills.find(s => s.name === opt.dataset.name);
        if (!skill) return;
        overlay.remove();
        const addBar = document.getElementById('cron-add-bar');
        const newCard = renderCronItem(skill, null);
        list.insertBefore(newCard, addBar);
        // Auto-open accordion for new card
        const body = newCard.querySelector('.cron-body');
        const chevron = newCard.querySelector('.cron-chevron');
        body.style.display = 'flex';
        chevron.textContent = '\u25b4';
        newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
}

function renderCronItem(skill, entry) {
    // For existing entries, use their ID; for new ones, generate a unique ID
    const id = entry ? entry.id : (skillToId(skill.name) + '_' + Date.now());
    const s = entry ? (parseCronSchedule(entry.cron) ?? { hour: 9, minute: 0, mode: 'daily', days: [] })
                    : { hour: 9, minute: 0, mode: 'daily', days: [] };

    const isVoice = !entry?.channelId || entry.channelId === 'voice';
    const discordChannelId = isVoice ? '' : (entry?.channelId ?? '');

    const el = document.createElement('div');
    el.className = 'cron-card';

    const timeLabel   = entry ? formatCronHeaderTime(s, entry) : 'Not scheduled';
    const enableLabel = entry ? (entry.enabled ? 'Enable' : 'Disable') : '';

    el.innerHTML = `
        <div class="cron-card-header">
            <div class="cron-header-row1">
                <span class="cron-time-label">${escapeHtml(timeLabel)}</span>
                ${entry ? `
                <div class="cron-enable-ctrl">
                    <span class="cron-enable-text${entry.enabled ? ' on' : ''}">${enableLabel}</span>
                    <label class="cron-toggle">
                        <input type="checkbox" class="cron-enabled-check" ${entry.enabled ? 'checked' : ''}>
                        <span class="cron-toggle-slider"></span>
                    </label>
                </div>` : ''}
            </div>
            <div class="cron-header-row2">
                <span class="cron-skill-name">${escapeHtml(skill.name)}</span>
                <span class="cron-chevron">\u25be</span>
            </div>
        </div>
        <div class="cron-body" style="display:none">
            <span class="cron-field-label">Time</span>
            <div class="cron-time-row">
                <input class="cron-time-input cron-hour"   type="number" min="0" max="23" placeholder="HH"
                    value="${s.hour}" />
                <input class="cron-time-input cron-minute" type="number" min="0" max="59" placeholder="MM"
                    value="${String(s.minute).padStart(2,'0')}" />
            </div>
            <span class="cron-field-label">Repeat</span>
            <div class="cron-repeat-row">
                <label><input type="radio" name="rep_${id}" value="daily"    ${s.mode==='daily'   ?'checked':''}> Every day</label>
                <label><input type="radio" name="rep_${id}" value="weekdays" ${s.mode==='weekdays'?'checked':''}> Weekdays</label>
                <label><input type="radio" name="rep_${id}" value="custom"   ${s.mode==='custom'  ?'checked':''}> Custom</label>
            </div>
            <div class="cron-days-row" style="display:${s.mode==='custom'?'flex':'none'}">
                ${DAY_LABELS.map((d,i) => `<label class="cron-day-label"><input type="checkbox" value="${i}" ${s.days.includes(i)?'checked':''}> ${d}</label>`).join('')}
            </div>
            <span class="cron-field-label">Destination</span>
            <div class="cron-dest-row">
                <label><input type="radio" name="dest_${id}" value="voice"   ${isVoice ?'checked':''}> Voxclaw Chat</label>
                <label><input type="radio" name="dest_${id}" value="discord" ${!isVoice?'checked':''}> Discord</label>
            </div>
            <div class="cron-discord-row" style="display:${isVoice?'none':'flex'}">
                <input class="cron-channel-input" type="text" placeholder="Discord channel ID"
                    value="${escapeHtml(discordChannelId)}" />
            </div>
            <div class="cron-actions">
                <button class="cron-save-btn">Save</button>
                ${entry ? '<button class="cron-delete-btn">Delete</button>' : ''}
            </div>
        </div>
    `;

    // Accordion toggle (ignore toggle clicks)
    el.querySelector('.cron-card-header').addEventListener('click', (e) => {
        if (e.target.closest('.cron-toggle')) return;
        const body    = el.querySelector('.cron-body');
        const chevron = el.querySelector('.cron-chevron');
        const open    = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'flex';
        chevron.textContent = open ? '\u25be' : '\u25b4';
    });

    // Header toggle: auto-save enabled state
    const toggle = el.querySelector('.cron-enabled-check');
    if (toggle && entry) {
        toggle.addEventListener('change', async () => {
            const enabled = toggle.checked;
            const enableCtrl = el.querySelector('.cron-enable-text');
            enableCtrl.textContent = enabled ? 'Enable' : 'Disable';
            enableCtrl.classList.toggle('on', enabled);
            el.querySelector('.cron-time-label').textContent =
                formatCronHeaderTime(s, { ...entry, enabled });
            entry.enabled = enabled;
            try {
                await apiRequest('/api/cron', {
                    method: 'POST',
                    body: JSON.stringify({ ...entry, enabled }),
                });
            } catch {}
        });
    }

    // Show/hide custom days
    el.querySelectorAll(`input[name="rep_${id}"]`).forEach(r => {
        r.addEventListener('change', () => {
            el.querySelector('.cron-days-row').style.display = r.value === 'custom' ? 'flex' : 'none';
        });
    });

    // Show/hide Discord input
    el.querySelectorAll(`input[name="dest_${id}"]`).forEach(r => {
        r.addEventListener('change', () => {
            el.querySelector('.cron-discord-row').style.display = r.value === 'discord' ? 'flex' : 'none';
        });
    });

    // Save
    el.querySelector('.cron-save-btn').addEventListener('click', async () => {
        const hour   = Math.min(23, Math.max(0, parseInt(el.querySelector('.cron-hour').value, 10) || 0));
        const minute = Math.min(59, Math.max(0, parseInt(el.querySelector('.cron-minute').value, 10) || 0));
        const mode   = el.querySelector(`input[name="rep_${id}"]:checked`).value;
        const days   = mode === 'custom'
            ? [...el.querySelectorAll('.cron-days-row input:checked')].map(c => parseInt(c.value, 10))
            : [];
        const dest      = el.querySelector(`input[name="dest_${id}"]:checked`).value;
        const channelId = dest === 'voice' ? 'voice' : el.querySelector('.cron-channel-input').value.trim();
        const enabled   = toggle ? toggle.checked : true;
        if (dest === 'discord' && !channelId) { alert('Discord channel ID is required'); return; }

        const btn = el.querySelector('.cron-save-btn');
        btn.textContent = 'Saving\u2026'; btn.disabled = true;
        try {
            const res = await apiRequest('/api/cron', {
                method: 'POST',
                body: JSON.stringify({
                    id,
                    cron: buildCronExpr(hour, minute, mode, days),
                    prompt: `[Scheduled task] Execute the skill "${skill.name}" now. This is an automated run \u2014 complete the skill from /app/skills/ in full, independent of any prior conversation.`,
                    channelId,
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
            delBtn.textContent = 'Deleting\u2026'; delBtn.disabled = true;
            try {
                await apiRequest(`/api/cron/${encodeURIComponent(id)}`, { method: 'DELETE' });
                loadCronTab();
            } finally { delBtn.textContent = 'Delete'; delBtn.disabled = false; }
        });
    }

    return el;
}

// --- Tasks ---

async function loadTaskTab() {
    await loadTasks();
}

async function loadTasks() {
    const container = document.getElementById('task-items');
    container.innerHTML = `<p class="task-empty">${t('tasks_loading')}</p>`;
    try {
        const res = await apiRequest('/api/tasks');
        if (!res.ok) throw new Error();
        const tasks = await res.json();
        container.innerHTML = '';
        if (!tasks.length) {
            container.innerHTML = `<p class="task-empty">${t('tasks_empty')}</p>`;
            return;
        }
        // Incomplete first, then completed
        tasks.sort((a, b) => (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0));
        for (const task of tasks) {
            container.appendChild(renderTaskItem(task));
        }
    } catch {
        container.innerHTML = `<p class="task-empty">${t('tasks_failed')}</p>`;
    }
}

function formatTaskDue(due) {
    if (!due) return null;
    const d = new Date(due + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
        label: `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`,
        isOverdue: d < today,
    };
}

function renderTaskItem(task) {
    const done = task.status === 'completed';
    const due = formatTaskDue(task.due);

    const el = document.createElement('div');
    el.className = `skill-item task-item${done ? ' completed' : ''}`;

    const dueChip = due
        ? `<span class="task-item-due${due.isOverdue && !done ? ' overdue' : ''}">${escapeHtml(due.label)}</span>`
        : '';

    el.innerHTML = `
        <div class="task-item-header">
            <div class="task-check${done ? ' done' : ''}"></div>
            <span class="task-item-title">${escapeHtml(task.title)}</span>
            ${dueChip}
            <span class="skill-item-chevron">▾</span>
        </div>
        <div class="skill-item-body" style="display:none">
            <span class="task-field-label">Title</span>
            <input class="task-title-input" type="text" value="${escapeHtml(task.title)}">
            <span class="task-field-label">Notes</span>
            <textarea class="task-notes-input" placeholder="Add notes…">${escapeHtml(task.notes ?? '')}</textarea>
            <span class="task-field-label">Due date</span>
            <input class="task-due-input" type="date" value="${escapeHtml(task.due ?? '')}">
            <div class="task-actions">
                <button class="task-save-btn">Save</button>
                <button class="task-delete-btn">Delete</button>
            </div>
        </div>
    `;

    // Accordion toggle (header click, but not on check circle)
    el.querySelector('.task-item-header').addEventListener('click', (e) => {
        if (e.target.closest('.task-check')) return;
        el.classList.toggle('open');
        const body = el.querySelector('.skill-item-body');
        body.style.display = el.classList.contains('open') ? 'flex' : 'none';
    });

    // Toggle completion
    el.querySelector('.task-check').addEventListener('click', async () => {
        const newStatus = done ? 'needsAction' : 'completed';
        try {
            await apiRequest(`/api/tasks/${encodeURIComponent(task.id)}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: newStatus }),
            });
            loadTasks();
        } catch {}
    });

    // Save (title + notes + due)
    el.querySelector('.task-save-btn').addEventListener('click', async () => {
        const title = el.querySelector('.task-title-input').value.trim();
        const notes = el.querySelector('.task-notes-input').value.trim() || null;
        const due   = el.querySelector('.task-due-input').value || null;
        if (!title) return;
        const btn = el.querySelector('.task-save-btn');
        btn.textContent = 'Saving…'; btn.disabled = true;
        try {
            await apiRequest(`/api/tasks/${encodeURIComponent(task.id)}`, {
                method: 'PATCH',
                body: JSON.stringify({ title, notes, due }),
            });
            loadTasks();
        } finally { btn.textContent = 'Save'; btn.disabled = false; }
    });

    // Delete
    el.querySelector('.task-delete-btn').addEventListener('click', async () => {
        const btn = el.querySelector('.task-delete-btn');
        btn.textContent = 'Deleting…'; btn.disabled = true;
        try {
            await apiRequest(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
            el.remove();
        } finally { btn.textContent = 'Delete'; btn.disabled = false; }
    });

    return el;
}

// Add task
document.getElementById('task-add-btn').addEventListener('click', addTask);
document.getElementById('task-add-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTask();
});

async function addTask() {
    const input = document.getElementById('task-add-input');
    const title = input.value.trim();
    if (!title) return;
    input.value = '';
    try {
        await apiRequest('/api/tasks', {
            method: 'POST',
            body: JSON.stringify({ title }),
        });
        loadTasks();
    } catch {}
}

// Apply language strings on initial load
applyLang();
