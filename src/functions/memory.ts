import { readMemory, writeMemory } from '../memory.js';
import { Type } from '@google/genai';

export const readMemoryDef = {
    name: 'read_memory',
    description: 'Reads the memory log for a specific date (or today).',
    parameters: {
        type: Type.OBJECT,
        properties: {
            dateStr: {
                type: Type.STRING,
                description: "Optional YYYY-MM-DD date. If empty, reads today's log.",
            }
        }
    }
} as const;

export const writeMemoryDef = {
    name: 'write_memory',
    description: 'Appends information or context to the memory log for today.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            content: {
                type: Type.STRING,
                description: "The content to store in memory.",
            }
        },
        required: ["content"]
    }
} as const;

export async function executeReadMemory(args: any): Promise<string> {
    return await readMemory(args.dateStr);
}

export async function executeWriteMemory(args: any): Promise<string> {
    await writeMemory(args.content);
    return "Memory successfully written.";
}
