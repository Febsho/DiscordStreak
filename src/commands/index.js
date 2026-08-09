import * as frequency from './frequency.js';
import * as leaderboard from './leaderboard.js';
import * as resetstreak from './resetstreak.js';
import * as streak from './streak.js';
import * as streakchannel from './streakchannel.js';

export const commands = [streak, frequency, leaderboard, streakchannel, resetstreak];

export const commandMap = new Map(commands.map((command) => [command.data.name, command]));
