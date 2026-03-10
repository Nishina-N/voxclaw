import * as fs from 'fs/promises';
import * as path from 'path';
import { Type } from '@google/genai';

export const readFileDef = {
    name: 'read_file',
    description: 'Reads the content of a file. Use /app/workspace or /app/knowledge as the base path.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            filePath: {
                type: Type.STRING,
                description: "The absolute path to the file inside the container (e.g., /app/workspace/test.txt)",
            }
        },
        required: ["filePath"]
    }
} as const;

export const writeFileDef = {
    name: 'write_file',
    description: 'Writes content to a file. Overwrites if it exists. MUST use /app/workspace/ as the base path. Do not write to /app/knowledge/.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            filePath: {
                type: Type.STRING,
                description: "The absolute path to the file to write (e.g., /app/workspace/new_script.py)",
            },
            content: {
                type: Type.STRING,
                description: "The text content to write to the file.",
            }
        },
        required: ["filePath", "content"]
    }
} as const;

export async function executeReadFile(args: any): Promise<string> {
    try {
        const content = await fs.readFile(args.filePath, 'utf-8');
        return content;
    } catch (e: any) {
        return `Failed to read file at ${args.filePath}: ${e.message}`;
    }
}

export async function executeWriteFile(args: any): Promise<string> {
    try {
        // Basic security check to prevent writing outside allowed directories 
        // (though docker-compose also mitigates impact)
        if (!args.filePath.startsWith('/app/workspace/')) {
            return `Error: You are only allowed to write files to the /app/workspace/ directory.`;
        }

        // Ensure directory exists
        const dir = path.dirname(args.filePath);
        await fs.mkdir(dir, { recursive: true });

        await fs.writeFile(args.filePath, args.content, 'utf-8');
        return `Successfully wrote to ${args.filePath}`;
    } catch (e: any) {
        return `Failed to write file at ${args.filePath}: ${e.message}`;
    }
}
