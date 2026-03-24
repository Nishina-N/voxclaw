import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

export interface AudioSession {
    sendAudio(pcm16: Buffer): void;
    end(): Promise<string>;
}

/**
 * Opens a Gemini Native Audio session.
 * Streams PCM audio in, then on end() signals audioStreamEnd and waits for
 * inputAudioTranscription to arrive, returning the transcribed text.
 */
export async function createAudioSession(): Promise<AudioSession> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const transcriptParts: string[] = [];
    let resolveEnd: ((text: string) => void) | null = null;

    const session = await ai.live.connect({
        model: MODEL,
        callbacks: {
            onopen: () => {
                console.log('[gemini] session opened');
            },
            onmessage: (msg: any) => {
                // Input transcription: user's spoken words
                const inputText = msg?.serverContent?.inputTranscription?.text;
                if (inputText) transcriptParts.push(inputText);

                // Fallback: text parts in model turn
                const parts = msg?.serverContent?.modelTurn?.parts ?? [];
                for (const part of parts) {
                    if (part.text) transcriptParts.push(part.text);
                }

                if (msg?.serverContent?.turnComplete && resolveEnd) {
                    const text = transcriptParts.join('').trim() || '（音声を聞き取れませんでした）';
                    resolveEnd(text);
                    resolveEnd = null;
                    try { session.close(); } catch {}
                }
            },
            onerror: (e: any) => {
                console.error('[gemini] error:', e?.message ?? e);
            },
            onclose: (e: any) => {
                console.log('[gemini] session closed:', e?.reason);
                if (resolveEnd) {
                    resolveEnd(transcriptParts.join('').trim() || '（音声を聞き取れませんでした）');
                    resolveEnd = null;
                }
            },
        },
        config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
        } as any,
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
                session.sendRealtimeInput({ audioStreamEnd: true });
                // 10秒のタイムアウト
                setTimeout(() => {
                    if (resolveEnd) {
                        resolveEnd = null;
                        resolve(transcriptParts.join('').trim() || '（音声を聞き取れませんでした）');
                        try { session.close(); } catch {}
                    }
                }, 10000);
            });
        },
    };
}
