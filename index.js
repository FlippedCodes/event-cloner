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

function getJobEvents(job, orgEvent) {
  const events = job.distribute.map((distributionGuildID) => {
    const guild = client.guilds.cache.get(distributionGuildID);
    const event = guild.scheduledEvents.cache
      .find((remoteEvent) => remoteEvent.description.includes(orgEvent.id));
    if (!event) return console.warn(`Unable to find the event "${orgEvent.name}" in the guild ${distributionGuildID}.`);
    return event;
  });
  return events;
}

// create overwrites due to missing cross guild support from discord
function eventOverwrite(suffixDesc, orgEvent) {
  // needs to be a copy or the event desc. gets copied to another job
  const guildEventEdit = JSON.parse(JSON.stringify(orgEvent));
  guildEventEdit.scheduledStartTime = orgEvent.scheduledStartTimestamp;
  guildEventEdit.scheduledEndTime = orgEvent.scheduledEndTimestamp
    ? orgEvent.scheduledEndTimestamp
    // plus 2 hours. discords default
    : orgEvent.scheduledStartTimestamp + 7.2e+6;
  guildEventEdit.description = `${orgEvent.description}\n${suffixDesc}\n\n${orgEvent.id}`;
  let location;
  switch (orgEvent.entityType) {
    case GuildScheduledEventEntityType.StageInstance:
      location = `Stage "${orgEvent.channel.name}" in ${orgEvent.guild.name}`;
      break;
    case GuildScheduledEventEntityType.Voice:
      location = `VC "${orgEvent.channel.name}" in ${orgEvent.guild.name}`;
      break;
    default:
      location = `"${orgEvent.entityMetadata.location}" in ${orgEvent.guild.name}`;
      break;
  }
  guildEventEdit.channelId = null;
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
        const guildEventEdit = eventOverwrite(job.eventDescSuffix, createdEvent);
        const guild = await client.guilds.cache.get(destriGuildID);
        guild.scheduledEvents.create(guildEventEdit);
      });
    });
});

// TODO: needs testing
client.on('guildScheduledEventUpdate', async (oldEvent, updatedEvent) => {
  const jobList = getJobList(updatedEvent);
  const eventList = jobList.map((job) => [getJobEvents(job, updatedEvent), job.eventDescSuffix]);
  eventList.forEach(([events, eventDesc]) => {
    // event starts
    if (updatedEvent.isActive()) events.forEach((event) => (event ? event.setStatus(GuildScheduledEventStatus.Active) : null));
    // ended successfully
    else if (updatedEvent.isCompleted()) events.forEach((event) => (event ? event.setStatus(GuildScheduledEventStatus.Completed) : null));
    // general update
    else if (updatedEvent.isScheduled()) {
      events.forEach((event) => {
        if (!event) return;
        const guildEventEdit = eventOverwrite(eventDesc, updatedEvent);
        event.edit(guildEventEdit);
      });
    } else console.warn(`Unknown update on the event ${updatedEvent.id} - ${updatedEvent.name}`);
  });
});

client.on('guildScheduledEventDelete', async (deletedEvent) => {
  const jobList = getJobList(deletedEvent);
  jobList.forEach((job) => {
    const events = getJobEvents(job, deletedEvent);
    events.forEach((event) => (event ? event.delete() : null));
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

// TODO: needs testing
client.on('guildScheduledEventUpdate', async (oldEvent, updatedEvent) => {
  // event starts
  if (updatedEvent.isActive()) {
    config.functions.eventAnnounce.jobs.filter((job) => job.type.started).forEach((job) => {
      announcementHandler({
        event: updatedEvent,
        job,
        update: `Event **${updatedEvent.name}** has has started!`,
        color: 'Blurple',
      });
    });
  // ended successfully
  } else if (updatedEvent.isCompleted()) {
    config.functions.eventAnnounce.jobs.filter((job) => job.type.ended).forEach((job) => {
      announcementHandler({
        event: updatedEvent,
        job,
        update: `Event **${updatedEvent.name}** is now over.\nThanks for joining`,
        color: 'DarkBlue',
      });
    });
  // general update
  } else if (updatedEvent.isScheduled()) {
    config.functions.eventAnnounce.jobs.filter((job) => job.type.generalUpdate).forEach((job) => {
      announcementHandler({
        event: updatedEvent,
        job,
        update: `Event **${updatedEvent.name}** has been updated.\nCheck the event to see the updates.`,
        color: 'DarkGreen',
        text: `${job.message}\n${updatedEvent}`,
      });
    });
  } else console.warn(`Unknown update on the event ${updatedEvent.id} - ${updatedEvent.name}`);
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
