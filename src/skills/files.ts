import * as fs from 'fs/promises';
import * as path from 'path';
import { Type } from '@google/genai';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
        if (!args.filePath.startsWith('/app/workspace/')) {
            return `Error: Write is only allowed under /app/workspace/.`;
        }
        const dir = path.dirname(args.filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(args.filePath, args.content, 'utf-8');
        return `Successfully wrote to ${args.filePath}`;
    } catch (e: any) {
        return `Failed to write file at ${args.filePath}: ${e.message}`;
    }
}

export const listDirectoryDef = {
    name: 'list_directory',
    description: 'Lists files and subdirectories at a given path. Use /app/workspace or /app/knowledge as the base path.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            dirPath: {
                type: Type.STRING,
                description: 'The absolute directory path to list (e.g., /app/workspace or /app/knowledge/docs)',
            },
            recursive: {
                type: Type.BOOLEAN,
                description: 'If true, list all files recursively. Defaults to false.',
            },
        },
        required: ['dirPath'],
    },
} as const;

export async function executeListDirectory(args: any): Promise<string> {
    try {
        const entries = await listEntries(args.dirPath, args.recursive ?? false);
        return entries.length > 0 ? entries.join('\n') : '(empty directory)';
    } catch (e: any) {
        return `Failed to list directory at ${args.dirPath}: ${e.message}`;
    }
}

async function listEntries(dirPath: string, recursive: boolean, prefix = ''): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        results.push(prefix + (entry.isDirectory() ? `[dir]  ${entry.name}` : `[file] ${entry.name}`));
        if (recursive && entry.isDirectory()) {
            results.push(...await listEntries(fullPath, true, prefix + '  '));
        }
    }
    return results;
}
