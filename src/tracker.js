import { ChannelType, EmbedBuilder } from 'discord.js';
import { config } from './config.js';
import { flame, recordDay } from './streaks.js';
import { getAnnounceChannel } from './settings.js';
import { secondsUntilNextDay } from './time.js';
import { closeGuildSessions, closeOpenSessions, closeSession, heartbeat, isTracking, openSession } from './voice.js';
import { forgetRoles, sweepGuild, syncMember } from './roles.js';

// How often open sessions are marked alive. A kill -9 or a pulled plug loses at
// most this much of whoever was in a call.
const HEARTBEAT_MS = 60_000;

/** guildId:userId -> pending timer that credits the day once the timer fires. */
const pending = new Map();

const key = (guildId, userId) => `${guildId}:${userId}`;

/**
 * A voice state only counts while the member is actually reachable: in a real
 * voice channel, not parked in the AFK channel, and not deafened.
 */
function isEligible(state) {
  if (!state?.channelId || !state.guild) return false;
  if (state.member?.user?.bot) return false;
  if (config.countAfk) return true;
  if (state.channelId === state.guild.afkChannelId) return false;
  if (state.deaf || state.selfDeaf) return false;
  return true;
}

function cancel(guildId, userId) {
  const timer = pending.get(key(guildId, userId));
  if (timer) {
    clearTimeout(timer);
    pending.delete(key(guildId, userId));
  }
}

function schedule(client, guildId, userId, delaySeconds) {
  cancel(guildId, userId);
  const timer = setTimeout(() => {
    pending.delete(key(guildId, userId));
    void credit(client, guildId, userId);
  }, Math.max(0, delaySeconds) * 1000);
  timer.unref?.();
  pending.set(key(guildId, userId), timer);
}

async function credit(client, guildId, userId) {
  const guild = client.guilds.cache.get(guildId);
  const state = guild?.voiceStates.cache.get(userId);
  if (!isEligible(state)) return;

  const result = recordDay(guildId, userId);

  // Still in the call? Re-check just after midnight so a session that runs
  // through the night also lights up the new day.
  schedule(client, guildId, userId, secondsUntilNextDay() + 1);

  if (!result.counted) return;

  await announce(client, guildId, userId, result);

  // A streak that just grew may have crossed into the next tier.
  try {
    await syncMember(guild, userId, result.currentStreak);
  } catch (error) {
    console.error(`Could not update streak roles for ${userId} in ${guildId}:`, error.message);
  }
}

/**
 * Once a day, put every tracked member back on the tier their streak is
 * actually worth — the only way a role comes off a streak that expired while
 * nobody was in voice.
 */
function scheduleSweep(client) {
  const timer = setTimeout(async () => {
    for (const guild of client.guilds.cache.values()) {
      try {
        const changed = await sweepGuild(guild);
        if (changed > 0) console.log(`Streak roles: updated ${changed} member(s) in ${guild.name}.`);
      } catch (error) {
        console.error(`Streak role sweep failed in ${guild.id}:`, error.message);
      }
    }

    scheduleSweep(client);
  }, (secondsUntilNextDay() + 60) * 1000);

  timer.unref?.();
}

async function announce(client, guildId, userId, result) {
  const channelId = getAnnounceChannel(guildId);
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || channel.type === ChannelType.GuildVoice) return;

    const embed = new EmbedBuilder()
      .setColor(0xff7a18)
      .setDescription(
        result.started
          ? `<@${userId}> started a streak! ${flame(result.currentStreak)} **1 day**`
          : result.continued
            ? `<@${userId}> kept the streak alive! ${flame(result.currentStreak)} **${result.currentStreak} days**`
            : `<@${userId}> is back — new streak. ${flame(result.currentStreak)} **1 day**`,
      );

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error(`Could not announce streak in guild ${guildId}:`, error.message);
  }
}

/** Wire up voice tracking and pick up anyone already sitting in a call. */
export function registerTracker(client) {
  // Anything left open belongs to a previous run: close it at its last
  // heartbeat before opening today's sessions, so a crash cannot leave a
  // session running forever.
  const recovered = closeOpenSessions();
  if (recovered > 0) console.log(`Closed ${recovered} voice session(s) left open by the previous run.`);

  client.on('voiceStateUpdate', (oldState, newState) => {
    const guildId = newState.guild.id;
    const userId = newState.id;

    if (!isEligible(newState)) {
      cancel(guildId, userId);
      closeSession(guildId, userId);
      return;
    }

    // Moving between channels (or muting) shouldn't restart the clock.
    if (!isTracking(guildId, userId)) openSession(guildId, userId);
    if (isEligible(oldState) && pending.has(key(guildId, userId))) return;

    schedule(client, guildId, userId, config.minSeconds);
  });

  client.on('guildDelete', (guild) => {
    for (const k of pending.keys()) {
      if (k.startsWith(`${guild.id}:`)) {
        clearTimeout(pending.get(k));
        pending.delete(k);
      }
    }
    closeGuildSessions(guild.id);
    // The roles went with the server; a stale mapping would only misfire on a
    // later re-invite.
    forgetRoles(guild.id);
  });

  for (const guild of client.guilds.cache.values()) {
    for (const state of guild.voiceStates.cache.values()) {
      if (!isEligible(state)) continue;
      openSession(guild.id, state.id);
      schedule(client, guild.id, state.id, config.minSeconds);
    }
  }

  const ticker = setInterval(() => heartbeat(), HEARTBEAT_MS);
  ticker.unref?.();

  scheduleSweep(client);
}
