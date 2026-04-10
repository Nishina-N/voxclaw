import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as http from 'http';

import { processMessage } from './agent.js';
import { startCronRunner } from './cron-runner.js';
import { DiscordChannel } from './channels/discord.js';
import { type Channel } from './channels/types.js';
import { truncateForDiscord, extractErrorCode, generateId, historySince } from './utils.js';
import {
    getChannelHistory,
    getNewMentions,
    getNewMessages,
    getRouterState,
    initDatabase,
    type Message,
    setRouterState,
    storeMessage,
    getTasks,
    createTask,
    updateTask,
    deleteTask,
} from './db.js';

dotenv.config();

const POLL_INTERVAL = 2000;
const CHANNELS_CONFIG_PATH = '/app/config/channels.json';
const HTTP_API_PORT = parseInt(process.env.HTTP_API_PORT ?? '3001', 10);
const VOICE_CHANNEL_ID = 'voice';

// Per-channel config written by the agent via write_file
interface ChannelConfig {
    name?: string;
    requireMention: boolean; // default: true
}

function loadChannelsConfig(): Record<string, ChannelConfig> {
    try {
        return JSON.parse(fs.readFileSync(CHANNELS_CONFIG_PATH, 'utf-8'));
    } catch {
        return {};
    }
}

const OPEN_CHANNEL_DEBOUNCE_MS = 1000; // wait after last message before responding in requireMention:false channels

let monitoredChannelIds: string[] = [];
let lastTimestamp = '';
const processingChannels = new Set<string>();
const lastMessageTime = new Map<string, number>(); // channelId → epoch ms of last received message

// --- Message processing ---

async function processChannel(
    channel: Channel,
    channelId: string,
    messages: Message[],
    requireMention: boolean,
): Promise<void> {
    if (processingChannels.has(channelId)) return;
    processingChannels.add(channelId);

    try {
        const since = historySince();
        const history = getChannelHistory(channelId, since);

        for (const msg of messages) {
            // Strip mention from content if present
            const content = msg.content
                .replace(`<@${channel.getBotId()}>`, '')
                .trim();

            await channel.setTyping?.(channelId, true);

            let replyText: string;
            try {
                const reply = await processMessage(content, history, msg.sender_name, channelId);
                replyText = truncateForDiscord(reply);
            } catch (err: any) {
                console.error(`[processChannel] error for msg ${msg.id}:`, err);
                const code = extractErrorCode(err);
                replyText = `⚠️ エラーが発生しました（${code}）。しばらく経ってから再度お試しください。`;
            }

            // Mention the sender only in mention-required channels
            const sendText = requireMention
                ? `<@${msg.sender_id}> ${replyText}`
                : replyText;

            await channel.sendMessage(channelId, sendText);

            storeMessage({
                id: generateId('bot'),
                channel_id: channelId,
                sender_id: channel.getBotId(),
                sender_name: 'voxclaw',
                content: sendText,
                timestamp: new Date().toISOString(),
                is_bot: 1,
            });
        }
    } finally {
        processingChannels.delete(channelId);
    }
}

// --- Polling loop ---

function startPollingLoop(channel: Channel): void {
    setInterval(async () => {
        try {
            const config = loadChannelsConfig();

            // Split monitored channels by requireMention setting
            const mentionChannels = monitoredChannelIds.filter(
                (id) => (config[id]?.requireMention ?? true) === true,
            );
            const openChannels = monitoredChannelIds.filter(
                (id) => (config[id]?.requireMention ?? true) === false,
            );

            // Query DB: two separate queries with appropriate filters
            const { messages: mentionMsgs, newTimestamp: t1 } =
                getNewMentions(mentionChannels, lastTimestamp, channel.getBotId());

            // For open channels, only query those that have been quiet for at least DEBOUNCE_MS
            const debounced = openChannels.filter((id) => {
                const last = lastMessageTime.get(id) ?? 0;
                return Date.now() - last >= OPEN_CHANNEL_DEBOUNCE_MS;
            });

            const { messages: openMsgs, newTimestamp: t2 } =
                getNewMessages(debounced, lastTimestamp);

            // Advance cursor to the latest timestamp across both queries
            const newTimestamp = t1 > t2 ? t1 : t2;
            if (newTimestamp === lastTimestamp) return;
            lastTimestamp = newTimestamp;
            setRouterState('last_timestamp', lastTimestamp);

            // Group and dispatch
            const grouped = new Map<string, { msgs: Message[]; requireMention: boolean }>();
            for (const msg of mentionMsgs) {
                grouped.set(msg.channel_id, { msgs: [...(grouped.get(msg.channel_id)?.msgs ?? []), msg], requireMention: true });
            }
            for (const msg of openMsgs) {
                grouped.set(msg.channel_id, { msgs: [...(grouped.get(msg.channel_id)?.msgs ?? []), msg], requireMention: false });
            }

            for (const [channelId, { msgs, requireMention }] of grouped) {
                processChannel(channel, channelId, msgs, requireMention).catch(console.error);
            }
        } catch (err) {
            console.error('[poll] error:', err);
        }
    }, POLL_INTERVAL);
}

// --- HTTP API server ---

function startHttpApi(): void {
    const server = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url?.startsWith('/api/history')) {
            const url = new URL(req.url, `http://localhost`);
            const channelId = url.searchParams.get('channelId') ?? VOICE_CHANNEL_ID;
            const limit = Math.min(200, parseInt(url.searchParams.get('limit') ?? '50', 10));
            const before = url.searchParams.get('before') ?? undefined;
            const messages = getChannelHistory(channelId, '', limit, before);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(messages));
            return;
        }

        // --- /api/tasks ---
        if (req.url?.startsWith('/api/tasks')) {
            const url = new URL(req.url, 'http://localhost');
            const taskId = url.pathname.replace('/api/tasks', '').replace(/^\//, '');

            if (req.method === 'GET') {
                const status = url.searchParams.get('status') ?? undefined;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(getTasks(status)));
                return;
            }

            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body || '{}');
                    if (req.method === 'POST') {
                        const now = new Date().toISOString();
                        const task = {
                            id: generateId('task'),
                            title: String(data.title ?? '').trim(),
                            notes: data.notes ?? null,
                            due: data.due ?? null,
                            status: 'needsAction',
                            created_at: now,
                            updated_at: now,
                        };
                        if (!task.title) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'title is required' }));
                            return;
                        }
                        createTask(task);
                        res.writeHead(201, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(task));
                    } else if (req.method === 'PATCH' && taskId) {
                        const ok = updateTask(taskId, data);
                        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok }));
                    } else if (req.method === 'DELETE' && taskId) {
                        const ok = deleteTask(taskId);
                        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok }));
                    } else {
                        res.writeHead(405, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'method not allowed' }));
                    }
                } catch {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'invalid JSON' }));
                }
            });
            return;
        }

        if (req.method === 'POST' && req.url === '/api/message') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', async () => {
                try {
                    const { text, sender = 'voice-user' } = JSON.parse(body);
                    if (!text || typeof text !== 'string') {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'text is required' }));
                        return;
                    }

                    const since = historySince();
                    const history = getChannelHistory(VOICE_CHANNEL_ID, since);

                    const msgId = generateId('voice');
                    storeMessage({
                        id: msgId,
                        channel_id: VOICE_CHANNEL_ID,
                        sender_id: 'voice-user',
                        sender_name: sender,
                        content: text,
                        timestamp: new Date().toISOString(),
                        is_bot: 0,
                    });

                    const reply = await processMessage(text, history, sender, VOICE_CHANNEL_ID);

                    storeMessage({
                        id: generateId('bot'),
                        channel_id: VOICE_CHANNEL_ID,
                        sender_id: 'voxclaw',
                        sender_name: 'voxclaw',
                        content: reply,
                        timestamp: new Date().toISOString(),
                        is_bot: 1,
                    });

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ reply }));
                } catch (err: any) {
                    console.error('[http-api] error:', err);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'internal server error' }));
                }
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
        }
    });

    server.listen(HTTP_API_PORT, () => {
        console.log(`[http-api] listening on port ${HTTP_API_PORT}`);
    });
}

// --- Entry point ---

async function main(): Promise<void> {
    initDatabase();
    startHttpApi();

    if (!process.env.DISCORD_TOKEN) {
        console.log('[voxclaw] DISCORD_TOKEN not set — running in HTTP-API-only mode');
        startCronRunner(null);
        return;
    }

    const savedChannels = getRouterState('monitored_channels');
    monitoredChannelIds = savedChannels ? JSON.parse(savedChannels) : [];
    lastTimestamp = getRouterState('last_timestamp')
        ?? historySince();

    const channel: Channel = new DiscordChannel();

    try {
        await channel.connect((msg) => {
            if (!monitoredChannelIds.includes(msg.channel_id)) {
                monitoredChannelIds.push(msg.channel_id);
                setRouterState('monitored_channels', JSON.stringify(monitoredChannelIds));
            }
            lastMessageTime.set(msg.channel_id, Date.now());
            storeMessage(msg);
        });
    } catch (err: any) {
        console.warn(`[voxclaw] Discord connection failed (${err.code ?? err.message}) — running in HTTP-API-only mode`);
        return;
    }

    startCronRunner(channel);

    const shutdown = async (signal: string) => {
        console.log(`[${signal}] Shutting down...`);
        await channel.disconnect();
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    startPollingLoop(channel);
}

main().catch((err) => {
    console.error('Failed to start voxclaw:', err);
    process.exit(1);
});
