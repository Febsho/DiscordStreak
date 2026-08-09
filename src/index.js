import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { assertConfig, config } from './config.js';
import { commandMap } from './commands/index.js';
import { registerTracker } from './tracker.js';
import { closeOpenSessions } from './voice.js';

assertConfig();

// Both intents are non-privileged, so nothing has to be enabled in the developer
// portal. Voice state updates already carry the member, and the leaderboard
// looks names up one by one over REST - neither needs GuildMembers.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
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

// A restart is the normal way this process ends, so bank whatever voice time is
// running before the container goes away.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    closeOpenSessions();
    client.destroy();
    process.exit(0);
  });
}

function explainFatal(error) {
  if (/disallowed intents/i.test(error?.message ?? '')) {
    console.error(
      'Discord rejected the gateway connection: "Used disallowed intents".\n' +
        'This build only asks for non-privileged intents, so a stale container image or an old checkout\n' +
        'is the usual cause — rebuild it: docker compose up -d --build (or git pull + restart).',
    );
  } else if (error?.code === 'TokenInvalid') {
    console.error('DISCORD_TOKEN was rejected. Reset the token in the developer portal and update .env.');
  } else {
    console.error('Login failed:', error);
  }
  process.exit(1);
}

// The gateway reports a rejected handshake through the error event, which would
// otherwise crash the process with a bare stack trace.
client.on(Events.Error, explainFatal);

try {
  await client.login(config.token);
} catch (error) {
  explainFatal(error);
}
