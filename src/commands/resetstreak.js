import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { resetStreak } from '../streaks.js';

export const data = new SlashCommandBuilder()
  .setName('resetstreak')
  .setDescription('Wipe someone\'s streak history')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addUserOption((option) => option.setName('user').setDescription('Whose streak to wipe').setRequired(true));

export async function execute(interaction) {
  const user = interaction.options.getUser('user');
  resetStreak(interaction.guildId, user.id);

  await interaction.reply({
    content: `Reset every streak record for **${user.displayName}**.`,
    flags: MessageFlags.Ephemeral,
  });
}
