import { Client, GatewayIntentBits } from 'discord.js';
import * as dotenv from 'dotenv';
import { processMessage } from './agent.js';

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once('ready', () => {
    console.log(`🐾 gemiclaw is online as ${client.user?.tag}`);
});

client.on('messageCreate', async (message) => {
    // Ignore bots
    if (message.author.bot) return;

    // Only respond if mentioned or in DMs, or just respond to everything for testing
    // For nanoclaw style, respond if mentioned
    if (message.mentions.has(client.user!.id)) {
        message.channel.sendTyping();
        
        // Strip the mention from the content
        const content = message.content.replace(`<@${client.user!.id}>`, '').trim();
        
        const reply = await processMessage(content);
        
        // Discord has a 2000 char limit. Simple chunking:
        if (reply.length > 2000) {
            await message.reply(reply.substring(0, 1996) + '...');
        } else {
            await message.reply(reply);
        }
    }
});

if (!process.env.DISCORD_TOKEN) {
    console.error("DISCORD_TOKEN is missing in .env");
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
