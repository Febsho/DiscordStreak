import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { flame, getStreak } from '../streaks.js';

export const data = new SlashCommandBuilder()
  .setName('streak')
  .setDescription('Show a voice chat streak')
  .addUserOption((option) => option.setName('user').setDescription('Whose streak to show (defaults to you)'));

export async function execute(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const streak = getStreak(interaction.guildId, user.id);

  if (streak.totalDays === 0) {
    await interaction.reply({
      content:
        user.id === interaction.user.id
          ? `You have no streak yet — hop into a voice channel for ${config.minSeconds}s to start one. 🔥`
          : `**${user.displayName}** has no streak yet.`,
    });
    return;
  }

  const status = streak.countedToday
    ? '✅ Counted today — streak is safe.'
    : streak.active
      ? '⏳ Ongoing, but not counted yet today — join a voice channel before midnight!'
      : `💀 Expired. The streak ended at **${streak.lastStreak}** day${streak.lastStreak === 1 ? '' : 's'} — joining voice starts a new one.`;

  const embed = new EmbedBuilder()
    .setColor(streak.active ? 0xff7a18 : 0x4f545c)
    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() })
    .setTitle(`${flame(streak.currentStreak)} ${streak.currentStreak} day streak`)
    .setDescription(status)
    .addFields(
      { name: 'Longest', value: `${streak.longestStreak} days`, inline: true },
      { name: 'Days in voice', value: `${streak.totalDays}`, inline: true },
      { name: 'Last counted', value: streak.lastDay, inline: true },
      { name: 'First counted', value: streak.firstDay, inline: true },
    )
    .setFooter({ text: `Days roll over at midnight ${config.timezone}` });

  await interaction.reply({ embeds: [embed] });
}
