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

// Plain glyphs, no ANSI colouring: clients that do not paint ANSI code blocks
// print the escape codes as text instead, which wraps every row and turns the
// calendar into noise. Filled versus hollow reads on its own anyway.
const PRESENT = '■';
const ABSENT = '□';
const BLANK = ' '; // Slots outside the window, so the grid keeps its shape.

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
 * The whole calendar as one bare grid: 7 rows of equal-width weeks and nothing
 * else, so the block stays narrow enough to never wrap on any client.
 */
export function graph(calendar) {
  const columns = toColumns(calendar);
  const lines = [];

  for (let row = 0; row < 7; row += 1) {
    let line = '';
    for (const column of columns) {
      const cell = column[row];
      line += cell ? (cell.present ? PRESENT : ABSENT) : BLANK;
    }
    lines.push(line);
  }

  return '```\n' + lines.join('\n') + '\n```';
}

/** "Aug 2025 → Aug 2026", the range the grid above actually covers. */
function span(from, to) {
  const label = (key) => {
    const [y, m] = parts(key);
    return `${MONTHS[m - 1]} ${y}`;
  };

  const start = label(from);
  const end = label(to);
  return start === end ? start : `${start} → ${end}`;
}

function busiestDays(byWeekday) {
  const peak = Math.max(...byWeekday);
  if (peak === 0) return 'no days yet';

  return WEEKDAYS.filter((_, index) => byWeekday[index] === peak).join(', ') + ` (${peak}×)`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Rounded share, kept off 0% while there is still something to show. */
function share(rate) {
  const percent = rate * 100;
  if (percent > 0 && percent < 1) return '<1%';
  return `${Math.round(percent)}%`;
}

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

  const embed = new EmbedBuilder()
    .setColor(0x39d353)
    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() })
    .setTitle(`${plural(stats.daysPresent, 'day')} in voice in ${label}`)
    .setDescription(`${span(stats.from, stats.to)}\n${graph(stats.calendar)}`)
    .addFields(
      { name: 'Days in voice', value: `${stats.totalDays} all time`, inline: true },
      { name: 'Share', value: `${share(stats.rate)} of ${stats.windowDays} days`, inline: true },
      { name: 'Average', value: `${stats.perWeek.toFixed(1)} days/week`, inline: true },
      { name: 'Longest gap', value: plural(stats.longestGap, 'day'), inline: true },
      { name: 'Busiest weekday', value: busiestDays(stats.byWeekday), inline: true },
      { name: 'Since', value: stats.firstDay, inline: true },
    )
    .setFooter({ text: `${ABSENT} quiet · ${PRESENT} in voice · one day counts once · ${config.timezone}` });

  await interaction.reply({ embeds: [embed] });
}
