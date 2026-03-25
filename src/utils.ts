export const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function truncateForDiscord(text: string): string {
    return text.length > 1990 ? text.slice(0, 1990) + '…' : text;
}

export function extractErrorCode(err: any): string {
    return err.status ?? err.code ?? 'unknown';
}

export function generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
