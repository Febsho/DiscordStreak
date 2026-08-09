import { PermissionFlagsBits } from 'discord.js';
import { db } from './db.js';
import { getStreak } from './streaks.js';

/**
 * Streak tiers as roles. One flame in every name, so the roles read as one
 * family and the number is what changes; the colour heats up with the streak
 * and turns cosmic at a year.
 */
export const TIERS = [
  { days: 1, name: '🔥 1 day', colour: 0xffc773 },
  { days: 7, name: '🔥 7 days', colour: 0xffa033 },
  { days: 30, name: '🔥 30 days', colour: 0xff7a18 },
  { days: 50, name: '🔥 50 days', colour: 0xf04e23 },
  { days: 100, name: '🔥 100 days', colour: 0xd62246 },
  { days: 365, name: '🔥 365 days', colour: 0x7b2ff7 },
];

/** The highest tier a streak has reached, or null below the first one. */
export function tierFor(days) {
  let reached = null;
  for (const tier of TIERS) if (days >= tier.days) reached = tier;
  return reached;
}

const selectRoles = db.prepare('SELECT days, role_id AS roleId FROM streak_roles WHERE guild_id = ?');
const upsertRole = db.prepare(
  `INSERT INTO streak_roles (guild_id, days, role_id) VALUES (?, ?, ?)
   ON CONFLICT (guild_id, days) DO UPDATE SET role_id = excluded.role_id`,
);
const deleteRoles = db.prepare('DELETE FROM streak_roles WHERE guild_id = ?');
const selectTracked = db.prepare('SELECT user_id AS userId FROM streaks WHERE guild_id = ?');

/** days -> roleId for a guild. Empty when streak roles are switched off. */
export function getRoleMap(guildId) {
  return new Map(selectRoles.all(guildId).map((row) => [row.days, row.roleId]));
}

export function rememberRole(guildId, days, roleId) {
  upsertRole.run(guildId, days, roleId);
}

/** Stop managing roles here. The roles themselves stay, they just go unmanaged. */
export function forgetRoles(guildId) {
  return deleteRoles.run(guildId).changes;
}

export const rolesEnabled = (guildId) => getRoleMap(guildId).size > 0;

/**
 * Why the bot cannot hand out a role, in a sentence, or null when it can.
 * Discord rejects a role assignment unless the bot's own top role sits above
 * the role being handed out, which is the usual reason this fails.
 */
export function explainBlocker(guild, roles = []) {
  const me = guild.members.me;
  if (!me) return 'I could not look myself up in this server — try again in a moment.';
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'I am missing the **Manage Roles** permission.';
  }

  const tooHigh = roles.filter((role) => role && me.roles.highest.comparePositionTo(role) <= 0);
  if (tooHigh.length > 0) {
    return (
      `My own role sits below ${tooHigh.map((role) => `<@&${role.id}>`).join(', ')}. ` +
      'Drag my role above them in **Server Settings → Roles** and run this again.'
    );
  }

  return null;
}

/**
 * Create whatever streak role is missing and remember it. Roles that already
 * exist are left exactly as they are, so a renamed or recoloured role survives
 * a re-run.
 */
export async function ensureRoles(guild) {
  const map = getRoleMap(guild.id);
  const created = [];
  const kept = [];

  // New roles land just under the bot's own, which is both the highest spot
  // they may occupy and the one where their colour actually shows.
  const ceiling = Math.max(1, (guild.members.me?.roles.highest.position ?? 1) - 1);

  for (const tier of TIERS) {
    const existing = map.has(tier.days) ? guild.roles.cache.get(map.get(tier.days)) : null;
    if (existing) {
      kept.push(existing);
      continue;
    }

    const role = await guild.roles.create({
      name: tier.name,
      color: tier.colour,
      hoist: false,
      mentionable: false,
      permissions: [],
      position: ceiling,
      reason: `Streak role for ${tier.days} day${tier.days === 1 ? '' : 's'}`,
    });

    rememberRole(guild.id, tier.days, role.id);
    created.push(role);
  }

  return { created, kept };
}

/**
 * Give a member the role their streak has earned and take away the others, so
 * nobody ends up wearing several tiers at once. Returns what changed, or null
 * when this guild does not use streak roles.
 */
export async function syncMember(guild, userId, days) {
  const map = getRoleMap(guild.id);
  if (map.size === 0) return null;

  const target = tierFor(days);
  const wanted = target ? map.get(target.days) : null;
  const managed = [...map.values()];

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return null; // Left the server, or is not visible to us.

  const stale = managed.filter((roleId) => roleId !== wanted && member.roles.cache.has(roleId));
  const missing = wanted && !member.roles.cache.has(wanted) ? wanted : null;
  if (stale.length === 0 && !missing) return { added: null, removed: [] };

  const reason = `Streak is ${days} day${days === 1 ? '' : 's'}`;
  // Removals go first: a member briefly holding two tiers looks worse than
  // briefly holding none.
  for (const roleId of stale) await member.roles.remove(roleId, reason);
  if (missing) await member.roles.add(missing, reason);

  return { added: missing, removed: stale };
}

/**
 * Bring every tracked member in a guild back in line — the daily pass that
 * strips roles off streaks which quietly expired overnight.
 */
export async function sweepGuild(guild) {
  if (!rolesEnabled(guild.id)) return 0;

  let changed = 0;
  for (const { userId } of selectTracked.all(guild.id)) {
    try {
      const result = await syncMember(guild, userId, getStreak(guild.id, userId).currentStreak);
      if (result && (result.added || result.removed.length > 0)) changed += 1;
    } catch (error) {
      console.error(`Could not sync streak roles for ${userId} in ${guild.id}:`, error.message);
    }
  }

  return changed;
}
