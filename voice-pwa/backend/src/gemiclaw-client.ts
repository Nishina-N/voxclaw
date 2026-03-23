const GEMICLAW_URL = process.env.GEMICLAW_API_URL ?? 'http://gemiclaw:3001';

export async function sendToGemiclaw(text: string, sender = 'voice-user'): Promise<string> {
    const res = await fetch(`${GEMICLAW_URL}/api/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sender }),
    });

    if (!res.ok) {
        throw new Error(`Gemiclaw API error: ${res.status}`);
    }

    const data = await res.json() as { reply: string };
    return data.reply;
}
