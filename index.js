// init Discord
import {
  Client,
  IntentsBitField,
  Partials,
  EmbedBuilder,
  GuildScheduledEventStatus,
  GuildScheduledEventEntityType,
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
    .filter((job) => (guildEvent.entityType === GuildScheduledEventEntityType.StageInstance ? job.type.stageInstance : true))
    .filter((job) => (guildEvent.entityType === GuildScheduledEventEntityType.Voice ? job.type.voice : true))
    .filter((job) => (guildEvent.entityType === GuildScheduledEventEntityType.External ? job.type.external : true));
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

function getJobEvents(job) {
  const events = job.distribute.map((distributionGuildID) => {
    const guild = client.guilds.cache.get(distributionGuildID);
    const event = guild.scheduledEvents.cache
      .find((remoteEvent) => remoteEvent.description.includes(deletedEvent.id));
    if (!event) return console.warn(`Unable to find the event "${deletedEvent.name}" in the guild ${distributionGuildID}. The event was most likely edited or the bot was offline and didn't catch the update.`);
    return event;
  });
  return events;
}

// create overwrites due to missing cross guild support from discord
function eventOverwrite(orgEvent) {
  const guildEventEdit = orgEvent;
  guildEventEdit.scheduledStartTime = orgEvent.scheduledStartTimestamp;
  guildEventEdit.scheduledEndTime = createdEvent.scheduledEndTimestamp
    ? createdEvent.scheduledEndTimestamp
    // plus 2 hours. discords default
    : createdEvent.scheduledStartTimestamp + 7.2e+6;
  guildEventEdit.description = `${orgEvent.description}\n${job.eventDescSuffix}\n\n${orgEvent.id}`;
  let location;
  switch (orgEvent.entityType) {
    case GuildScheduledEventEntityType.StageInstance:
      location = `Stage "${orgEvent.channel.name}" in ${orgEvent.guild.name}`;
      return;
    case GuildScheduledEventEntityType.Voice:
      location = `VC "${orgEvent.channel.name}" in ${orgEvent.guild.name}`;
      return;
    default:
      location = `"${orgEvent.entityMetadata.location}" in ${orgEvent.guild.name}`;
  }
  guildEventEdit.entityMetadata = { location };
  guildEventEdit.entityType = 3;
  return guildEventEdit;
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
        const guildEventEdit = eventOverwrite(updatedEvent);
        const guild = await client.guilds.cache.get(destriGuildID);
        guild.scheduledEvents.create(guildEventEdit);
      });
    });
});

// TODO: needs testing
client.on('guildScheduledEventUpdate', async (oldEvent, updatedEvent) => {
  const jobList = getJobList(updatedEvent);
  const eventList = jobList.map((job) => getJobEvents(job));
  // event starts
  if (updatedEvent.isActive()) eventList.forEach((event) => event.setStatus(GuildScheduledEventStatus.Active));
  // ended successfully
  else if (updatedEvent.isCompleted()) eventList.forEach((event) => event.setStatus(GuildScheduledEventStatus.Completed));
  // general update
  else if (updatedEvent.isScheduled()) {
    const guildEventEdit = eventOverwrite(updatedEvent);
    eventList.forEach((event) => event.edit(guildEventEdit));
  } else console.warn(`Unknown update on the event ${updatedEvent.id} - ${updatedEvent.name}`);
});

client.on('guildScheduledEventDelete', async (deletedEvent) => {
  const jobList = getJobList(deletedEvent);
  jobList.forEach((job) => {
    const events = getJobEvents(job);
    events.forEach((event) => event.delete());
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
