import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.TIMEZONE ||= 'Europe/Berlin';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voice-')), 'test.sqlite');

const {
  closeGuildSessions,
  closeOpenSessions,
  closeSession,
  formatDuration,
  getVoiceLeaderboard,
  getVoiceTime,
  heartbeat,
  isTracking,
  openSession,
} = await import('../src/voice.js');

const G = 'guild-1';
const MINUTE = 60_000;
const t0 = Date.now();

test('a closed session counts its length', () => {
  openSession(G, 'alice', t0);
  closeSession(G, 'alice', t0 + 30 * MINUTE);

  const stats = getVoiceTime(G, 'alice');
  assert.equal(stats.total, 30 * MINUTE);
  assert.equal(stats.sessions, 1);
  assert.equal(stats.longest, 30 * MINUTE);
  assert.equal(isTracking(G, 'alice'), false);
});

test('sessions add up and the longest one is kept', () => {
  openSession(G, 'alice', t0 + 60 * MINUTE);
  closeSession(G, 'alice', t0 + 130 * MINUTE);

  const stats = getVoiceTime(G, 'alice');
  assert.equal(stats.total, 100 * MINUTE);
  assert.equal(stats.sessions, 2);
  assert.equal(stats.longest, 70 * MINUTE);
  assert.equal(stats.perDay, stats.total / stats.days);
});

test('an open session counts up to right now, not to its last heartbeat', () => {
  openSession(G, 'bob', t0);
  assert.equal(isTracking(G, 'bob'), true);

  // Someone still in the call has time on the clock immediately, well before
  // the first heartbeat lands.
  assert.equal(getVoiceTime(G, 'bob', null, t0 + 5 * MINUTE).total, 5 * MINUTE);

  heartbeat(t0 + 15 * MINUTE);
  assert.equal(getVoiceTime(G, 'bob', null, t0 + 20 * MINUTE).total, 20 * MINUTE);

  closeSession(G, 'bob', t0 + 20 * MINUTE);
  assert.equal(getVoiceTime(G, 'bob', null, t0 + 99 * MINUTE).total, 20 * MINUTE);
});

test('a live session shows up in the total alongside finished ones', () => {
  openSession(G, 'gina', t0);
  closeSession(G, 'gina', t0 + 45 * MINUTE);
  openSession(G, 'gina', t0 + 60 * MINUTE);

  // 45 minutes banked plus 20 running.
  const stats = getVoiceTime(G, 'gina', null, t0 + 80 * MINUTE);
  assert.equal(stats.total, 65 * MINUTE);
  assert.equal(stats.sessions, 2);
  assert.equal(stats.longest, 45 * MINUTE);

  closeSession(G, 'gina', t0 + 80 * MINUTE);
});

test('opening twice does not leave two sessions running', () => {
  openSession(G, 'carol', t0);
  openSession(G, 'carol', t0 + 5 * MINUTE);

  // The first session is closed at the moment the second one starts, so the
  // time is counted once rather than twice.
  closeSession(G, 'carol', t0 + 10 * MINUTE);
  const stats = getVoiceTime(G, 'carol');
  assert.equal(stats.sessions, 2);
  assert.equal(stats.total, 10 * MINUTE);
});

test('closing when nothing is open changes nothing', () => {
  const before = getVoiceTime(G, 'carol').total;
  closeSession(G, 'carol', t0 + 99 * MINUTE);
  assert.equal(getVoiceTime(G, 'carol').total, before);
});

test('a crash costs at most one heartbeat, not the whole session', () => {
  openSession(G, 'dave', t0);
  heartbeat(t0 + 40 * MINUTE);

  // No close ever arrives; the next startup sweeps it up.
  assert.equal(closeOpenSessions() >= 1, true);
  assert.equal(isTracking(G, 'dave'), false);
  assert.equal(getVoiceTime(G, 'dave').total, 40 * MINUTE);
});

test('leaving a guild stops its sessions only', () => {
  openSession('guild-2', 'erin', t0);
  openSession(G, 'frank', t0);

  closeGuildSessions('guild-2', t0 + 10 * MINUTE);
  assert.equal(isTracking('guild-2', 'erin'), false);
  assert.equal(isTracking(G, 'frank'), true);
  assert.equal(getVoiceTime('guild-2', 'erin').total, 10 * MINUTE);

  closeSession(G, 'frank', t0 + MINUTE);
});

test('voice time is scoped per guild', () => {
  assert.equal(getVoiceTime(G, 'erin').total, 0);
  assert.equal(getVoiceTime('guild-2', 'alice').total, 0);
});

test('the leaderboard ranks by time spent', () => {
  const top = getVoiceLeaderboard(G, null, 10);

  assert.equal(top[0].userId, 'alice');
  assert.equal(top[0].total, 100 * MINUTE);
  assert.ok(top.every((row, i) => i === 0 || row.total <= top[i - 1].total));
  assert.ok(!top.some((row) => row.userId === 'erin'), 'other guilds stay out');
});

test('durations read as the two biggest useful units', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(45_000), '45s');
  assert.equal(formatDuration(90_000), '1m');
  assert.equal(formatDuration(48 * MINUTE), '48m');
  assert.equal(formatDuration(3 * 3600_000 + 24 * MINUTE), '3h 24m');
  assert.equal(formatDuration(2 * 3600_000), '2h');
  assert.equal(formatDuration(-5), '0s');
});
