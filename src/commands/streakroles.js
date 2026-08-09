import { EmbedBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { TIERS, ensureRoles, explainBlocker, forgetRoles, getRoleMap, sweepGuild } from '../roles.js';

export const data = new SlashCommandBuilder()
  .setName('streakroles')
  .setDescription('Hand out roles for voice streaks')
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub.setName('setup').setDescription('Create the streak roles and start handing them out'),
  )
  .addSubcommand((sub) => sub.setName('status').setDescription('Show which role stands for which streak'))
  .addSubcommand((sub) =>
    sub.setName('off').setDescription('Stop handing out streak roles (the roles themselves stay)'),
  );

const tierLine = (tier, roleId) => `${roleId ? `<@&${roleId}>` : `\`${tier.name}\``} — from **${tier.days}** day${tier.days === 1 ? '' : 's'}`;

async function setup(interaction) {
  const guild = interaction.guild;

  const blocker = explainBlocker(guild);
  if (blocker) {
    await interaction.editReply(`I cannot manage roles here. ${blocker}`);
    return;
  }

  const { created, kept } = await ensureRoles(guild);

  // Roles that already existed may have been dragged above the bot since, which
  // would make every assignment fail silently later on.
  const reach = explainBlocker(guild, kept);
  if (reach) {
    await interaction.editReply(`Roles are set up, but I cannot hand them all out yet. ${reach}`);
    return;
  }

  const changed = await sweepGuild(guild);
  const map = getRoleMap(guild.id);

  const embed = new EmbedBuilder()
    .setColor(0xff7a18)
    .setTitle('Streak roles are on')
    .setDescription(TIERS.map((tier) => tierLine(tier, map.get(tier.days))).join('\n'))
    .setFooter({
      text:
        `${created.length} role(s) created, ${kept.length} reused · ${changed} member(s) updated\n` +
        'Everyone keeps only their highest tier. Rename or recolour the roles freely — they are tracked by id.',
    });

  await interaction.editReply({ content: null, embeds: [embed] });
}

async function status(interaction) {
  const map = getRoleMap(interaction.guildId);

  if (map.size === 0) {
    await interaction.editReply('Streak roles are off here. Turn them on with `/streakroles setup`.');
    return;
  }

  const missing = TIERS.filter((tier) => {
    const roleId = map.get(tier.days);
    return !roleId || !interaction.guild.roles.cache.has(roleId);
  });

  const embed = new EmbedBuilder()
    .setColor(0xff7a18)
    .setTitle('Streak roles')
    .setDescription(TIERS.map((tier) => tierLine(tier, map.get(tier.days))).join('\n'));

  const blocker = explainBlocker(
    interaction.guild,
    [...map.values()].map((roleId) => interaction.guild.roles.cache.get(roleId)),
  );

  if (missing.length > 0) {
    embed.addFields({
      name: 'Deleted roles',
      value: `${missing.length} tier(s) no longer exist. Run \`/streakroles setup\` to recreate them.`,
    });
  }
  if (blocker) embed.addFields({ name: 'Not working right now', value: blocker });

  await interaction.editReply({ content: null, embeds: [embed] });
}

async function off(interaction) {
  const removed = forgetRoles(interaction.guildId);

  await interaction.editReply(
    removed > 0
      ? 'Streak roles are off. The roles are still in the server and whoever holds one keeps it — delete them yourself if you want them gone.'
      : 'Streak roles were already off.',
  );
}

export async function execute(interaction) {
  // Creating roles and sweeping the server both take longer than Discord's
  // three second reply window.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sub = interaction.options.getSubcommand();
  if (sub === 'setup') await setup(interaction);
  else if (sub === 'status') await status(interaction);
  else await off(interaction);
}
