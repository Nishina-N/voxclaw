import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

/**
 * Discord のボイスメッセージ（音声添付ファイル）を Gemini File API に渡して
 * ユーザーの意図を日本語で返す。
 */
export async function transcribeVoiceMessage(audioUrl: string, mimeType: string): Promise<string> {
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

        // 3. Gemini に音声内容を理解させて意図を取得
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
                            text: 'この音声メッセージを聞いて、ユーザーが何をしたいのか日本語で簡潔に一文で説明してください。「〜したい」「〜してほしい」という形式で答えてください。説明文のみを返してください。',
                        },
                    ],
                },
            ],
        });

        return result.text?.trim() || '音声内容を理解できませんでした。';
    } finally {
        // 4. 一時ファイルを削除
        await fs.unlink(tmpPath).catch(() => {});
    }
}
