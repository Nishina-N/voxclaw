import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = process.env.VOICE_GEMINI_MODEL ?? 'gemini-2.5-flash-native-audio-preview-12-2025';

export type IntentMode = 'standard' | 'faithful';

const SYSTEM_INSTRUCTION_STANDARD = `あなたは音声アシスタントです。必ず日本語で応答してください。

ユーザーの発言を聞いて、何をしたいのか意図が把握できたら、できるだけ早く report_intent 関数を呼び出してください。
意図が変わったり、より詳細になった場合も再度 report_intent を呼び出してください。

ユーザーとは自然な日本語で会話してください。`;

const SYSTEM_INSTRUCTION_FAITHFUL = `あなたは音声アシスタントです。必ず日本語で応答してください。

ユーザーの発言を聞いて、意図が把握できたら report_intent 関数を呼び出してください。

【重要】report_intent の intent フィールドに記述するとき：
- ユーザーの発言をできるだけ忠実に反映すること
- 条件節（「〇〇ではないので」「〇〇だから」「〇〇の場合」）を省略しない
- 否定表現（「〇〇ではなく」「〇〇しないで」）を省略しない
- 複数の依頼がある場合はすべて列挙する
- 背景・理由・文脈をそのまま保持する
- 要約・圧縮・言い換えをしない

ユーザーとは自然な日本語で会話してください。`;

export interface GeminiLiveSession {
    sendAudio(pcm16: Buffer): void;
    endTurn(): void;
    close(): void;
}

export async function createLiveSession(
    onIntent: (intent: string) => void,
    mode: IntentMode = 'standard',
): Promise<GeminiLiveSession> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const systemInstruction = mode === 'faithful'
        ? SYSTEM_INSTRUCTION_FAITHFUL
        : SYSTEM_INSTRUCTION_STANDARD;

    let latestTranscript = '';

    const session = await ai.live.connect({
        model: MODEL,
        callbacks: {
            onopen: () => {
                console.log('[gemini] session opened, mode:', mode);
            },
            onmessage: (msg: any) => {
                // Debug: log serverContent structure to find correct transcript field
                if (msg?.serverContent) {
                    console.log('[gemini] serverContent keys:', JSON.stringify(Object.keys(msg.serverContent)));
                    if (msg.serverContent.inputTranscript || msg.serverContent.inputTranscription) {
                        console.log('[gemini] transcript data:', JSON.stringify(
                            msg.serverContent.inputTranscript ?? msg.serverContent.inputTranscription
                        ));
                    }
                }

                // Capture real-time transcription and show immediately in both modes.
                const transcript = msg?.serverContent?.inputTranscript
                               ?? msg?.serverContent?.inputTranscription;
                if (transcript?.text) {
                    latestTranscript = transcript.text;
                    onIntent(latestTranscript);
                }

                // Function calling: report_intent
                const calls: any[] = msg?.toolCall?.functionCalls ?? [];
                for (const call of calls) {
                    if (call.name === 'report_intent' && call.args?.intent) {
                        // In faithful mode, prefer full transcription over Gemini's summary
                        const intentText = (mode === 'faithful' && latestTranscript)
                            ? latestTranscript
                            : call.args.intent;
                        console.log('[gemini] intent:', intentText);
                        onIntent(intentText);
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
                    description: mode === 'faithful'
                        ? 'ユーザーの発言の意図が把握できたら呼び出す。'
                        : 'ユーザーの意図が把握できたらすぐに呼び出す。意図が更新されるたびに再度呼び出す。',
                    parameters: {
                        type: 'object',
                        properties: {
                            intent: {
                                type: 'string',
                                description: mode === 'faithful'
                                    ? 'ユーザーの発言を忠実に反映した意図。条件節・否定・背景・複数依頼をすべて保持すること。要約・省略しない。'
                                    : 'ユーザーが行いたいことの簡潔な説明（日本語）',
                            },
                        },
                        required: ['intent'],
                    },
                }],
            }],
            systemInstruction: {
                parts: [{ text: systemInstruction }],
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
