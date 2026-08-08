import { REST, Routes } from 'discord.js';
import { assertConfig, config } from './config.js';
import { commands } from './commands/index.js';

assertConfig({ requireClientId: true });

const rest = new REST().setToken(config.token);
const body = commands.map((command) => command.data.toJSON());

const route = config.guildId
  ? Routes.applicationGuildCommands(config.clientId, config.guildId)
  : Routes.applicationCommands(config.clientId);

await rest.put(route, { body });

console.log(
  `Registered ${body.length} commands ${config.guildId ? `in guild ${config.guildId}` : 'globally (may take up to an hour to show up)'}.`,
);
