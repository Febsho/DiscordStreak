import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { formatDuration, getVoiceTime, isTracking } from '../voice.js';

const PERIODS = {
  7: 'the last 7 days',
  30: 'the last 30 days',
  90: 'the last 90 days',
  year: 'this year',
};

export const data = new SlashCommandBuilder()
  .setName('hours')
  .setDescription('Show how long someone has been in voice chat')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((option) => option.setName('user').setDescription('Whose voice time to show (defaults to you)'))
  .addStringOption((option) =>
    option
      .setName('period')
      .setDescription('How far back to look (default: all time)')
      .addChoices(
        { name: 'Last 7 days', value: '7' },
        { name: 'Last 30 days', value: '30' },
        { name: 'Last 90 days', value: '90' },
        { name: 'This year (since January)', value: 'year' },
        { name: 'All time', value: 'all' },
      ),
  );

export async function execute(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const choice = interaction.options.getString('period') ?? 'all';
  const window = choice === 'all' ? null : choice === 'year' ? 'year' : Number(choice);
  const stats = getVoiceTime(interaction.guildId, user.id, window);
  const label = window ? PERIODS[window] : 'all time';

  if (stats.sessions === 0) {
    await interaction.reply({
      content:
        user.id === interaction.user.id
          ? `No voice time recorded for you in ${label} yet. 🎧`
          : `**${user.displayName}** has no voice time recorded in ${label}.`,
    });
    return;
  }

  const live = isTracking(interaction.guildId, user.id);

  const embed = new EmbedBuilder()
    .setColor(live ? 0x39d353 : 0x5865f2)
    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() })
    .setTitle(`${formatDuration(stats.total)} in voice in ${label}`)
    .setDescription(live ? '🔊 In a call right now — this is still ticking up.' : null)
    .addFields(
      { name: 'Sessions', value: `${stats.sessions}`, inline: true },
      { name: 'Days with voice', value: `${stats.days}`, inline: true },
      { name: 'Average per day', value: formatDuration(stats.perDay), inline: true },
      { name: 'Longest session', value: formatDuration(stats.longest), inline: true },
      { name: 'Tracked since', value: new Date(stats.firstAt).toISOString().slice(0, 10), inline: true },
    )
    .setFooter({ text: `Time is only counted while the bot is online · ${config.timezone}` });

  await interaction.reply({ embeds: [embed] });
}
