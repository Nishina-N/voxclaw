import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

export interface AudioSession {
    sendAudio(pcm16: Buffer): void;
    end(): Promise<string>;
}

/**
 * Opens a Gemini Native Audio Dialog session.
 * Accumulates audio chunks, then on end() closes the session and returns
 * the full transcribed/summarized text to forward to Gemiclaw.
 */
export async function createAudioSession(): Promise<AudioSession> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const textParts: string[] = [];
    let resolveEnd: ((text: string) => void) | null = null;

    const session = await ai.live.connect({
        model: MODEL,
        callbacks: {
            onopen: () => {
                console.log('[gemini] session opened');
            },
            onmessage: (msg: any) => {
                const parts = msg?.serverContent?.modelTurn?.parts ?? [];
                for (const part of parts) {
                    if (part.text) textParts.push(part.text);
                }
                if (msg?.serverContent?.turnComplete && resolveEnd) {
                    const text = textParts.join('').trim() || '（音声を聞き取れませんでした）';
                    resolveEnd(text);
                    resolveEnd = null;
                    session.close();
                }
            },
            onerror: (e: any) => {
                console.error('[gemini] error:', e?.message ?? e);
            },
            onclose: (e: any) => {
                console.log('[gemini] session closed:', e?.reason);
                if (resolveEnd) {
                    resolveEnd(textParts.join('').trim() || '（音声を聞き取れませんでした）');
                    resolveEnd = null;
                }
            },
        },
        config: {
            responseModalities: [Modality.TEXT],
            systemInstruction: {
                parts: [{
                    text: 'You are a voice input assistant. Listen to the user\'s speech and produce a clear, concise text summary of what they said in Japanese. Output only the summary text, nothing else.',
                }],
            },
        },
    });

    return {
        sendAudio(pcm16: Buffer) {
            session.sendRealtimeInput({
                audio: {
                    data: pcm16.toString('base64'),
                    mimeType: 'audio/pcm;rate=16000',
                },
            });
        },

        async end(): Promise<string> {
            return new Promise<string>((resolve) => {
                resolveEnd = resolve;
                session.sendClientContent({ turns: [], turnComplete: true });
                // 5秒のタイムアウト
                setTimeout(() => {
                    if (resolveEnd) {
                        resolveEnd = null;
                        resolve(textParts.join('').trim() || '（音声を聞き取れませんでした）');
                        session.close();
                    }
                }, 5000);
            });
        },
    };
}
