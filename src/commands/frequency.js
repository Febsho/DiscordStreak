import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { getFrequency } from '../streaks.js';

const PERIODS = {
  7: 'the last 7 days',
  30: 'the last 30 days',
  90: 'the last 90 days',
  365: 'the last year',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Discord embeds have no fixed-width layout, so the calendar is drawn with
// squares. More than four weeks of them stops being readable on mobile.
const CALENDAR_DAYS = 28;

export const data = new SlashCommandBuilder()
  .setName('frequency')
  .setDescription('Show how often someone is in voice chat')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((option) => option.setName('user').setDescription('Whose activity to show (defaults to you)'))
  .addStringOption((option) =>
    option
      .setName('period')
      .setDescription('How far back to look (default: 30 days)')
      .addChoices(
        { name: 'Last 7 days', value: '7' },
        { name: 'Last 30 days', value: '30' },
        { name: 'Last 90 days', value: '90' },
        { name: 'Last year', value: '365' },
        { name: 'All time', value: 'all' },
      ),
  );

function bar(rate) {
  const filled = Math.round(rate * 10);
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
}

/** Last few weeks as squares, newest last, one line per week. */
function calendarStrip(calendar) {
  const recent = calendar.slice(-CALENDAR_DAYS);
  const lines = [];

  for (let i = 0; i < recent.length; i += 7) {
    lines.push(
      recent
        .slice(i, i + 7)
        .map((entry) => (entry.present ? '🟧' : '⬛'))
        .join(''),
    );
  }

  return lines.join('\n');
}

function busiestDays(byWeekday) {
  const peak = Math.max(...byWeekday);
  if (peak === 0) return 'no days yet';

  return WEEKDAYS.filter((_, index) => byWeekday[index] === peak).join(', ') + ` (${peak}×)`;
}

export async function execute(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const choice = interaction.options.getString('period') ?? '30';
  const window = choice === 'all' ? null : Number(choice);
  const stats = getFrequency(interaction.guildId, user.id, window);
  const label = window ? PERIODS[window] : 'all time';

  if (stats.daysPresent === 0) {
    await interaction.reply({
      content: stats.firstDay
        ? `**${user.displayName}** has not been in a voice channel in ${label}.`
        : user.id === interaction.user.id
          ? `You have not been counted in a voice channel yet — hop in for ${config.minSeconds}s. 🔥`
          : `**${user.displayName}** has never been counted in a voice channel.`,
    });
    return;
  }

  const percent = Math.round(stats.rate * 100);

  const embed = new EmbedBuilder()
    .setColor(0xff7a18)
    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() })
    .setTitle(`📊 In voice on ${stats.daysPresent} of ${stats.windowDays} days (${percent}%)`)
    .setDescription(`${bar(stats.rate)} — ${label}\n\n${calendarStrip(stats.calendar)}`)
    .addFields(
      { name: 'Average', value: `${stats.perWeek.toFixed(1)} days/week`, inline: true },
      {
        name: 'Longest gap',
        value: `${stats.longestGap} day${stats.longestGap === 1 ? '' : 's'}`,
        inline: true,
      },
      { name: 'Busiest weekday', value: busiestDays(stats.byWeekday), inline: true },
      { name: 'Window', value: `${stats.from} → ${stats.to}`, inline: true },
      { name: 'Last counted', value: stats.lastDay, inline: true },
      { name: 'First counted', value: stats.firstDay, inline: true },
    )
    .setFooter({
      text: `🟧 in voice · ⬛ not · last ${Math.min(CALENDAR_DAYS, stats.windowDays)} days · midnight ${config.timezone}`,
    });

  await interaction.reply({ embeds: [embed] });
}
