import { Client, GatewayIntentBits } from 'discord.js';
import type { Message as DiscordMessage, Attachment } from 'discord.js';

import { type Message } from '../db.js';
import { type Channel, type OnMessageCallback } from './types.js';
import { processMessage as processAgentMessage } from '../agent.js';
import { transcribeVoiceMessage } from '../voice.js';

// --- Voice confirmation helpers ---

const CONFIRM_KEYWORDS = ['はい', 'yes', 'ok', 'おk', '実行', 'やって', '進めて', 'いいよ', 'そう', 'そうです', '正しい', '合ってる', 'もちろん', 'お願い'];
const CANCEL_KEYWORDS = ['いいえ', 'no', 'キャンセル', 'やめて', '違う', 'やめます', '中止'];
const AMBIGUOUS_KEYWORDS = ['大丈夫', 'どうぞ', 'まあ', 'いいんじゃない', 'かな'];
const VOICE_CONFIRM_TIMEOUT_MS = 60_000;
const MAX_AMBIGUOUS_RETRIES = 2;

function isConfirm(text: string): boolean {
    const t = text.trim().toLowerCase();
    return CONFIRM_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}

function isCancel(text: string): boolean {
    const t = text.trim().toLowerCase();
    return CANCEL_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}

function isAmbiguous(text: string): boolean {
    const t = text.trim().toLowerCase();
    return AMBIGUOUS_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
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
        const mention = `<@${message.author.id}>`;
        const senderName = message.author.displayName ?? message.author.username;

        try {
            if ('sendTyping' in ch) await ch.sendTyping();

            // 1. 音声を Gemini で解析して意図とアクション有無を取得
            const mimeType = attachment.contentType ?? 'audio/ogg';
            let analysis: { intent: string; hasAction: boolean };
            try {
                analysis = await transcribeVoiceMessage(attachment.url, mimeType);
            } catch (err) {
                console.error('[voice] transcription failed:', err);
                await ch.send(`${mention} 音声の処理に失敗しました。もう一度お試しください。`);
                return;
            }

            const { intent, hasAction } = analysis;

            // 2. アクション意図なし → 確認なしでそのままテキスト会話として処理
            if (!hasAction) {
                if ('sendTyping' in ch) await ch.sendTyping();
                try {
                    const response = await processAgentMessage(intent, [], senderName, message.channelId);
                    const truncated = response.length > 1990 ? response.slice(0, 1990) + '…' : response;
                    await ch.send(`${mention} ${truncated}`);
                } catch (err: any) {
                    console.error('[voice] processMessage error:', err);
                    const code = err.status ?? err.code ?? 'unknown';
                    await ch.send(`${mention} ⚠️ エラーが発生しました（${code}）。しばらく経ってから再度お試しください。`);
                }
                return;
            }

            // 3. アクション意図あり → 意図確認メッセージを送信
            await ch.send(`${mention} 「${intent}」ということですね？実行してよいですか？`);

            // 4. 確認待ちループ（最大 MAX_AMBIGUOUS_RETRIES 回まで再確認）
            let ambiguousCount = 0;
            while (true) {
                // ユーザーの返答を待機（テキストまたは音声）
                let replyMsg: DiscordMessage | undefined;
                try {
                    const collected = await ch.awaitMessages({
                        filter: (m: DiscordMessage) =>
                            m.author.id === message.author.id &&
                            (m.content.trim() !== '' || m.attachments.some((a: Attachment) => a.contentType?.startsWith('audio/'))),
                        max: 1,
                        time: VOICE_CONFIRM_TIMEOUT_MS,
                        errors: ['time'],
                    });
                    replyMsg = collected.first();
                } catch {
                    // タイムアウト
                    await ch.send(`${mention} 確認がなかったためキャンセルしました。`);
                    return;
                }

                // 返答テキストを取得（音声の場合は Gemini でテキスト化）
                let replyText = replyMsg?.content ?? '';
                if (replyText === '') {
                    const audioAtt = replyMsg?.attachments.find((a: Attachment) => a.contentType?.startsWith('audio/'));
                    if (audioAtt) {
                        try {
                            const replyAnalysis = await transcribeVoiceMessage(audioAtt.url, audioAtt.contentType ?? 'audio/ogg');
                            replyText = replyAnalysis.intent;
                        } catch {
                            replyText = '';
                        }
                    }
                }

                // 確認・キャンセル・曖昧を判定
                if (isConfirm(replyText) && !isCancel(replyText)) {
                    // 実行
                    if ('sendTyping' in ch) await ch.sendTyping();
                    try {
                        const response = await processAgentMessage(intent, [], senderName, message.channelId);
                        const truncated = response.length > 1990 ? response.slice(0, 1990) + '…' : response;
                        await ch.send(`${mention} ${truncated}`);
                    } catch (err: any) {
                        console.error('[voice] processMessage error:', err);
                        const code = err.status ?? err.code ?? 'unknown';
                        await ch.send(`${mention} ⚠️ エラーが発生しました（${code}）。しばらく経ってから再度お試しください。`);
                    }
                    return;
                }

                if (isCancel(replyText)) {
                    await ch.send(`${mention} キャンセルしました。`);
                    return;
                }

                // 曖昧な返答
                ambiguousCount++;
                if (ambiguousCount >= MAX_AMBIGUOUS_RETRIES) {
                    await ch.send(`${mention} キャンセルしました。`);
                    return;
                }
                await ch.send(`${mention} 「はい」か「いいえ」でお答えください。`);
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
