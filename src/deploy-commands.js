import { REST, Routes } from 'discord.js';
import { assertConfig, config } from './config.js';
import { commands } from './commands/index.js';

assertConfig({ requireClientId: true });

const rest = new REST().setToken(config.token);

// A CLIENT_ID from a different application is the classic silent failure: the
// registration succeeds, but the commands land on an app that isn't in your
// server. Check the token's own application first.
const app = await rest.get(Routes.currentApplication());
if (app.id !== config.clientId) {
  console.error(
    `CLIENT_ID (${config.clientId}) does not match the bot behind DISCORD_TOKEN (${app.name}, id ${app.id}).\n` +
      `Set CLIENT_ID=${app.id} in .env, or use the token that belongs to application ${config.clientId}.`,
  );
  process.exit(1);
}

const body = commands.map((command) => command.data.toJSON());
const route = config.guildId
  ? Routes.applicationGuildCommands(config.clientId, config.guildId)
  : Routes.applicationCommands(config.clientId);

const registered = await rest.put(route, { body });

console.log(`Application: ${app.name} (${app.id})`);
console.log(`Registered ${registered.length} commands: ${registered.map((c) => `/${c.name}`).join(' ')}`);

if (config.guildId) {
  console.log(`Scope: guild ${config.guildId} — they show up immediately.`);
} else {
  console.log(
    'Scope: global — Discord can take up to an hour to hand these out.\n' +
      'Set GUILD_ID in .env and re-run to get them in one server right away.',
  );
}

console.log(
  '\nIf they still do not appear, the bot was likely invited without the applications.commands scope.\n' +
    `Re-invite it (no need to kick it first) with:\n` +
    `https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot%20applications.commands&permissions=268438528`,
);
