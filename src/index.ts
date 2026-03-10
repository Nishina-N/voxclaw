import { Client, GatewayIntentBits } from 'discord.js';
import * as dotenv from 'dotenv';

import { processMessage } from './agent.js';
import {
    getChannelHistory,
    getNewMentions,
    getRouterState,
    initDatabase,
    Message,
    setRouterState,
    storeMessage,
} from './db.js';

dotenv.config();

const POLL_INTERVAL = 2000;
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000; // look back 24h for context

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Channels we've seen messages in (persisted across restarts via router_state)
let monitoredChannelIds: string[] = [];

// Per-channel lock: prevents processing the same channel concurrently
const processingChannels = new Set<string>();

// Cursor: last message timestamp we've processed mentions up to
let lastTimestamp = '';

// --- Discord event handlers ---

client.once('ready', () => {
    console.log(`🐾 gemiclaw is online as ${client.user?.tag}`);

    // Restore state from DB
    const savedChannels = getRouterState('monitored_channels');
    monitoredChannelIds = savedChannels ? JSON.parse(savedChannels) : [];
    lastTimestamp = getRouterState('last_timestamp')
        ?? new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();

    startPollingLoop();
});

// Store every incoming message; don't process yet
client.on('messageCreate', (message) => {
    if (message.author.bot) return;

    if (!monitoredChannelIds.includes(message.channelId)) {
        monitoredChannelIds.push(message.channelId);
        setRouterState('monitored_channels', JSON.stringify(monitoredChannelIds));
    }

    storeMessage({
        id: message.id,
        channel_id: message.channelId,
        sender_id: message.author.id,
        sender_name: message.author.displayName ?? message.author.username,
        content: message.content,
        timestamp: message.createdAt.toISOString(),
        is_bot: 0,
    });
});

// --- Polling loop ---

function startPollingLoop(): void {
    setInterval(async () => {
        try {
            const { messages, newTimestamp } = getNewMentions(
                monitoredChannelIds,
                lastTimestamp,
                client.user!.id,
            );
            if (messages.length === 0) return;

            // Advance cursor immediately so a crash doesn't re-process the same messages
            lastTimestamp = newTimestamp;
            setRouterState('last_timestamp', lastTimestamp);

            // Group by channel, then process each (respecting per-channel lock)
            const byChannel = new Map<string, Message[]>();
            for (const msg of messages) {
                const list = byChannel.get(msg.channel_id) ?? [];
                list.push(msg);
                byChannel.set(msg.channel_id, list);
            }

            for (const [channelId, mentions] of byChannel) {
                processChannel(channelId, mentions).catch(console.error);
            }
        } catch (err) {
            console.error('[poll] error:', err);
        }
    }, POLL_INTERVAL);
}

async function processChannel(channelId: string, mentions: Message[]): Promise<void> {
    if (processingChannels.has(channelId)) return;
    processingChannels.add(channelId);

    try {
        const discordChannel = client.channels.cache.get(channelId);
        if (!discordChannel?.isTextBased()) return;

        // Shared history window for all mentions in this batch
        const historySince = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
        const history = getChannelHistory(channelId, historySince);

        for (const msg of mentions) {
            const content = msg.content.replace(`<@${client.user!.id}>`, '').trim();

            if ('sendTyping' in discordChannel) await (discordChannel as any).sendTyping();

            let replyText: string;
            try {
                const reply = await processMessage(content, history, msg.sender_name);
                replyText = reply.length > 1990 ? reply.slice(0, 1990) + '…' : reply;
            } catch (err: any) {
                console.error(`[processChannel] error for msg ${msg.id}:`, err);
                const code = err.status ?? err.code ?? 'unknown';
                replyText = `⚠️ エラーが発生しました（${code}）。しばらく経ってから再度お試しください。`;
            }

            const sent = await (discordChannel as any).send(`<@${msg.sender_id}> ${replyText}`);

            // Store bot reply so it appears in future history
            storeMessage({
                id: sent.id,
                channel_id: channelId,
                sender_id: client.user!.id,
                sender_name: client.user!.username,
                content: sent.content,
                timestamp: sent.createdAt.toISOString(),
                is_bot: 1,
            });
        }
    } finally {
        processingChannels.delete(channelId);
    }
}

// --- Start ---

if (!process.env.DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN is missing in .env');
    process.exit(1);
}

initDatabase();
client.login(process.env.DISCORD_TOKEN);
