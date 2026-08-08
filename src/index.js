import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { assertConfig, config } from './config.js';
import { commandMap } from './commands/index.js';
import { registerTracker } from './tracker.js';

assertConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, (ready) => {
  console.log(
    `Logged in as ${ready.user.tag} — tracking voice streaks in ${ready.guilds.cache.size} server(s), ` +
      `timezone ${config.timezone}, ${config.minSeconds}s minimum.`,
  );
  registerTracker(ready);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commandMap.get(interaction.commandName);
  if (!command) return;

  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Streaks only work inside a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`/${interaction.commandName} failed:`, error);
    const payload = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

await client.login(config.token);
