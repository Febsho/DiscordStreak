import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.TIMEZONE ||= 'Europe/Berlin';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'streaks-')), 'test.sqlite');

const { getLeaderboard, getStreak, recordDay, resetStreak, flame } = await import('../src/streaks.js');
const { dayKey, daysBetween, shiftDay, secondsUntilNextDay } = await import('../src/time.js');

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

test('flame tiers grow with the streak', () => {
  assert.equal(flame(0), '💤');
  assert.equal(flame(1), '🔥');
  assert.equal(flame(7), '🔥🔥');
  assert.equal(flame(400), '🌌');
});
