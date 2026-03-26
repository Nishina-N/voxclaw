const VOXCLAW_URL = process.env.VOXCLAW_API_URL ?? 'http://voxclaw:3001';

export async function sendToVoxclaw(text: string, sender = 'voice-user'): Promise<string> {
    const res = await fetch(`${VOXCLAW_URL}/api/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sender }),
    });

    if (!res.ok) {
        throw new Error(`Voxclaw API error: ${res.status}`);
    }

    const data = await res.json() as { reply: string };
    return data.reply;
}
