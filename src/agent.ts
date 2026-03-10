import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runInSandbox } from './sandbox.js';
import { readMemory, writeMemory } from './memory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

async function loadSystemInstructions(): Promise<string> {
    const files = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'IDENTITY.md'];
    let instructions = '';
    for (const file of files) {
        try {
            const content = await fs.readFile(path.join(__dirname, '..', file), 'utf-8');
            instructions += content + '\n\n';
        } catch (error) {
            console.warn(`Could not read ${file}:`, error);
        }
    }
    return instructions;
}

export async function processMessage(userMessage: string): Promise<string> {
    const systemInstruction = await loadSystemInstructions();
    
    // Minimal Gemini setup using GoogleGenAI. 
    // In a real app, you'd maintain a chat session or array of messages.
    // For nanoclaw/gemiclaw minimalism, we'll do a one-shot or short-history approach.
    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: userMessage,
            config: {
                systemInstruction: systemInstruction,
                // A complete implementation would define tools here and handle tool calls.
                // For this minimal scaffold, we will demonstrate the setup.
            }
        });
        
        return response.text || "No response generated.";
    } catch (e: any) {
        console.error("Agent error:", e);
        return `Error: ${e.message}`;
    }
}
