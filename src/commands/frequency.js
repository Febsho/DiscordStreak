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
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The graph is drawn like GitHub's contribution calendar: one column per week,
// one row per weekday. A year is 53 columns, which is as wide as a Discord code
// block can get away with, so anything longer is cut off at the left.
const MAX_WEEKS = 53;
const GUTTER = 4; // Room for the "Mon " row labels.

const PRESENT = '■';
const ABSENT = '□';
const GREEN = '\u001b[0;32m';
const GREY = '\u001b[0;30m';
const RESET = '\u001b[0m';

export const data = new SlashCommandBuilder()
  .setName('frequency')
  .setDescription('Show how often someone is in voice chat')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((option) => option.setName('user').setDescription('Whose activity to show (defaults to you)'))
  .addStringOption((option) =>
    option
      .setName('period')
      .setDescription('How far back to look (default: last year)')
      .addChoices(
        { name: 'Last 7 days', value: '7' },
        { name: 'Last 30 days', value: '30' },
        { name: 'Last 90 days', value: '90' },
        { name: 'Last year', value: '365' },
        { name: 'All time', value: 'all' },
      ),
  );

const parts = (key) => key.split('-').map(Number);

/** Weekday with Monday as 0, so a column runs Mon → Sun like GitHub's does. */
function mondayIndex(key) {
  const [y, m, d] = parts(key);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Week columns of 7 slots, oldest first, padded so every column starts on a Monday. */
function toColumns(calendar) {
  const cells = calendar.slice(-(MAX_WEEKS * 7));
  const slots = [...Array(mondayIndex(cells[0].day)).fill(null), ...cells];
  while (slots.length % 7 !== 0) slots.push(null);

  const columns = [];
  for (let i = 0; i < slots.length; i += 7) columns.push(slots.slice(i, i + 7));
  return columns;
}

/**
 * Month names above the week a month starts in — skipped when the previous
 * label would still be sitting there, exactly like a cramped GitHub graph.
 */
function monthHeader(columns) {
  const header = [];
  let previous = null;

  columns.forEach((column, index) => {
    // A column is labelled with the month that begins in it — plus the leftmost
    // column, so the graph always says where it starts.
    const opener = column.find((cell) => cell && parts(cell.day)[2] <= 7) ?? (index === 0 ? column.find(Boolean) : null);
    if (!opener) return;

    const [, month] = parts(opener.day);
    if (month === previous) return;

    previous = month;
    if (header.length >= GUTTER + index) return; // No room left by the previous label.

    while (header.length < GUTTER + index) header.push(' ');
    header.push(...MONTHS[month - 1]);
  });

  return header.join('').trimEnd();
}

/** The whole calendar as one ANSI code block: grey for quiet days, green for voice. */
export function graph(calendar) {
  const columns = toColumns(calendar);
  const lines = [monthHeader(columns)];

  for (let row = 0; row < 7; row += 1) {
    const label = { 0: 'Mon ', 2: 'Wed ', 4: 'Fri ' }[row] ?? '    ';
    let line = label;
    let colour = null;

    for (const column of columns) {
      const cell = column[row];
      // Padding slots outside the window stay blank instead of reading as a
      // day nobody showed up.
      if (!cell) {
        if (colour) line += RESET;
        colour = null;
        line += ' ';
        continue;
      }

      const next = cell.present ? GREEN : GREY;
      if (next !== colour) line += next;
      colour = next;
      line += cell.present ? PRESENT : ABSENT;
    }

    lines.push(colour ? line + RESET : line);
  }

  return '```ansi\n' + lines.join('\n') + '\n```';
}

function busiestDays(byWeekday) {
  const peak = Math.max(...byWeekday);
  if (peak === 0) return 'no days yet';

  return WEEKDAYS.filter((_, index) => byWeekday[index] === peak).join(', ') + ` (${peak}×)`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function execute(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const choice = interaction.options.getString('period') ?? '365';
  const window = choice === 'all' ? null : Number(choice);
  const stats = getFrequency(interaction.guildId, user.id, window);
  const label = window ? PERIODS[window] : 'all time';

  if (stats.totalDays === 0) {
    await interaction.reply({
      content:
        user.id === interaction.user.id
          ? `You have not been counted in a voice channel yet — hop in for ${config.minSeconds}s. 🔥`
          : `**${user.displayName}** has never been counted in a voice channel.`,
    });
    return;
  }

  const percent = Math.round(stats.rate * 100);

  const embed = new EmbedBuilder()
    .setColor(0x39d353)
    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() })
    .setTitle(`${plural(stats.daysPresent, 'day')} in voice in ${label}`)
    .setDescription(graph(stats.calendar))
    .addFields(
      { name: 'Total days in voice', value: `${stats.totalDays} (all time)`, inline: true },
      { name: 'Share of the period', value: `${percent}% of ${stats.windowDays} days`, inline: true },
      { name: 'Average', value: `${stats.perWeek.toFixed(1)} days/week`, inline: true },
      { name: 'Longest gap', value: plural(stats.longestGap, 'day'), inline: true },
      { name: 'Busiest weekday', value: busiestDays(stats.byWeekday), inline: true },
      { name: 'Since', value: stats.firstDay, inline: true },
    )
    .setFooter({
      text: `${ABSENT} not in voice · ${PRESENT} in voice · one day counts once · midnight ${config.timezone}`,
    });

  await interaction.reply({ embeds: [embed] });
}
