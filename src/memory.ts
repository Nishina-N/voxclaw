import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = path.join(__dirname, '..', 'memory');

export async function ensureMemoryDir(): Promise<void> {
    try {
        await fs.mkdir(MEMORY_DIR, { recursive: true });
    } catch (error) {
        console.error("Failed to create memory directory:", error);
    }
}

export async function readMemory(dateStr?: string): Promise<string> {
    await ensureMemoryDir();
    const targetDate = dateStr || new Date().toISOString().split('T')[0];
    const filePath = path.join(MEMORY_DIR, `${targetDate}.txt`);
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return content;
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            return "No memory log found for this date.";
        }
        throw e;
    }
}

export async function writeMemory(content: string, dateStr?: string): Promise<void> {
    await ensureMemoryDir();
    const targetDate = dateStr || new Date().toISOString().split('T')[0];
    const filePath = path.join(MEMORY_DIR, `${targetDate}.txt`);
    
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}]\n${content}\n\n`;
    
    await fs.appendFile(filePath, logEntry, 'utf-8');
}
