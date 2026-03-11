import { type Message } from '../db.js';

export type OnMessageCallback = (msg: Message) => void;

export interface Channel {
    /** Platform name (e.g. 'discord', 'telegram') */
    readonly name: string;

    /** Connect to the platform and start delivering inbound messages via callback */
    connect(onMessage: OnMessageCallback): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;

    sendMessage(channelId: string, text: string): Promise<void>;

    /** Send a typing indicator if the platform supports it */
    setTyping?(channelId: string, isTyping: boolean): Promise<void>;

    /** Returns true if this channel instance handles the given channelId */
    ownsChannel(channelId: string): boolean;

    /** The bot's own user/account ID on this platform */
    getBotId(): string;

    /** Returns true if the message content contains a mention directed at this bot */
    isMentioned(content: string): boolean;
}
