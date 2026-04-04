import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = process.env.VOICE_GEMINI_MODEL ?? 'gemini-2.5-flash-native-audio-preview-12-2025';

export type IntentMode = 'standard' | 'faithful';

// Standard mode: Gemini interprets intent, calls report_intent mid-speech (draft) and after (final).
// inputTranscription is used internally but NOT forwarded to the UI in this mode.
const SYSTEM_INSTRUCTION_STANDARD = `あなたは音声アシスタントです。必ず日本語で応答してください。

ユーザーの発言を聞きながら、以下のルールで report_intent を積極的に呼び出してください：

1. 発話の途中でも意図が推測できた時点で、is_final: false として呼び出す（暫定）
2. 発話が完全に終わった後、確定した意図を is_final: true として呼び出す（最終）
3. 途中で意図が変わった・より明確になった場合もその都度呼び出す

各フィールドの書き方：
- intent: ユーザーが何をしたいか/してほしいかを簡潔に（動詞＋対象を必ず含める）
- context: 解釈の根拠・背景・前提条件・曖昧な点があれば記述する（なければ空文字列）
- is_final: 発話途中の暫定推測は false、発話完了後の確定は true

ユーザーとは自然な日本語で会話してください。`;

// Faithful mode: transcription is shown as-is, no interpretation.
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
    onIntent: (text: string, isFinal: boolean, context?: string) => void,
    mode: IntentMode = 'standard',
    languageCode?: string,
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
                // Capture user speech transcription (fires once after speech ends).
                // In faithful mode: forward immediately as the display.
                // In standard mode: store internally to verify/supplement intent.
                const transcript = msg?.serverContent?.inputTranscription;
                if (transcript?.text) {
                    latestTranscript = transcript.text;
                    if (mode === 'faithful') {
                        onIntent(latestTranscript, true);
                    }
                    // Standard mode: not forwarded — Gemini's report_intent is used instead
                }

                // Function calling: report_intent
                const calls: any[] = msg?.toolCall?.functionCalls ?? [];
                for (const call of calls) {
                    if (call.name === 'report_intent' && call.args?.intent) {
                        if (mode === 'faithful') {
                            // Faithful mode: prefer full transcription over Gemini's summary
                            const intentText = latestTranscript || call.args.intent;
                            console.log('[gemini] intent (faithful):', intentText);
                            onIntent(intentText, true);
                        } else {
                            // Standard mode: use Gemini's interpretation with context
                            const isFinal: boolean = call.args.is_final !== false; // default true if not provided
                            const intentText: string = call.args.intent;
                            const context: string | undefined = call.args.context || undefined;
                            console.log(`[gemini] intent (${isFinal ? 'final' : 'draft'}):`, intentText, context ? `| ctx: ${context}` : '');
                            onIntent(intentText, isFinal, context);
                        }

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
            inputAudioTranscription: languageCode ? { languageCode } : {},
            tools: [{
                functionDeclarations: [{
                    name: 'report_intent',
                    description: mode === 'faithful'
                        ? 'ユーザーの発言の意図が把握できたら呼び出す。'
                        : '発話途中・発話後にユーザーの意図を報告する。暫定(is_final:false)と確定(is_final:true)の2回呼ぶこと。',
                    parameters: {
                        type: 'object',
                        properties: {
                            intent: {
                                type: 'string',
                                description: mode === 'faithful'
                                    ? 'ユーザーの発言を忠実に反映した意図。条件節・否定・背景・複数依頼をすべて保持すること。要約・省略しない。'
                                    : 'ユーザーが何をしたいか/してほしいかの簡潔な説明（動詞＋対象を含む）',
                            },
                            ...(mode === 'standard' ? {
                                context: {
                                    type: 'string',
                                    description: '解釈の根拠・背景・前提条件・曖昧な点。なければ空文字列。',
                                },
                                is_final: {
                                    type: 'boolean',
                                    description: '発話途中の暫定推測はfalse、発話完了後の確定はtrue',
                                },
                            } : {}),
                        },
                        required: mode === 'standard' ? ['intent', 'is_final'] : ['intent'],
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
