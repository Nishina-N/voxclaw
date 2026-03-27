import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = process.env.VOICE_GEMINI_MODEL ?? 'gemini-2.5-flash-native-audio-preview-12-2025';

const SYSTEM_INSTRUCTION = `あなたは音声アシスタントです。必ず日本語で応答してください。

ユーザーの発言を聞いて、何をしたいのか意図が把握できたら、できるだけ早く report_intent 関数を呼び出してください。
意図が変わったり、より詳細になった場合も再度 report_intent を呼び出してください。

ユーザーとは自然な日本語で会話してください。`;

export interface GeminiLiveSession {
    sendAudio(pcm16: Buffer): void;
    endTurn(): void;
    close(): void;
}

export async function createLiveSession(
    onIntent: (intent: string) => void,
): Promise<GeminiLiveSession> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const session = await ai.live.connect({
        model: MODEL,
        callbacks: {
            onopen: () => {
                console.log('[gemini] session opened');
            },
            onmessage: (msg: any) => {
                // Function calling: report_intent
                const calls: any[] = msg?.toolCall?.functionCalls ?? [];
                for (const call of calls) {
                    if (call.name === 'report_intent' && call.args?.intent) {
                        console.log('[gemini] intent:', call.args.intent);
                        onIntent(call.args.intent);
                        // Acknowledge tool call (sendToolResponse returns void)
                        try {
                            (session as any).sendToolResponse?.({
                                functionResponses: [{
                                    id: call.id,
                                    name: call.name,
                                    response: { result: 'ok' },
                                }],
                            });
                        } catch (e: any) {
                            console.warn('[gemini] toolResponse error:', e?.message);
                        }
                    }
                }
            },
            onerror: (e: any) => {
                console.error('[gemini] error:', e?.message ?? e);
            },
            onclose: (e: any) => {
                console.log('[gemini] session closed:', e?.reason ?? '');
            },
        },
        config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            tools: [{
                functionDeclarations: [{
                    name: 'report_intent',
                    description: 'ユーザーの意図が把握できたらすぐに呼び出す。意図が更新されるたびに再度呼び出す。',
                    parameters: {
                        type: 'object',
                        properties: {
                            intent: {
                                type: 'string',
                                description: 'ユーザーが行いたいことの簡潔な説明（日本語）',
                            },
                        },
                        required: ['intent'],
                    },
                }],
            }],
            systemInstruction: {
                parts: [{ text: SYSTEM_INSTRUCTION }],
            },
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
        endTurn() {
            session.sendRealtimeInput({ audioStreamEnd: true } as any);
        },
        close() {
            try { session.close(); } catch {}
        },
    };
}
