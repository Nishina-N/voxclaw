import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export interface VoiceAnalysis {
    /** 音声の内容を日本語一文で表した意図テキスト */
    intent: string;
    /** ファイル操作・検索・実行など何らかのアクションを要求しているか */
    hasAction: boolean;
}

/**
 * 確認フロー専用：音声をそのまま文字起こしして返す（intent への言い換えは行わない）。
 * 「はい」と言えば「はい」が返る。
 */
export async function transcribeAudioText(audioUrl: string, mimeType: string): Promise<string> {
    const tmpPath = path.join('/tmp', `voice-confirm-${crypto.randomBytes(8).toString('hex')}`);

    try {
        const resp = await fetch(audioUrl);
        if (!resp.ok) throw new Error(`Failed to download audio: ${resp.status}`);
        const buffer = Buffer.from(await resp.arrayBuffer());
        await fs.writeFile(tmpPath, buffer);

        const uploaded = await ai.files.upload({
            file: tmpPath,
            config: { mimeType, displayName: 'voice_confirm' },
        });

        if (!uploaded.uri) throw new Error('File upload failed: no URI returned');

        const result = await ai.models.generateContent({
            model,
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            fileData: {
                                fileUri: uploaded.uri,
                                mimeType: uploaded.mimeType ?? mimeType,
                            },
                        },
                        {
                            text: 'この音声の発言内容をそのまま文字起こしてください。言い換えや要約は不要です。話者が話した言葉をそのまま書いてください。文字起こし結果のみを返してください。',
                        },
                    ],
                },
            ],
        });

        return result.text?.trim() ?? '';
    } finally {
        await fs.unlink(tmpPath).catch(() => {});
    }
}

/**
 * Discord のボイスメッセージを Gemini File API に渡して
 * 意図テキストとアクション有無を返す。
 */
export async function transcribeVoiceMessage(audioUrl: string, mimeType: string): Promise<VoiceAnalysis> {
    const tmpPath = path.join('/tmp', `voice-${crypto.randomBytes(8).toString('hex')}`);

    try {
        // 1. 音声ファイルをダウンロード
        const resp = await fetch(audioUrl);
        if (!resp.ok) throw new Error(`Failed to download audio: ${resp.status}`);
        const buffer = Buffer.from(await resp.arrayBuffer());
        await fs.writeFile(tmpPath, buffer);

        // 2. Gemini File API にアップロード
        const uploaded = await ai.files.upload({
            file: tmpPath,
            config: { mimeType, displayName: 'voice_message' },
        });

        if (!uploaded.uri) throw new Error('File upload failed: no URI returned');

        // 3. 意図テキストとアクション有無を一度に取得
        const result = await ai.models.generateContent({
            model,
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            fileData: {
                                fileUri: uploaded.uri,
                                mimeType: uploaded.mimeType ?? mimeType,
                            },
                        },
                        {
                            text: `この音声メッセージを分析して、以下の JSON 形式のみで回答してください（説明不要）。

{
  "intent": "ユーザーの発言内容を日本語一文で要約したテキスト",
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

        // JSON を抽出してパース（```json ... ``` を除去）
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]) as { intent?: string; hasAction?: boolean };
                return {
                    intent: parsed.intent?.trim() || '音声内容を理解できませんでした。',
                    hasAction: parsed.hasAction === true,
                };
            } catch {
                // パース失敗 → フォールバック
            }
        }

        // JSON が取れなかった場合は会話扱い
        return { intent: raw || '音声内容を理解できませんでした。', hasAction: false };
    } finally {
        // 4. 一時ファイルを削除
        await fs.unlink(tmpPath).catch(() => {});
    }
}
