import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { type Message } from './db.js';
import { executeReadFile, executeWriteFile, executeListDirectory, readFileDef, writeFileDef, listDirectoryDef } from './skills/files.js';
import { executeReadMemory, executeWriteMemory, readMemoryDef, writeMemoryDef } from './skills/memory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Hard limit to prevent infinite tool-call loops
const MAX_TOOL_ROUNDS = 10;

// Retry config for transient API errors (e.g. 503 high demand)
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 5000;

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (e: any) {
            const isRetryable = e.status === 503 || e.status === 429;
            if (isRetryable && attempt < MAX_RETRIES - 1) {
                const delay = RETRY_BASE_MS * Math.pow(2, attempt);
                console.warn(`[agent] API ${e.status}, retry ${attempt + 1}/${MAX_RETRIES - 1} in ${delay}ms`);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            throw e;
        }
    }
    throw new Error('Unreachable');
}

// All available tool definitions (passed to Gemini on every call)
const TOOL_DECLARATIONS = [
    readFileDef,
    writeFileDef,
    listDirectoryDef,
    readMemoryDef,
    writeMemoryDef,
];

// Dispatch a Gemini function call to the matching skill executor
async function executeTool(name: string, args: Record<string, any>): Promise<string> {
    console.log(`[tool] ${name}`, args);
    switch (name) {
        case 'read_file':       return executeReadFile(args);
        case 'write_file':      return executeWriteFile(args);
        case 'list_directory':  return executeListDirectory(args);
        case 'read_memory':     return executeReadMemory(args);
        case 'write_memory':    return executeWriteMemory(args);
        default:                return `Unknown tool: ${name}`;
    }
}

async function loadSystemInstructions(): Promise<string> {
    const files = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'IDENTITY.md'];
    let instructions = '';
    for (const file of files) {
        try {
            const content = await fs.readFile(path.join(__dirname, '..', file), 'utf-8');
            instructions += content + '\n\n';
        } catch {
            // Optional files — skip if missing
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

    const initialText = formatHistory(history) + `${senderName}: ${userMessage}`;
    const contents: any[] = [
        { role: 'user', parts: [{ text: initialText }] },
    ];

    const config = {
        systemInstruction,
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    };

    // Agent loop: keep calling Gemini until it returns a plain text response
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await callWithRetry(() => ai.models.generateContent({ model, contents, config }));

        const parts: any[] = response.candidates?.[0]?.content?.parts ?? [];
        const functionCalls = parts.filter((p) => p.functionCall);

        // No function calls → final answer
        if (functionCalls.length === 0) {
            return response.text || 'No response generated.';
        }

        // Append model's function-call turn to the conversation
        contents.push({ role: 'model', parts });

        // Execute each requested tool and collect responses
        const responseParts: any[] = [];
        for (const part of functionCalls) {
            const { name, args } = part.functionCall;
            const output = await executeTool(name, args ?? {});
            responseParts.push({
                functionResponse: { name, response: { output } },
            });
        }

        // Feed results back as the next user turn
        contents.push({ role: 'user', parts: responseParts });
    }

    return 'Tool call limit reached without a final response.';
}
