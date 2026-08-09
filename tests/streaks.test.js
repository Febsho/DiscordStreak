import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.TIMEZONE ||= 'Europe/Berlin';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'streaks-')), 'test.sqlite');

const { getFrequency, getLeaderboard, getStreak, recordDay, resetStreak, flame } = await import(
  '../src/streaks.js'
);
const { dayKey, daysBetween, shiftDay, secondsUntilNextDay } = await import('../src/time.js');
const { graph } = await import('../src/commands/frequency.js');

const G = 'guild-1';
const today = dayKey();
const yesterday = shiftDay(today, -1);

test('shiftDay and daysBetween survive DST boundaries', () => {
  assert.equal(shiftDay('2025-03-30', -1), '2025-03-29');
  assert.equal(shiftDay('2025-10-26', 1), '2025-10-27');
  assert.equal(shiftDay('2024-02-28', 1), '2024-02-29');
  assert.equal(daysBetween('2024-12-31', '2025-01-01'), 1);
  assert.equal(daysBetween('2025-01-05', '2025-01-01'), -4);
});

test('secondsUntilNextDay lands inside the next day', () => {
  const seconds = secondsUntilNextDay();
  assert.ok(seconds > 0 && seconds <= 26 * 3600);
  assert.notEqual(dayKey(new Date(Date.now() + seconds * 1000)), today);
});

test('a first join starts a streak at one day', () => {
  const result = recordDay(G, 'u1', shiftDay(today, -4));
  assert.equal(result.counted, true);
  assert.equal(result.started, true);
  assert.equal(result.currentStreak, 1);
});

test('a second join on the same day changes nothing', () => {
  const day = shiftDay(today, -4);
  const result = recordDay(G, 'u1', day);
  assert.equal(result.counted, false);
  assert.equal(result.totalDays, 1);
});

test('consecutive days build the streak, longest keeps the peak', () => {
  recordDay(G, 'u1', shiftDay(today, -3));
  recordDay(G, 'u1', shiftDay(today, -2));
  const streak = getStreak(G, 'u1');
  assert.equal(streak.longestStreak, 3);
  assert.equal(streak.totalDays, 3);
});

test('a missed day expires the streak but keeps the record', () => {
  const streak = getStreak(G, 'u1'); // last counted two days ago
  assert.equal(streak.active, false);
  assert.equal(streak.currentStreak, 0);
  assert.equal(streak.lastStreak, 3);
  assert.equal(streak.longestStreak, 3);
});

test('coming back after a gap restarts at one', () => {
  const result = recordDay(G, 'u1', today);
  assert.equal(result.currentStreak, 1);
  assert.equal(result.continued, false);
  assert.equal(getStreak(G, 'u1').longestStreak, 3);
});

test('joining yesterday keeps the streak ongoing until midnight', () => {
  recordDay(G, 'u2', shiftDay(today, -1));
  const streak = getStreak(G, 'u2');
  assert.equal(streak.active, true);
  assert.equal(streak.countedToday, false);
  assert.equal(streak.currentStreak, 1);
});

test('out-of-order credits never rewind a streak', () => {
  recordDay(G, 'u3', yesterday);
  recordDay(G, 'u3', today);
  const stale = recordDay(G, 'u3', shiftDay(today, -5));
  assert.equal(stale.counted, false);
  assert.equal(getStreak(G, 'u3').currentStreak, 2);
});

test('current leaderboard ranks ongoing streaks only', () => {
  recordDay(G, 'expired', shiftDay(today, -10));
  const current = getLeaderboard(G, 'current');
  const ids = current.map((row) => row.userId);
  assert.deepEqual(ids, ['u3', 'u1', 'u2']);
  assert.ok(!ids.includes('expired'));
});

test('longest leaderboard still shows people whose streak died', () => {
  const ids = getLeaderboard(G, 'longest').map((row) => row.userId);
  assert.equal(ids[0], 'u1');
  assert.ok(ids.includes('expired'));
});

test('streaks are per guild', () => {
  recordDay('guild-2', 'u1', today);
  assert.equal(getStreak('guild-2', 'u1').totalDays, 1);
  assert.equal(getStreak(G, 'u1').totalDays, 4);
});

test('reset clears a user completely', () => {
  resetStreak(G, 'u1');
  const streak = getStreak(G, 'u1');
  assert.equal(streak.totalDays, 0);
  assert.equal(streak.lastDay, null);
});

test('frequency counts days inside the window only', () => {
  // Oldest first — a backdated credit is ignored once a later day is counted.
  for (const offset of [40, 9, 3, 1, 0]) recordDay(G, 'freq', shiftDay(today, -offset));

  const week = getFrequency(G, 'freq', 7);
  assert.equal(week.windowDays, 7);
  assert.equal(week.daysPresent, 3);
  assert.equal(week.from, shiftDay(today, -6));
  assert.equal(week.to, today);
  assert.ok(Math.abs(week.rate - 3 / 7) < 1e-9);
  assert.equal(week.calendar.length, 7);
  assert.equal(week.calendar.at(-1).present, true);

  assert.equal(getFrequency(G, 'freq', 30).daysPresent, 4);
  assert.equal(getFrequency(G, 'freq', 365).daysPresent, 5);
});

test('frequency all-time spans first counted day to today', () => {
  const all = getFrequency(G, 'freq', null);
  assert.equal(all.from, shiftDay(today, -40));
  assert.equal(all.windowDays, 41);
  assert.equal(all.daysPresent, 5);
  assert.equal(all.firstDay, shiftDay(today, -40));
  assert.equal(all.lastDay, today);
});

test('frequency reports the longest quiet stretch', () => {
  // Days -40, -9, -3, -1, 0: the 30 days between -40 and -9 are the big gap.
  assert.equal(getFrequency(G, 'freq', null).longestGap, 30);
  // Inside the last 7 days the window opens with three quiet days (-6..-4).
  assert.equal(getFrequency(G, 'freq', 7).longestGap, 3);
});

test('frequency is zero for someone who never joined', () => {
  const none = getFrequency(G, 'nobody', 30);
  assert.equal(none.daysPresent, 0);
  assert.equal(none.rate, 0);
  assert.equal(none.longestGap, 30);
  assert.equal(none.firstDay, null);
  assert.equal(none.totalDays, 0);
});

test('frequency carries the all-time day count whatever the window is', () => {
  // Days in voice overall, streak or not — the same number in every window.
  assert.equal(getFrequency(G, 'freq', 7).totalDays, 5);
  assert.equal(getFrequency(G, 'freq', 30).totalDays, 5);
  assert.equal(getFrequency(G, 'freq', null).totalDays, 5);
  assert.equal(getStreak(G, 'freq').totalDays, 5);
});

test('the contribution graph is a 7-row grid of equal-width weeks', () => {
  const stats = getFrequency(G, 'freq', 90);
  const rows = graph(stats.calendar).replace(/\[[0-9;]*m/g, '').split('\n').slice(1, -1);

  assert.equal(rows.length, 8); // A month header plus Mon..Sun.
  const grids = rows.slice(1).map((row) => row.slice(4));
  assert.equal(new Set(grids.map((row) => row.length)).size, 1);
  assert.equal(grids[0].length, 13); // 90 days spans 13 week columns.

  // Every counted day shows up as a filled cell, today sitting in the last column.
  assert.equal(grids.join('').split('■').length - 1, stats.daysPresent);
  const [y, m, d] = today.split('-').map(Number);
  const todayRow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  assert.equal(grids[todayRow].at(-1), '■');
});

test('flame tiers grow with the streak', () => {
  assert.equal(flame(0), '💤');
  assert.equal(flame(1), '🔥');
  assert.equal(flame(7), '🔥🔥');
  assert.equal(flame(400), '🌌');
});
