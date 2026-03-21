import { Client, GatewayIntentBits } from 'discord.js';
import type { Message as DiscordMessage, Attachment } from 'discord.js';

import { type Message } from '../db.js';
import { type Channel, type OnMessageCallback } from './types.js';
import { processMessage as processAgentMessage } from '../agent.js';
import { transcribeVoiceMessage } from '../voice.js';

// --- Voice confirmation helpers ---

const CONFIRM_KEYWORDS = ['はい', 'yes', 'ok', 'おk', '実行', 'やって', '進めて', 'いいよ', 'そう', 'そうです', '正しい', '合ってる'];
const CANCEL_KEYWORDS = ['いいえ', 'no', 'キャンセル', 'やめて', '違う', '異なる'];
const VOICE_CONFIRM_TIMEOUT_MS = 30_000;

function isConfirm(text: string): boolean {
    const t = text.trim().toLowerCase();
    return CONFIRM_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}

function isCancel(text: string): boolean {
    const t = text.trim().toLowerCase();
    return CANCEL_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}

// チャンネル+ユーザーごとに確認待ち中フラグを管理
const pendingVoiceConfirmations = new Set<string>();

// ---

export class DiscordChannel implements Channel {
    readonly name = 'discord';
    private client: Client;
    private _connected = false;

    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
        });
    }

    async connect(onMessage: OnMessageCallback): Promise<void> {
        if (!process.env.DISCORD_TOKEN) {
            throw new Error('DISCORD_TOKEN is missing in .env');
        }

        this.client.on('messageCreate', async (message) => {
            if (message.author.bot) return;

            // 確認待ち中のメッセージは通常フローをスキップ（awaitMessages が拾う）
            const confirmKey = `${message.channelId}:${message.author.id}`;
            if (pendingVoiceConfirmations.has(confirmKey)) return;

            // ボイスメッセージ（音声添付）を検出
            const audioAttachment = message.attachments.find(
                (a) => a.contentType?.startsWith('audio/') ?? false,
            );
            if (audioAttachment) {
                this.handleVoiceMessage(message, audioAttachment).catch((err) => {
                    console.error('[voice] unhandled error:', err);
                });
                return;
            }

            // 通常のテキストメッセージ
            onMessage({
                id: message.id,
                channel_id: message.channelId,
                sender_id: message.author.id,
                sender_name: message.author.displayName ?? message.author.username,
                content: message.content,
                timestamp: message.createdAt.toISOString(),
                is_bot: 0,
            });
        });

        await new Promise<void>((resolve, reject) => {
            this.client.once('clientReady', (c) => {
                console.log(`🐾 gemiclaw is online as ${c.user.tag} [${this.name}]`);
                this._connected = true;
                resolve();
            });
            this.client.login(process.env.DISCORD_TOKEN!).catch(reject);
        });
    }

    private async handleVoiceMessage(message: DiscordMessage, attachment: Attachment): Promise<void> {
        const confirmKey = `${message.channelId}:${message.author.id}`;
        pendingVoiceConfirmations.add(confirmKey);

        const ch = message.channel as any;

        try {
            if ('sendTyping' in ch) await ch.sendTyping();

            // 1. 音声を Gemini で理解して意図を取得
            const mimeType = attachment.contentType ?? 'audio/ogg';
            let intent: string;
            try {
                intent = await transcribeVoiceMessage(attachment.url, mimeType);
            } catch (err) {
                console.error('[voice] transcription failed:', err);
                await ch.send(`<@${message.author.id}> 音声の処理に失敗しました。もう一度お試しください。`);
                return;
            }

            // 2. 意図確認メッセージを送信
            await ch.send(`<@${message.author.id}> 「${intent}」ということですね？実行してよいですか？`);

            // 3. ユーザーの返答を待機（30秒）
            let userReply: string;
            try {
                const collected = await ch.awaitMessages({
                    filter: (m: DiscordMessage) => m.author.id === message.author.id,
                    max: 1,
                    time: VOICE_CONFIRM_TIMEOUT_MS,
                    errors: ['time'],
                });
                userReply = collected.first()?.content ?? '';
            } catch {
                // タイムアウト
                await ch.send(`<@${message.author.id}> 確認がなかったためキャンセルしました。`);
                return;
            }

            // 4. 確認またはキャンセルを判定して処理
            if (isConfirm(userReply) && !isCancel(userReply)) {
                if ('sendTyping' in ch) await ch.sendTyping();
                try {
                    const senderName = message.author.displayName ?? message.author.username;
                    const response = await processAgentMessage(intent, [], senderName, message.channelId);
                    const truncated = response.length > 1990 ? response.slice(0, 1990) + '…' : response;
                    await ch.send(`<@${message.author.id}> ${truncated}`);
                } catch (err: any) {
                    console.error('[voice] processMessage error:', err);
                    const code = err.status ?? err.code ?? 'unknown';
                    await ch.send(`<@${message.author.id}> ⚠️ エラーが発生しました（${code}）。しばらく経ってから再度お試しください。`);
                }
            } else {
                // isCancel または不明な返答
                await ch.send(`<@${message.author.id}> キャンセルしました。`);
            }
        } finally {
            pendingVoiceConfirmations.delete(confirmKey);
        }
    }

    async disconnect(): Promise<void> {
        await this.client.destroy();
        this._connected = false;
    }

    isConnected(): boolean {
        return this._connected;
    }

    async sendMessage(channelId: string, text: string): Promise<void> {
        const ch = this.client.channels.cache.get(channelId);
        if (!ch?.isTextBased()) throw new Error(`Channel ${channelId} not found or not text-based`);
        await (ch as any).send(text);
    }

    async setTyping(channelId: string, isTyping: boolean): Promise<void> {
        if (!isTyping) return;
        const ch = this.client.channels.cache.get(channelId);
        if (ch?.isTextBased() && 'sendTyping' in ch) {
            await (ch as any).sendTyping();
        }
    }

    ownsChannel(channelId: string): boolean {
        return this.client.channels.cache.has(channelId);
    }

    getBotId(): string {
        return this.client.user?.id ?? '';
    }

    isMentioned(content: string): boolean {
        const botId = this.getBotId();
        return botId !== '' && content.includes(`<@${botId}>`);
    }
}
