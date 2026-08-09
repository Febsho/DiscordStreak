import { AttachmentBuilder, EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { getFrequency } from '../streaks.js';
import { canvas, encode, roundedRect, text, textWidth, GLYPH_HEIGHT } from '../png.js';

const PERIODS = {
  7: 'the last 7 days',
  30: 'the last 30 days',
  90: 'the last 90 days',
  365: 'the last year', // Only reachable from an older, still-cached command.
  year: 'this year',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The graph is drawn like GitHub's contribution calendar: one column per week,
// one row per weekday. A year is 53 columns; anything longer is cut off at the
// left so the image keeps a readable cell size.
const MAX_WEEKS = 53;

// Cell geometry, in pixels. Discord scales the image down to the embed width,
// so these are drawn generously and stay crisp on a retina display.
const CELL = 20;
const GAP = 6;
const PAD = 10;
const RADIUS = 5;

const LABEL_SCALE = 2;
const LABEL_HEIGHT = GLYPH_HEIGHT * LABEL_SCALE;
const LABEL_MARGIN = 8; // Air between the month row and the first cell.

const QUIET = [124, 128, 137, 60]; // Translucent grey: readable on either theme.
const VOICE = [57, 211, 83, 255];
const LABEL = [148, 155, 164, 255];

export const data = new SlashCommandBuilder()
  .setName('frequency')
  .setDescription('Show how often someone is in voice chat')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((option) => option.setName('user').setDescription('Whose activity to show (defaults to you)'))
  .addStringOption((option) =>
    option
      .setName('period')
      .setDescription('How far back to look (default: this year)')
      .addChoices(
        { name: 'Last 7 days', value: '7' },
        { name: 'Last 30 days', value: '30' },
        { name: 'Last 90 days', value: '90' },
        { name: 'This year (since January)', value: 'year' },
        { name: 'All time', value: 'all' },
      ),
  );

const parts = (key) => key.split('-').map(Number);

/** Weekday with Monday as 0, so a column runs Mon → Sun like GitHub's does. */
function mondayIndex(key) {
  const [y, m, d] = parts(key);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * Week columns of 7 slots, oldest first, padded so every column starts on a
 * Monday. Slots outside the window are null and stay unpainted.
 */
export function columns(calendar) {
  const cells = calendar.slice(-(MAX_WEEKS * 7));
  const slots = [...Array(mondayIndex(cells[0].day)).fill(null), ...cells];
  while (slots.length % 7 !== 0) slots.push(null);

  const weeks = [];
  for (let i = 0; i < slots.length; i += 7) weeks.push(slots.slice(i, i + 7));
  return weeks;
}

const columnX = (column) => PAD + column * (CELL + GAP);

/**
 * Month captions, each sitting above the week its month starts in. A label is
 * dropped when the previous one would still be underneath it, so a narrow grid
 * thins out instead of running its months together.
 */
export function monthLabels(weeks) {
  const labels = [];
  let previous = null;
  let occupied = -Infinity; // Right edge of the last label drawn.

  weeks.forEach((week, column) => {
    const opener = week.find((cell) => cell && parts(cell.day)[2] <= 7);
    if (!opener) return;

    const [, month] = parts(opener.day);
    if (month === previous) return;
    previous = month;

    const label = MONTHS[month - 1];
    const x = columnX(column);
    if (x < occupied + GAP) return;

    occupied = x + textWidth(label, LABEL_SCALE);
    labels.push({ column, label, x });
  });

  return labels;
}

/** The calendar as a PNG: one rounded cell per day, green for a day in voice. */
export function graph(calendar) {
  const weeks = columns(calendar);
  const top = PAD + LABEL_HEIGHT + LABEL_MARGIN;
  const image = canvas(PAD * 2 + weeks.length * (CELL + GAP) - GAP, top + 7 * (CELL + GAP) - GAP + PAD);

  for (const { label, x } of monthLabels(weeks)) text(image, x, PAD, label, LABEL_SCALE, LABEL);

  weeks.forEach((week, column) => {
    week.forEach((cell, row) => {
      if (!cell) return;
      roundedRect(image, columnX(column), top + row * (CELL + GAP), CELL, RADIUS, cell.present ? VOICE : QUIET);
    });
  });

  return encode(image);
}

/** "Aug 2025 → Aug 2026", the range the grid actually covers. */
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
  const choice = interaction.options.getString('period') ?? 'year';
  const window = choice === 'all' ? null : choice === 'year' ? 'year' : Number(choice);
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

  const file = new AttachmentBuilder(graph(stats.calendar), { name: 'frequency.png' });

  const embed = new EmbedBuilder()
    .setColor(0x39d353)
    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() })
    .setTitle(`${plural(stats.daysPresent, 'day')} in voice in ${label}`)
    .setDescription(span(stats.from, stats.to))
    .setImage('attachment://frequency.png')
    .addFields(
      { name: 'Days in voice', value: `${stats.totalDays} all time`, inline: true },
      { name: 'Share', value: `${share(stats.rate)} of ${stats.windowDays} days`, inline: true },
      { name: 'Average', value: `${stats.perWeek.toFixed(1)} days/week`, inline: true },
      { name: 'Longest gap', value: plural(stats.longestGap, 'day'), inline: true },
      { name: 'Busiest weekday', value: busiestDays(stats.byWeekday), inline: true },
      { name: 'Since', value: stats.firstDay, inline: true },
    )
    .setFooter({ text: `🟩 in voice · one day counts once · midnight ${config.timezone}` });

  await interaction.reply({ embeds: [embed], files: [file] });
}
