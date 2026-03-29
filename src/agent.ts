import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { type Message } from './db.js';
import { loadDynamicSkills, executeDynamicSkill } from './skill-loader.js';
import { executeReadFile, executeWriteFile, executeListDirectory, readFileDef, writeFileDef, listDirectoryDef } from './functions/files.js';
import { executeReadMemory, executeWriteMemory, readMemoryDef, writeMemoryDef } from './functions/memory.js';
import { executePipInstall, pipInstallDef } from './functions/pip.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const MAX_TOOL_ROUNDS = 20;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 5000;

// Built-in tools (compiled into the image)
const BUILTIN_DECLARATIONS = [
    readFileDef,
    writeFileDef,
    listDirectoryDef,
    readMemoryDef,
    writeMemoryDef,
    pipInstallDef,
];

const BUILTIN_EXECUTORS: Record<string, (args: any) => Promise<string>> = {
    read_file:       executeReadFile,
    write_file:      executeWriteFile,
    list_directory:  executeListDirectory,
    read_memory:     executeReadMemory,
    write_memory:    executeWriteMemory,
    pip_install:     executePipInstall,
};

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

async function loadSystemInstructions(): Promise<string> {
    const files = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'IDENTITY.md'];
    let instructions = '';
    for (const file of files) {
        try {
            const content = await fs.readFile(path.join(__dirname, '..', 'prompts', file), 'utf-8');
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
        m.is_bot ? `voxclaw: ${m.content}` : `${m.sender_name}: ${m.content}`
    );
    return `[Recent conversation]\n${lines.join('\n')}\n\n`;
}

export async function processMessage(
    userMessage: string,
    history: Message[] = [],
    senderName = 'User',
    channelId = '',
): Promise<string> {
    const systemInstruction = await loadSystemInstructions();

    // Load dynamic skills on every call so newly created skills are picked up immediately
    const dynamicSkills = await loadDynamicSkills();
    const dynamicDeclarations = dynamicSkills.map((s) => s.definition);

    // Map tool name → skill dir for dispatch
    const dynamicSkillDirs = new Map<string, string>(
        dynamicSkills.map((s) => [s.definition.name, s.dir])
    );

    const allDeclarations = [...BUILTIN_DECLARATIONS, ...dynamicDeclarations];

    const channelContext = channelId ? `[Channel ID: ${channelId}]\n` : '';
    const initialText = channelContext + formatHistory(history) + `${senderName}: ${userMessage}`;
    const contents: any[] = [
        { role: 'user', parts: [{ text: initialText }] },
    ];

    const config = {
        systemInstruction,
        tools: [{ functionDeclarations: allDeclarations }],
    };

    // Agent loop
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await callWithRetry(() =>
            ai.models.generateContent({ model, contents, config })
        );

        const parts: any[] = response.candidates?.[0]?.content?.parts ?? [];
        const functionCalls = parts.filter((p) => p.functionCall);

        if (functionCalls.length === 0) {
            return response.text || 'No response generated.';
        }

        contents.push({ role: 'model', parts });

        const responseParts: any[] = [];
        for (const part of functionCalls) {
            const { name, args } = part.functionCall;
            console.log(`[tool] ${name}`, args);

            let output: string;
            if (BUILTIN_EXECUTORS[name]) {
                output = await BUILTIN_EXECUTORS[name](args ?? {});
            } else if (dynamicSkillDirs.has(name)) {
                output = await executeDynamicSkill(dynamicSkillDirs.get(name)!, args ?? {});
            } else {
                output = `Unknown tool: ${name}`;
            }

            responseParts.push({
                functionResponse: { name, response: { output } },
            });
        }

        contents.push({ role: 'user', parts: responseParts });
    }

    return 'Tool call limit reached without a final response.';
}
