import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = 'gemini-2.5-flash-preview-native-audio-dialog';

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

    const session = await ai.live.connect({
        model: MODEL,
        config: {
            responseModalities: [Modality.TEXT],
            systemInstruction: {
                parts: [{
                    text: 'You are a voice input assistant. Listen to the user\'s speech and produce a clear, concise text summary of what they said in Japanese. Output only the summary text, nothing else.',
                }],
            },
        },
    });

    const chunks: Buffer[] = [];
    const textParts: string[] = [];

    session.on('message', (msg: any) => {
        const parts = msg?.serverContent?.modelTurn?.parts ?? [];
        for (const part of parts) {
            if (part.text) textParts.push(part.text);
        }
    });

    return {
        sendAudio(pcm16: Buffer) {
            chunks.push(pcm16);
            session.sendRealtimeInput({
                audio: {
                    data: pcm16.toString('base64'),
                    mimeType: 'audio/pcm;rate=16000',
                },
            });
        },

        async end(): Promise<string> {
            // Signal end of turn and wait briefly for final response
            session.sendClientContent({ turns: [], turnComplete: true });

            await new Promise((resolve) => setTimeout(resolve, 3000));
            session.close();

            return textParts.join('').trim() || '（音声を聞き取れませんでした）';
        },
    };
}
