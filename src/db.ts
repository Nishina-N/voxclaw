import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', 'memory');
const DB_PATH = path.join(DB_DIR, 'messages.db');

let db: Database.Database;

export interface Message {
    id: string;
    channel_id: string;
    sender_id: string;
    sender_name: string;
    content: string;
    timestamp: string;
    is_bot: number;
    media?: string;
}

export interface Task {
    id: string;
    title: string;
    notes?: string;
    due?: string;       // ISO date string e.g. "2026-04-01"
    status: string;     // 'needsAction' | 'completed'
    created_at: string;
    updated_at: string;
}

export function initDatabase(): void {
    fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id          TEXT PRIMARY KEY,
            channel_id  TEXT NOT NULL,
            sender_id   TEXT NOT NULL,
            sender_name TEXT NOT NULL,
            content     TEXT NOT NULL,
            timestamp   TEXT NOT NULL,
            is_bot      INTEGER DEFAULT 0,
            media       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_channel_ts ON messages(channel_id, timestamp);

        CREATE TABLE IF NOT EXISTS router_state (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id         TEXT PRIMARY KEY,
            title      TEXT NOT NULL,
            notes      TEXT,
            due        TEXT,
            status     TEXT NOT NULL DEFAULT 'needsAction',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
    // Migration: add media column to existing databases
    try {
        db.exec(`ALTER TABLE messages ADD COLUMN media TEXT`);
    } catch {
        // Column already exists — ignore
    }
}

export function storeMessage(msg: Message): void {
    db.prepare(
        `INSERT OR REPLACE INTO messages
         (id, channel_id, sender_id, sender_name, content, timestamp, is_bot, media)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(msg.id, msg.channel_id, msg.sender_id, msg.sender_name, msg.content, msg.timestamp, msg.is_bot, msg.media ?? null);
}

/**
 * Returns new messages that mention the bot across the given channels, newer than `since`.
 */
export function getNewMentions(
    channelIds: string[],
    since: string,
    botId: string,
    limit = 100,
): { messages: Message[]; newTimestamp: string } {
    if (channelIds.length === 0) return { messages: [], newTimestamp: since };

    const placeholders = channelIds.map(() => '?').join(',');
    const rows = db.prepare(`
        SELECT * FROM (
            SELECT * FROM messages
            WHERE timestamp > ? AND channel_id IN (${placeholders})
              AND is_bot = 0 AND content LIKE ?
            ORDER BY timestamp DESC LIMIT ?
        ) ORDER BY timestamp
    `).all(since, ...channelIds, `%<@${botId}>%`, limit) as Message[];

    const newTimestamp = rows.length > 0 ? rows[rows.length - 1].timestamp : since;
    return { messages: rows, newTimestamp };
}

/**
 * Returns all new non-bot messages across the given channels, newer than `since`.
 */
export function getNewMessages(
    channelIds: string[],
    since: string,
    limit = 100,
): { messages: Message[]; newTimestamp: string } {
    if (channelIds.length === 0) return { messages: [], newTimestamp: since };

    const placeholders = channelIds.map(() => '?').join(',');
    const rows = db.prepare(`
        SELECT * FROM (
            SELECT * FROM messages
            WHERE timestamp > ? AND channel_id IN (${placeholders}) AND is_bot = 0
            ORDER BY timestamp DESC LIMIT ?
        ) ORDER BY timestamp
    `).all(since, ...channelIds, limit) as Message[];

    const newTimestamp = rows.length > 0 ? rows[rows.length - 1].timestamp : since;
    return { messages: rows, newTimestamp };
}

/**
 * Returns up to `limit` recent messages in a channel.
 * - `since`  filters to messages after that timestamp (used for agent context).
 * - `before` fetches the page of messages older than that timestamp (used for "show more").
 * When `before` is supplied, `since` is ignored.
 */
export function getChannelHistory(channelId: string, since: string, limit = 20, before?: string): Message[] {
    if (before) {
        return db.prepare(`
            SELECT * FROM (
                SELECT * FROM messages
                WHERE channel_id = ? AND timestamp < ?
                ORDER BY timestamp DESC LIMIT ?
            ) ORDER BY timestamp
        `).all(channelId, before, limit) as Message[];
    }
    return db.prepare(`
        SELECT * FROM (
            SELECT * FROM messages
            WHERE channel_id = ? AND timestamp > ?
            ORDER BY timestamp DESC LIMIT ?
        ) ORDER BY timestamp
    `).all(channelId, since, limit) as Message[];
}

export function getRouterState(key: string): string | undefined {
    const row = db.prepare('SELECT value FROM router_state WHERE key = ?')
        .get(key) as { value: string } | undefined;
    return row?.value;
}

export function setRouterState(key: string, value: string): void {
    db.prepare('INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)').run(key, value);
}

// --- Tasks ---

export function getTasks(status?: string): Task[] {
    if (status) {
        return db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC').all(status) as Task[];
    }
    return db.prepare('SELECT * FROM tasks ORDER BY created_at ASC').all() as Task[];
}

export function createTask(task: Task): void {
    db.prepare(
        `INSERT INTO tasks (id, title, notes, due, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(task.id, task.title, task.notes ?? null, task.due ?? null, task.status, task.created_at, task.updated_at);
}

export function updateTask(id: string, fields: Partial<Pick<Task, 'title' | 'notes' | 'due' | 'status'>>): boolean {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(fields)) {
        sets.push(`${k} = ?`);
        vals.push(v ?? null);
    }
    if (!sets.length) return false;
    sets.push('updated_at = ?');
    vals.push(new Date().toISOString());
    vals.push(id);
    const result = db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return result.changes > 0;
}

export function deleteTask(id: string): boolean {
    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return result.changes > 0;
}
