import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export interface VoiceAnalysis {
    /** 発話をそのまま文字起こしたテキスト */
    rawText: string;
    /** 整理された意図（日本語一文） */
    intent: string;
    /** ファイル操作・検索・実行など何らかの操作を要求しているか */
    hasAction: boolean;
}

export type ConfirmResult = 'confirm' | 'cancel' | 'correction' | 'unclear';

// ---- 内部ヘルパー ----

async function uploadAudio(
    audioUrl: string,
    mimeType: string,
    displayName: string,
): Promise<{ uri: string; mimeType: string }> {
    const tmpPath = path.join('/tmp', `voice-${crypto.randomBytes(8).toString('hex')}`);
    try {
        const resp = await fetch(audioUrl);
        if (!resp.ok) throw new Error(`Failed to download audio: ${resp.status}`);
        const buffer = Buffer.from(await resp.arrayBuffer());
        await fs.writeFile(tmpPath, buffer);

        const uploaded = await ai.files.upload({
            file: tmpPath,
            config: { mimeType, displayName },
        });
        if (!uploaded.uri) throw new Error('File upload failed: no URI returned');
        return { uri: uploaded.uri, mimeType: uploaded.mimeType ?? mimeType };
    } finally {
        await fs.unlink(tmpPath).catch(() => {});
    }
}

// ---- 公開 API ----

/**
 * 音声を1回のGemini呼び出しで解析し、rawText / intent / hasAction を返す。
 * 最初の音声入力と確認フロー内の音声返答の両方で使う。
 */
export async function analyzeVoice(audioUrl: string, mimeType: string): Promise<VoiceAnalysis> {
    const file = await uploadAudio(audioUrl, mimeType, 'voice_message');

    const result = await ai.models.generateContent({
        model,
        contents: [
            {
                role: 'user',
                parts: [
                    { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
                    {
                        text: `この音声メッセージを分析して、以下の JSON 形式のみで回答してください（説明不要）。

{
  "rawText": "音声の発言内容をそのまま文字起こしたテキスト",
  "intent": "ユーザーの意図を日本語一文で要約したテキスト",
  "hasAction": true または false
}

hasAction の判定基準：
- true: ファイル操作・検索・実行・作成・送信・計算など何らかの操作・タスクを要求している
- false: 雑談・質問・感想・挨拶など、操作を伴わない会話`,
                    },
                ],
            },
        ],
    });

    const raw = result.text?.trim() ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]) as {
                rawText?: string;
                intent?: string;
                hasAction?: boolean;
            };
            return {
                rawText: parsed.rawText?.trim() || raw,
                intent: parsed.intent?.trim() || raw,
                hasAction: parsed.hasAction === true,
            };
        } catch { /* fall through */ }
    }
    return { rawText: raw, intent: raw, hasAction: false };
}

/**
 * 確認フロー中のユーザー返答をGeminiで分類する。
 * confirm / cancel / correction / unclear のいずれかと、
 * correction の場合は修正後の intent を返す。
 */
export async function classifyReply(
    replyText: string,
    contextMessages: string,
): Promise<{ result: ConfirmResult; correctedIntent?: string }> {
    const result = await ai.models.generateContent({
        model,
        contents: [
            {
                role: 'user',
                parts: [
                    {
                        text: `以下はDiscordチャンネルの直近の会話履歴です：
${contextMessages}

ユーザーの返答：「${replyText}」

この返答を以下の4つに分類し、JSON形式のみで回答してください（説明不要）。

{
  "result": "confirm" | "cancel" | "correction" | "unclear",
  "correctedIntent": "修正後の新しい指示内容（result が correction の場合のみ）"
}

分類基準：
- confirm: 実行に同意している（「はい」「OK」「了解」など）
- cancel: 取りやめを希望している（「いいえ」「キャンセル」「やめて」など）
- correction: 内容を修正・変更しようとしている（別の指示・「違う」「〇〇にして」など）
- unclear: 上記のどれにも明確に当てはまらない曖昧な返答`,
                    },
                ],
            },
        ],
    });

    const raw = result.text?.trim() ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]) as { result?: string; correctedIntent?: string };
            const validResults: ConfirmResult[] = ['confirm', 'cancel', 'correction', 'unclear'];
            const r = parsed.result as ConfirmResult;
            if (validResults.includes(r)) {
                return { result: r, correctedIntent: parsed.correctedIntent?.trim() };
            }
        } catch { /* fall through */ }
    }
    return { result: 'unclear' };
}
