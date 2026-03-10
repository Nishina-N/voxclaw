import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { type Message } from './db.js';
import { runInSandbox } from './sandbox.js';
import { readMemory, writeMemory } from './memory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';

async function loadSystemInstructions(): Promise<string> {
    const files = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'IDENTITY.md'];
    let instructions = '';
    for (const file of files) {
        try {
            const content = await fs.readFile(path.join(__dirname, '..', file), 'utf-8');
            instructions += content + '\n\n';
        } catch {
            // File is optional — skip if missing
        }
    }
    return instructions;
}

function formatHistory(history: Message[]): string {
    if (history.length === 0) return '';
    const lines = history.map((m) =>
        m.is_bot ? `gemiclaw: ${m.content}` : `${m.sender_name}: ${m.content}`
    );
    return `[Recent conversation]\n${lines.join('\n')}\n\n`;
}

export async function processMessage(
    userMessage: string,
    history: Message[] = [],
    senderName = 'User',
): Promise<string> {
    const systemInstruction = await loadSystemInstructions();

    // Prepend formatted history so the model has conversational context
    const fullMessage = formatHistory(history) + `${senderName}: ${userMessage}`;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: fullMessage,
            config: { systemInstruction },
        });
        return response.text || 'No response generated.';
    } catch (e: any) {
        console.error('[agent] error:', e);
        return `Error: ${e.message}`;
    }
}
