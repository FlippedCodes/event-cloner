// init Discord
import {
  Client, IntentsBitField, Partials, EmbedBuilder,
} from 'discord.js';
// init config
import { readFileSync } from 'fs';
// Needs to be implemented this way as eslint doesn't support asserts yet.
const config = JSON.parse(readFileSync('./config.json'));
config.package = JSON.parse(readFileSync('./package.json'));
// init Discord client
const client = new Client({
  intents: new IntentsBitField([
    IntentsBitField.Flags.GuildScheduledEvents,
    IntentsBitField.Flags.Guilds,
  ]),
  partials: [Partials.GuildScheduledEvent],
});

const DEBUG = process.env.NODE_ENV === 'development';

const ERR = (err) => {
  console.error('ERROR:', err);
  if (DEBUG) return;
  const embed = new EmbedBuilder()
    .setAuthor({ name: `Error: '${err.message}'` })
    .setDescription(`STACKTRACE:\n\`\`\`${err.stack.slice(0, 4000)}\`\`\``)
    .setColor('Red');
  client.channels.cache.get(config.logChannel).send({ embeds: [embed] });
};

function getJobList(guildEvent) {
  return config.functions.eventCloner.jobs
    // filter if event is being listened to
    .filter((job) => job.listen.includes(guildEvent.guildId))
    // filter if event type is active
    .filter((job) => (guildEvent.entityType === 1 ? job.type.stageInstance : true))
    .filter((job) => (guildEvent.entityType === 2 ? job.type.voice : true))
    .filter((job) => (guildEvent.entityType === 3 ? job.type.external : true));
}

function announcementHandler({
  event, job, update, color, text,
}) {
  job.channels.forEach(async (announceChannelID) => {
    // check if channel is in guild where the update was posted
    const channel = client.channels.cache.get(announceChannelID);
    if (!channel) return console.warn(`Channel ${announceChannelID} doesn't exist. Please check the ID and permissions`);
    if (channel.guild.id !== event.guildId) return;
    const embed = new EmbedBuilder()
      .setDescription(update)
      .setColor(color);
    channel.send({ content: text, embeds: [embed] });
  });
}

client.on('ready', async () => {
  // confirm user logged in
  console.log(`[${config.package.name}] Logged in as "${client.user.tag}"!`);
});

// ##################################################################
//                         event handler
// ##################################################################

client.on('guildScheduledEventCreate', async (createdEvent) => {
  const jobList = getJobList(createdEvent);
  jobList
    // run create on all jobs
    .forEach((job) => {
      job.distribute.forEach(async (destriGuildID) => {
        const guild = await client.guilds.cache.get(destriGuildID);
        // create overwrites due to missing cross guild support from discord
        const guildEventEdit = createdEvent;
        guildEventEdit.scheduledStartTime = createdEvent.scheduledStartTimestamp;
        guildEventEdit.scheduledEndTime = createdEvent.scheduledEndTimestamp;
        if (createdEvent.entityType !== 3) {
          // plus 2 hours. discords default
          guildEventEdit.scheduledEndTime = createdEvent.scheduledStartTimestamp + 7.2e+6;
        }
        guildEventEdit.description = `${createdEvent.description}\n${job.eventDescSuffix}\n\n${createdEvent.id}`;
        let location;
        switch (createdEvent.entityType) {
          case 1:
            location = `Stage "${createdEvent.channel.name}" in ${createdEvent.guild.name}`;
            break;
          case 2:
            location = `VC "${createdEvent.channel.name}" in ${createdEvent.guild.name}`;
            break;
          default:
            location = createdEvent.entityMetadata.location;
            break;
        }
        guildEventEdit.entityMetadata = { location };
        guildEventEdit.entityType = 3;
        guild.scheduledEvents.create(guildEventEdit);
      });
    });
});

// client.on('guildScheduledEventUpdate', async (updatedEvent) => {
//   const jobList = getJobList(updatedEvent);
//   jobList.forEach((job) => {
//     job.distribute.forEach(async (distributionGuildID) => {
//       const guild = await client.guilds.cache.get(distributionGuildID);
//       const event = guild.scheduledEvents.cache
//         .find((remoteEvent) => remoteEvent.description.includes(updatedEvent.id));
//       if (!event) return console.warn(`Unable to find the event "${updatedEvent.name}" in the guild ${distributionGuildID}. The event was most likely edited or the bot was offline and didn't catch the update.`);
//       event.delete(event);
//     });
//   });
// });

client.on('guildScheduledEventDelete', async (deletedEvent) => {
  const jobList = getJobList(deletedEvent);
  jobList.forEach((job) => {
    job.distribute.forEach(async (distributionGuildID) => {
      const guild = await client.guilds.cache.get(distributionGuildID);
      const event = guild.scheduledEvents.cache
        .find((remoteEvent) => remoteEvent.description.includes(deletedEvent.id));
      if (!event) return console.warn(`Unable to find the event "${deletedEvent.name}" in the guild ${distributionGuildID}. The event was most likely edited or the bot was offline and didn't catch the update.`);
      event.delete(event);
    });
  });
});

// ##################################################################
//                         event announcer
// ##################################################################

client.on('guildScheduledEventCreate', async (createdEvent) => {
  config.functions.eventAnnounce.jobs.filter((job) => job.type.created).forEach((job) => {
    announcementHandler({
      event: createdEvent,
      job,
      update: 'New Event!',
      color: 'Green',
      text: `${job.message}\n${createdEvent}`,
    });
  });
});

client.on('guildScheduledEventDelete', async (deletedEvent) => {
  config.functions.eventAnnounce.jobs.filter((job) => job.type.deleted).forEach((job) => {
    announcementHandler({
      event: deletedEvent,
      job,
      update: `Event **${deletedEvent.name}** got cancelled.`,
      color: 'Red',
    });
  });
});

// announcing debug mode
if (DEBUG) console.log(`[${config.package.name}] Bot is on Debug-Mode. Some functions are not going to be loaded.`);

client.login(process.env.discordToken);

// logging errors and warns
client.on('error', (ERR));
client.on('warn', (ERR));
process.on('uncaughtException', (ERR));
