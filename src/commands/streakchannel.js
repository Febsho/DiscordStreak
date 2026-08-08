import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { setAnnounceChannel } from '../settings.js';

export const data = new SlashCommandBuilder()
  .setName('streakchannel')
  .setDescription('Pick the channel where streak updates get posted')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName('channel')
      .setDescription('Text channel for announcements (leave empty to turn them off)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread),
  );

export async function execute(interaction) {
  const channel = interaction.options.getChannel('channel');
  setAnnounceChannel(interaction.guildId, channel?.id ?? null);

  await interaction.reply({
    content: channel ? `Streak updates will be posted in ${channel}.` : 'Streak announcements are now off.',
    flags: MessageFlags.Ephemeral,
  });
}
