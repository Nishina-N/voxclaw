import * as fs from 'fs/promises';
import * as path from 'path';
import { Type } from '@google/genai';

export const readFileDef = {
    name: 'read_file',
    description: 'Reads the content of a file. Valid base paths: /app/workspace/, /app/knowledge/, /app/config/, /app/memory/.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            filePath: {
                type: Type.STRING,
                description: "The absolute path to the file inside the container (e.g., /app/workspace/test.txt or /app/config/channels.json)",
            }
        },
        required: ["filePath"]
    }
} as const;

export const writeFileDef = {
    name: 'write_file',
    description: 'Writes content to a file. Overwrites if it exists. Parent directories are created automatically. Allowed paths: /app/workspace/ (task output), /app/config/ (bot config, including /app/config/skills/ for new skills), /app/USER.md (user info), /app/SOUL.md (personality), /app/IDENTITY.md (identity). Do not write to /app/knowledge/, /app/src/, /app/AGENTS.md, or /app/TOOLS.md.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            filePath: {
                type: Type.STRING,
                description: "The absolute path to the file to write (e.g., /app/workspace/result.txt, /app/config/skills/my_skill/definition.json, or /app/SOUL.md)",
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

const WRITABLE_PATHS = [
    '/app/workspace/',
    '/app/config/',
    '/app/USER.md',
    '/app/SOUL.md',
    '/app/IDENTITY.md',
];

export async function executeWriteFile(args: any): Promise<string> {
    try {
        const allowed = WRITABLE_PATHS.some((p) =>
            args.filePath === p || args.filePath.startsWith(p.endsWith('/') ? p : p + '/')
        );
        if (!allowed) {
            return `Error: Write is not allowed at ${args.filePath}. Allowed: /app/workspace/, /app/config/, /app/USER.md, /app/SOUL.md, /app/IDENTITY.md`;
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
    description: 'Lists files and subdirectories at a given path. Valid base paths: /app/workspace/, /app/knowledge/, /app/config/, /app/memory/.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            dirPath: {
                type: Type.STRING,
                description: 'The absolute directory path to list (e.g., /app/workspace, /app/config, or /app/config/skills)',
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
