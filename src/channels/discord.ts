import { Client, GatewayIntentBits } from 'discord.js';
import type { Message as DiscordMessage, Attachment } from 'discord.js';

import { type Message } from '../db.js';
import { type Channel, type OnMessageCallback } from './types.js';
import { processMessage as processAgentMessage } from '../agent.js';
import { transcribeVoiceMessage, transcribeAudioText, transcribeAudioWithContext } from '../voice.js';

// --- Voice confirmation helpers ---

const CONFIRM_KEYWORDS = [
    'はい', 'ハイ', 'うん', 'うんうん', 'そう', 'そうです', 'そうして',
    'yes', 'ok', 'おk', 'オーケー',
    '実行', 'やって', 'やる', '進めて', 'いいよ', 'いいです', 'いいですよ',
    '正しい', '合ってる', 'もちろん', 'お願い', '了解', 'わかった', 'わかりました',
    'ええ', 'ゆえに', '承認',
];
// 「違う」は「違う、△△で」のような修正intentを含む場合があるため除外
const CANCEL_KEYWORDS = ['いいえ', 'no', 'キャンセル', 'やめて', 'やめます', '中止'];
// 曖昧な返答（修正intentとは別に再確認を促す）
const AMBIGUOUS_KEYWORDS = ['大丈夫', 'どうぞ', 'まあ', 'いいんじゃない', 'かな'];
const VOICE_CONFIRM_TIMEOUT_MS = 60_000;
const MAX_AMBIGUOUS_RETRIES = 2;
const MAX_CORRECTION_RETRIES = 3;

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

            // 1. 意図+アクション判定 と 生文字起こし を並行取得
            const mimeType = attachment.contentType ?? 'audio/ogg';
            let analysis: { intent: string; hasAction: boolean };
            let rawText: string;
            try {
                [analysis, rawText] = await Promise.all([
                    transcribeVoiceMessage(attachment.url, mimeType),
                    transcribeAudioText(attachment.url, mimeType),
                ]);
            } catch (err) {
                console.error('[voice] transcription failed:', err);
                await ch.send(`${mention} 音声の処理に失敗しました。もう一度お試しください。`);
                return;
            }

            // 解析直後・処理開始前に生文字起こしを投稿
            await ch.send(`ユーザー入力：${rawText}`);

            // currentIntent は確認フロー内で修正される可能性があるため let で保持
            let currentIntent = analysis.intent;
            const { hasAction } = analysis;

            // 2. アクション意図なし → 確認なしでそのままテキスト会話として処理
            if (!hasAction) {
                if ('sendTyping' in ch) await ch.sendTyping();
                try {
                    const response = await processAgentMessage(currentIntent, [], senderName, message.channelId);
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
            await ch.send(`${mention} 「${currentIntent}」ということですね？実行してよいですか？`);

            // 4. 確認待ちループ
            let ambiguousCount = 0;
            let correctionCount = 0;

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

                // null チェック：収集されたはずだが念のため
                if (!replyMsg) {
                    await ch.send(`${mention} 確認がなかったためキャンセルしました。`);
                    return;
                }

                // 返答テキストを取得
                // 音声の場合は transcribeAudioText（言い換えなし文字起こし）を使う
                let replyText = replyMsg.content.trim();
                if (replyText === '') {
                    const audioAtt = replyMsg.attachments.find((a: Attachment) => a.contentType?.startsWith('audio/'));
                    if (audioAtt) {
                        try {
                            replyText = await transcribeAudioText(audioAtt.url, audioAtt.contentType ?? 'audio/ogg');
                        } catch {
                            replyText = '';
                        }
                    }
                }

                console.log(`[voice confirm] replyText="${replyText}" isConfirm=${isConfirm(replyText)} isCancel=${isCancel(replyText)} isAmbiguous=${isAmbiguous(replyText)}`);

                // --- 判定 ---

                // 確認
                if (isConfirm(replyText) && !isCancel(replyText)) {
                    if ('sendTyping' in ch) await ch.sendTyping();
                    try {
                        const response = await processAgentMessage(currentIntent, [], senderName, message.channelId);
                        const truncated = response.length > 1990 ? response.slice(0, 1990) + '…' : response;
                        await ch.send(`${mention} ${truncated}`);
                    } catch (err: any) {
                        console.error('[voice] processMessage error:', err);
                        const code = err.status ?? err.code ?? 'unknown';
                        await ch.send(`${mention} ⚠️ エラーが発生しました（${code}）。しばらく経ってから再度お試しください。`);
                    }
                    return;
                }

                // キャンセル
                if (isCancel(replyText)) {
                    await ch.send(`${mention} キャンセルしました。`);
                    return;
                }

                // 曖昧（はい/いいえのどちらとも取れない短い返答）
                if (isAmbiguous(replyText)) {
                    ambiguousCount++;
                    if (ambiguousCount >= MAX_AMBIGUOUS_RETRIES) {
                        await ch.send(`${mention} キャンセルしました。`);
                        return;
                    }
                    await ch.send(`${mention} 「はい」か「いいえ」でお答えください。`);
                    continue;
                }

                // 修正intent：yes/no/曖昧のいずれにも当てはまらない返答を新しい指示として扱う
                correctionCount++;
                if (correctionCount > MAX_CORRECTION_RETRIES) {
                    await ch.send(`${mention} 修正回数の上限に達したためキャンセルしました。`);
                    return;
                }

                // チャンネル直近8件の履歴を取得してコンテキストを構築
                let contextText = '';
                try {
                    const fetched = await ch.messages.fetch({ limit: 8 });
                    contextText = ([...fetched.values()] as any[])
                        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                        .filter((m) => m.content.trim() !== '')
                        .map((m) => `${m.author.bot ? 'Bot' : 'User'}：${m.content}`)
                        .join('\n');
                } catch (err) {
                    console.warn('[voice correction] failed to fetch channel history:', err);
                }

                // 音声修正 → コンテキスト付き文字起こし、テキスト修正 → そのまま使用
                const correctionAudioAtt = replyMsg.attachments.find(
                    (a: Attachment) => a.contentType?.startsWith('audio/'),
                );
                let newIntent: string;
                if (correctionAudioAtt) {
                    try {
                        newIntent = await transcribeAudioWithContext(
                            correctionAudioAtt.url,
                            correctionAudioAtt.contentType ?? 'audio/ogg',
                            contextText,
                        );
                    } catch (err) {
                        console.warn('[voice correction] transcribeAudioWithContext failed, falling back to raw text:', err);
                        newIntent = replyText;
                    }
                } else {
                    newIntent = replyText;
                }

                currentIntent = newIntent;
                await ch.send(`ユーザー入力（修正）：${currentIntent}`);
                await ch.send(`${mention} 「${currentIntent}」ということですね？実行してよいですか？`);
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
