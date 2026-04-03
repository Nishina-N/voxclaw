import * as fs from 'fs';
import * as path from 'path';
import cron from 'node-cron';

import { type Channel } from './channels/types.js';
import { processMessage } from './agent.js';
import { getChannelHistory, storeMessage } from './db.js';
import { truncateForDiscord, historySince, generateId } from './utils.js';

const CRON_CONFIG_PATH = '/app/config/cron.json';

export interface CronTask {
    id: string;          // Unique identifier
    cron: string;        // Standard 5-field cron expression (e.g. "0 9 * * *")
    prompt: string;      // Message sent to the agent when the task fires
    channelId: string;   // Discord channel ID to post the response
    enabled?: boolean;   // Default: true
}

// Active node-cron tasks keyed by task id
const scheduledTasks = new Map<string, cron.ScheduledTask>();

function loadConfig(): CronTask[] {
    try {
        return JSON.parse(fs.readFileSync(CRON_CONFIG_PATH, 'utf-8'));
    } catch {
        return [];
    }
}

function scheduleAll(tasks: CronTask[], channel: Channel | null): void {
    // Stop and clear all existing tasks
    for (const task of scheduledTasks.values()) task.stop();
    scheduledTasks.clear();

    for (const task of tasks) {
        if (task.enabled === false) continue;

        if (!cron.validate(task.cron)) {
            console.warn(`[cron] Invalid expression for "${task.id}": ${task.cron}`);
            continue;
        }

        const scheduled = cron.schedule(task.cron, async () => {
            console.log(`[cron] Firing "${task.id}"`);
            const now = new Date().toISOString();
            try {
                const since = historySince();
                const history = getChannelHistory(task.channelId, since);

                storeMessage({
                    id: generateId('cron'),
                    channel_id: task.channelId,
                    sender_id: 'cron',
                    sender_name: 'cron',
                    content: task.prompt,
                    timestamp: now,
                    is_bot: 0,
                });

                const reply = await processMessage(task.prompt, history, 'cron', task.channelId);

                storeMessage({
                    id: generateId('bot'),
                    channel_id: task.channelId,
                    sender_id: 'voxclaw',
                    sender_name: 'voxclaw',
                    content: reply,
                    timestamp: new Date().toISOString(),
                    is_bot: 1,
                });
                console.log(`[cron] Task "${task.id}" completed, reply length: ${reply.length}`);

                if (channel) {
                    const text = truncateForDiscord(reply);
                    await channel.sendMessage(task.channelId, text);
                }
            } catch (e) {
                console.error(`[cron] Task "${task.id}" failed:`, e);
                const errMsg = e instanceof Error ? e.message : String(e);
                storeMessage({
                    id: generateId('bot'),
                    channel_id: task.channelId,
                    sender_id: 'voxclaw',
                    sender_name: 'voxclaw',
                    content: `⚠️ [cron: ${task.id}] 実行中にエラーが発生しました: ${errMsg}`,
                    timestamp: new Date().toISOString(),
                    is_bot: 1,
                });
            }
        });

        scheduledTasks.set(task.id, scheduled);
        console.log(`[cron] Scheduled "${task.id}" (${task.cron})`);
    }
}

export function startCronRunner(channel: Channel | null): void {
    // Initial load
    scheduleAll(loadConfig(), channel);

    // Watch for file changes — agent edits take effect immediately
    try {
        fs.watch(path.dirname(CRON_CONFIG_PATH), (_, filename) => {
            if (filename === path.basename(CRON_CONFIG_PATH)) {
                console.log('[cron] Config changed, reloading...');
                scheduleAll(loadConfig(), channel);
            }
        });
    } catch {
        // If the config dir doesn't exist yet, skip watching
    }
}
