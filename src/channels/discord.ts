import { Client, GatewayIntentBits } from 'discord.js';
import type { Message as DiscordMessage, Attachment } from 'discord.js';

import { type Message } from '../db.js';
import { type Channel, type OnMessageCallback } from './types.js';
import { processMessage as processAgentMessage } from '../agent.js';
import { analyzeVoice, classifyReply, type VoiceAnalysis } from '../voice.js';

const VOICE_CONFIRM_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 5;

// チャンネル+ユーザーごとに確認待ち中フラグを管理
const pendingVoiceConfirmations = new Set<string>();

// ---- ヘルパー関数 ----

/** awaitMessages のラッパー。タイムアウト時は null を返す。 */
async function awaitReply(
    ch: any,
    userId: string,
    timeout: number,
): Promise<DiscordMessage | null> {
    try {
        const collected = await ch.awaitMessages({
            filter: (m: DiscordMessage) =>
                m.author.id === userId &&
                (m.content.trim() !== '' ||
                    m.attachments.some((a: Attachment) => a.contentType?.startsWith('audio/'))),
            max: 1,
            time: timeout,
            errors: ['time'],
        });
        return collected.first() ?? null;
    } catch {
        return null;
    }
}

/** チャンネル直近8件の履歴を取得して整形する。 */
async function fetchContextMessages(ch: any): Promise<string> {
    try {
        const fetched = await ch.messages.fetch({ limit: 8 });
        return ([...fetched.values()] as any[])
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
            .filter((m) => m.content.trim() !== '')
            .map((m) => `${m.author.bot ? 'Bot' : 'User'}：${m.content}`)
            .join('\n');
    } catch (err) {
        console.warn('[voice] failed to fetch channel history:', err);
        return '';
    }
}

/**
 * 返答メッセージからテキストを取得する。
 * 音声添付があれば analyzeVoice を呼んで rawText を返し、生文字起こしをチャンネルに送信する。
 * テキスト返答はそのまま返す。
 */
async function resolveReplyText(reply: DiscordMessage, ch: any): Promise<string> {
    const replyAudioAtt = reply.attachments.find(
        (a: Attachment) => a.contentType?.startsWith('audio/'),
    );
    if (replyAudioAtt) {
        try {
            const replyAnalysis = await analyzeVoice(
                replyAudioAtt.url,
                replyAudioAtt.contentType ?? 'audio/ogg',
            );
            await ch.send(`ユーザー入力：${replyAnalysis.rawText}`);
            return replyAnalysis.rawText;
        } catch {
            return '';
        }
    }
    return reply.content.trim();
}

/** processAgentMessage を呼び出し、結果をチャンネルに送信する。エラー時はエラーメッセージを送信する。 */
async function runAgentAndSend(
    ch: any,
    mention: string,
    intent: string,
    senderName: string,
    channelId: string,
): Promise<void> {
    if ('sendTyping' in ch) await ch.sendTyping();
    try {
        const response = await processAgentMessage(intent, [], senderName, channelId);
        const truncated = response.length > 1990 ? response.slice(0, 1990) + '…' : response;
        await ch.send(`${mention} ${truncated}`);
    } catch (err: any) {
        console.error('[voice] processMessage error:', err);
        const code = err.status ?? err.code ?? 'unknown';
        await ch.send(`${mention} ⚠️ エラーが発生しました（${code}）。しばらく経ってから再度お試しください。`);
    }
}

/** 確認ループ全体（最大 MAX_ATTEMPTS 回）を実行する。 */
async function runConfirmationLoop(
    ch: any,
    mention: string,
    analysis: VoiceAnalysis,
    senderName: string,
    channelId: string,
    userId: string,
): Promise<void> {
    let currentIntent = analysis.intent;

    for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
        await ch.send(`${mention} 「${currentIntent}」ということですね？実行してよいですか？`);

        const reply = await awaitReply(ch, userId, VOICE_CONFIRM_TIMEOUT_MS);
        if (!reply) {
            await ch.send(`${mention} 確認がなかったためキャンセルしました。`);
            return;
        }

        const replyText = await resolveReplyText(reply, ch);

        const context = await fetchContextMessages(ch);
        const { result, correctedIntent } = await classifyReply(replyText, context);

        console.log(`[voice confirm] attempt=${attempts + 1} replyText="${replyText}" result=${result}`);

        if (result === 'confirm') {
            await runAgentAndSend(ch, mention, currentIntent, senderName, channelId);
            return;
        }

        if (result === 'cancel') {
            await ch.send(`${mention} キャンセルしました。`);
            return;
        }

        if (result === 'correction') {
            currentIntent = correctedIntent ?? replyText;
            continue;
        }

        // unclear
        await ch.send(`${mention} 「はい」か「いいえ」でお答えください。`);
    }

    await ch.send(`${mention} 確認の上限に達したためキャンセルしました。`);
}

// ----

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

            // 1. 音声解析（rawText / intent / hasAction を1回で取得）
            let analysis: VoiceAnalysis;
            try {
                analysis = await analyzeVoice(attachment.url, attachment.contentType ?? 'audio/ogg');
            } catch (err) {
                console.error('[voice] analysis failed:', err);
                await ch.send(`${mention} 音声の処理に失敗しました。もう一度お試しください。`);
                return;
            }

            // 生文字起こしを先行表示
            await ch.send(`ユーザー入力：${analysis.rawText}`);

            // 2. アクション意図なし → 確認なしでテキスト会話として処理
            if (!analysis.hasAction) {
                await runAgentAndSend(ch, mention, analysis.intent, senderName, message.channelId);
                return;
            }

            // 3. アクション意図あり → 確認フロー（最大 MAX_ATTEMPTS 回）
            await runConfirmationLoop(ch, mention, analysis, senderName, message.channelId, message.author.id);
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
