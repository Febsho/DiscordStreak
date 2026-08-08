import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { flame, getLeaderboard } from '../streaks.js';

const TITLES = {
  current: '🔥 Current streaks',
  longest: '🏆 Longest streaks ever',
  total: '📅 Most days in voice',
};

const MEDALS = ['🥇', '🥈', '🥉'];

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Who has the biggest voice chat streak')
  .addStringOption((option) =>
    option
      .setName('type')
      .setDescription('Which board to show (default: current)')
      .addChoices(
        { name: 'Current streaks (ongoing)', value: 'current' },
        { name: 'Longest streaks ever', value: 'longest' },
        { name: 'Total days in voice', value: 'total' },
      ),
  )
  .addIntegerOption((option) =>
    option.setName('limit').setDescription('How many people to show (1-25)').setMinValue(1).setMaxValue(25),
  );

/**
 * Fetching a single member works over REST without the privileged GuildMembers
 * intent. People who left the server fall back to their global username.
 */
async function displayName(interaction, userId) {
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (member) return member.displayName;

  const user = await interaction.client.users.fetch(userId).catch(() => null);
  return user?.displayName ?? user?.username ?? `Unknown user (${userId})`;
}

export async function execute(interaction) {
  const type = interaction.options.getString('type') ?? 'current';
  const limit = interaction.options.getInteger('limit') ?? 10;
  const rows = getLeaderboard(interaction.guildId, type, limit);

  if (rows.length === 0) {
    await interaction.reply({
      content:
        type === 'current'
          ? 'No streaks running right now. Be the first — join a voice channel! 🔥'
          : 'Nobody has been in a voice channel yet.',
    });
    return;
  }

  const lines = await Promise.all(
    rows.map(async (row, index) => {
      const name = await displayName(interaction, row.userId);
      const rank = MEDALS[index] ?? `**${index + 1}.**`;

      if (type === 'total') return `${rank} ${name} — **${row.totalDays}** days`;
      if (type === 'longest') {
        const note = row.active && row.currentStreak === row.longestStreak ? ' *(ongoing)*' : '';
        return `${rank} ${name} — ${flame(row.longestStreak)} **${row.longestStreak}** days${note}`;
      }

      const status = row.countedToday ? '✅' : '⏳';
      return `${rank} ${name} — ${flame(row.currentStreak)} **${row.currentStreak}** days ${status}`;
    }),
  );

  const embed = new EmbedBuilder()
    .setColor(0xff7a18)
    .setTitle(TITLES[type])
    .setDescription(lines.join('\n'))
    .setFooter({
      text:
        type === 'current'
          ? `✅ counted today · ⏳ still needs a join before midnight ${config.timezone}`
          : `Days roll over at midnight ${config.timezone}`,
    });

  await interaction.reply({ embeds: [embed] });
}
