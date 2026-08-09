import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.TIMEZONE ||= 'Europe/Berlin';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'roles-')), 'test.sqlite');

const { TIERS, forgetRoles, getRoleMap, rememberRole, rolesEnabled, syncMember, tierFor } = await import(
  '../src/roles.js'
);

const G = 'guild-1';

/** A stand-in for a guild member, recording what the bot tries to change. */
function fakeGuild(guildId, held = []) {
  const roles = new Set(held);
  const log = { added: [], removed: [] };

  return {
    id: guildId,
    log,
    roles,
    members: {
      fetch: async () => ({
        roles: {
          cache: { has: (id) => roles.has(id) },
          add: async (id) => {
            log.added.push(id);
            roles.add(id);
          },
          remove: async (id) => {
            log.removed.push(id);
            roles.delete(id);
          },
        },
      }),
    },
  };
}

test('every tier is one flame and a number, in ascending order', () => {
  assert.deepEqual(
    TIERS.map((tier) => tier.days),
    [1, 7, 30, 50, 100, 365],
  );

  for (const tier of TIERS) {
    assert.equal([...tier.name].filter((char) => char === '🔥').length, 1, `${tier.name} has one flame`);
    assert.ok(!/[☄️💎🌌]/u.test(tier.name), `${tier.name} uses no other emoji`);
    assert.ok(tier.name.includes(String(tier.days)), `${tier.name} names its day count`);
  }
});

test('a streak earns the highest tier it has reached', () => {
  assert.equal(tierFor(0), null);
  assert.equal(tierFor(1).days, 1);
  assert.equal(tierFor(6).days, 1);
  assert.equal(tierFor(7).days, 7);
  assert.equal(tierFor(49).days, 30);
  assert.equal(tierFor(364).days, 100);
  assert.equal(tierFor(1000).days, 365);
});

test('roles are off until a guild has a mapping', () => {
  assert.equal(rolesEnabled(G), false);
  for (const tier of TIERS) rememberRole(G, tier.days, `role-${tier.days}`);

  assert.equal(rolesEnabled(G), true);
  assert.equal(getRoleMap(G).get(30), 'role-30');
});

test('a member gets the earned role and nothing else', async () => {
  const guild = fakeGuild(G);
  const result = await syncMember(guild, 'alice', 7);

  assert.equal(result.added, 'role-7');
  assert.deepEqual(result.removed, []);
});

test('climbing a tier swaps the role instead of stacking them', async () => {
  const guild = fakeGuild(G, ['role-7']);
  const result = await syncMember(guild, 'alice', 30);

  assert.equal(result.added, 'role-30');
  assert.deepEqual(result.removed, ['role-7']);
  assert.deepEqual([...guild.roles], ['role-30']);

  // The old role goes before the new one arrives, so nobody wears two tiers.
  assert.ok(guild.log.removed.length > 0 && guild.log.added.length > 0);
});

test('an expired streak loses every streak role', async () => {
  const guild = fakeGuild(G, ['role-30']);
  const result = await syncMember(guild, 'alice', 0);

  assert.equal(result.added, null);
  assert.deepEqual(result.removed, ['role-30']);
  assert.equal(guild.roles.size, 0);
});

test('a member already on the right tier is left alone', async () => {
  const guild = fakeGuild(G, ['role-100']);
  const result = await syncMember(guild, 'alice', 120);

  assert.deepEqual(result, { added: null, removed: [] });
  assert.deepEqual(guild.log, { added: [], removed: [] });
});

test('roles other than the streak tiers are never touched', async () => {
  const guild = fakeGuild(G, ['moderator', 'role-7']);
  await syncMember(guild, 'alice', 50);

  assert.ok(guild.roles.has('moderator'));
  assert.deepEqual(guild.log.removed, ['role-7']);
});

test('a guild without a mapping is skipped entirely', async () => {
  const guild = fakeGuild('guild-2', ['role-7']);
  assert.equal(await syncMember(guild, 'alice', 30), null);
  assert.deepEqual(guild.log, { added: [], removed: [] });
});

test('turning roles off leaves the mapping empty', () => {
  assert.equal(forgetRoles(G), TIERS.length);
  assert.equal(rolesEnabled(G), false);
});
