import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as http from 'http';

import { processMessage } from './agent.js';
import { startCronRunner } from './cron-runner.js';
import { DiscordChannel } from './channels/discord.js';
import { type Channel } from './channels/types.js';
import {
    getChannelHistory,
    getNewMentions,
    getNewMessages,
    getRouterState,
    initDatabase,
    type Message,
    setRouterState,
    storeMessage,
} from './db.js';

dotenv.config();

const POLL_INTERVAL = 2000;
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const CHANNELS_CONFIG_PATH = '/app/config/channels.json';

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
        const historySince = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
        const history = getChannelHistory(channelId, historySince);

        for (const msg of messages) {
            // Strip mention from content if present
            const content = msg.content
                .replace(`<@${channel.getBotId()}>`, '')
                .trim();

            await channel.setTyping?.(channelId, true);

            let replyText: string;
            try {
                const reply = await processMessage(content, history, msg.sender_name, channelId);
                replyText = reply.length > 1990 ? reply.slice(0, 1990) + '…' : reply;
            } catch (err: any) {
                console.error(`[processChannel] error for msg ${msg.id}:`, err);
                const code = err.status ?? err.code ?? 'unknown';
                replyText = `⚠️ エラーが発生しました（${code}）。しばらく経ってから再度お試しください。`;
            }

            // Mention the sender only in mention-required channels
            const sendText = requireMention
                ? `<@${msg.sender_id}> ${replyText}`
                : replyText;

            await channel.sendMessage(channelId, sendText);

            storeMessage({
                id: `bot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                channel_id: channelId,
                sender_id: channel.getBotId(),
                sender_name: 'gemiclaw',
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

const HTTP_API_PORT = parseInt(process.env.HTTP_API_PORT ?? '3001', 10);
const VOICE_CHANNEL_ID = 'voice';

function startHttpApi(): void {
    const server = http.createServer((req, res) => {
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

                    const historySince = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
                    const history = getChannelHistory(VOICE_CHANNEL_ID, historySince);

                    const msgId = `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
                        id: `bot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                        channel_id: VOICE_CHANNEL_ID,
                        sender_id: 'gemiclaw',
                        sender_name: 'gemiclaw',
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

    const savedChannels = getRouterState('monitored_channels');
    monitoredChannelIds = savedChannels ? JSON.parse(savedChannels) : [];
    lastTimestamp = getRouterState('last_timestamp')
        ?? new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();

    const channel: Channel = new DiscordChannel();

    await channel.connect((msg) => {
        if (!monitoredChannelIds.includes(msg.channel_id)) {
            monitoredChannelIds.push(msg.channel_id);
            setRouterState('monitored_channels', JSON.stringify(monitoredChannelIds));
        }
        lastMessageTime.set(msg.channel_id, Date.now());
        storeMessage(msg);
    });

    startCronRunner(channel);

    const shutdown = async (signal: string) => {
        console.log(`[${signal}] Shutting down...`);
        await channel.disconnect();
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    startPollingLoop(channel);
    startHttpApi();
}

main().catch((err) => {
    console.error('Failed to start gemiclaw:', err);
    process.exit(1);
});
