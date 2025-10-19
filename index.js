// --- KEEP-ALIVE SERVER FOR REPLIT ---
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is alive and running!');
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Keep-alive server running on port ${PORT}`));
// --- END KEEP-ALIVE ---
const { Client, GatewayIntentBits, Partials, EmbedBuilder, Routes, REST, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fetch = require('node-fetch');
const Database = require('better-sqlite3');
const { DateTime } = require('luxon');

// === CONFIGURATION ===
const TZ = 'America/Montreal';
const CHANNELS = {
  training: '1386906538165403668',
  supervisor: '1411404498345136190',
  backup: '1397115006230990848',
  vip: '1397114969660850287',
  untrained: '1403165293164892330',
  chat: '1386853141298937886'
};
const ROLES = {
  esdStaff: '1403498912765186241',
  adjutant: '1410401850095702179',
  fieldOfficer: '1389652230499467355',
  verified: '1405551984735555614',
  vip: '1386840778499690497',
  echoCompany: '1389258683606892596',
  hostile: '1404227450459656304',
  vipProtection: '1404133238292746283',
  backup: '1403117135168934030',
  untrainedMember: '1403089229227229184',
  supervisor: '1403087261528100904', // Additional role for all commands
  admin: '1403090295314186412' // Additional role for all commands
};

// === DATABASE SETUP ===
const db = new Database('./requests.db');
db.pragma('journal_mode = WAL');
db.prepare(`
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    guildId TEXT NOT NULL,
    channelId TEXT NOT NULL,
    userId TEXT NOT NULL,
    data TEXT NOT NULL,
    startTs INTEGER,
    endTs INTEGER,
    messageId TEXT
  )
`).run();

// === DISCORD CLIENT ===
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

// === UTILITIES ===
async function getRobloxProfile(discordId) {
  const res = await fetch(`https://verify.eryn.io/api/user/${discordId}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.robloxId) return null;
  return `https://www.roblox.com/users/${data.robloxId}/profile`;
}

function fmt(dt) {
  return dt.setZone(TZ).toFormat('yyyy-LL-dd HH:mm');
}

function humanDiff(from, to) {
  const dur = to.diff(from, ['hours', 'minutes']).toObject();
  const h = Math.trunc(dur.hours || 0);
  const m = Math.trunc(dur.minutes || 0);
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m || !parts.length) parts.push(`${m}m`);
  return parts.join(' ');
}

function toDiscordTimestamp(datetime, format = 'R') {
  const timestamp = Math.floor(datetime.toSeconds());
  return `<t:${timestamp}:${format}>`;
}

// Store temporary interaction data
const pendingRequests = new Map();

function createDateTimeModal(requestId, commandType) {
  const modal = new ModalBuilder()
    .setCustomId(`datetime_modal_${requestId}`)
    .setTitle(`Schedule ${commandType.charAt(0).toUpperCase() + commandType.slice(1)} Request`);

  // Date input
  const dateInput = new TextInputBuilder()
    .setCustomId('date_input')
    .setLabel('Date')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('YYYY-MM-DD (e.g., 2025-09-05)')
    .setRequired(true);

  // Start time input
  const startTimeInput = new TextInputBuilder()
    .setCustomId('start_time_input')
    .setLabel('Start Time (in YOUR timezone)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('HH:MM (e.g., 17:40)')
    .setRequired(true);

  // End time input
  const endTimeInput = new TextInputBuilder()
    .setCustomId('end_time_input')
    .setLabel('End Time (in YOUR timezone)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('HH:MM (e.g., 18:00)')
    .setRequired(true);

  // Timezone input
  const timezoneInput = new TextInputBuilder()
    .setCustomId('timezone_input')
    .setLabel('Your Timezone')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('EST, CET, PST, GMT, etc. (or UTC+1, UTC-5)')
    .setRequired(true);

  // Add components to action rows
  const dateRow = new ActionRowBuilder().addComponents(dateInput);
  const startTimeRow = new ActionRowBuilder().addComponents(startTimeInput);
  const endTimeRow = new ActionRowBuilder().addComponents(endTimeInput);
  const timezoneRow = new ActionRowBuilder().addComponents(timezoneInput);

  modal.addComponents(dateRow, startTimeRow, endTimeRow, timezoneRow);
  
  return modal;
}

// Helper function to parse timezone input
function parseTimezone(timezoneInput) {
  const input = timezoneInput.toUpperCase().trim();
  
  // Common timezone abbreviations
  const timezoneMap = {
    'EST': 'America/New_York',
    'EDT': 'America/New_York',
    'CST': 'America/Chicago', 
    'CDT': 'America/Chicago',
    'MST': 'America/Denver',
    'MDT': 'America/Denver',
    'PST': 'America/Los_Angeles',
    'PDT': 'America/Los_Angeles',
    'CET': 'Europe/Paris',
    'CEST': 'Europe/Paris',
    'ECT': 'Europe/Paris', // Europe Central Time
    'GMT': 'Europe/London',
    'BST': 'Europe/London',
    'UTC': 'UTC'
  };
  
  // Check direct timezone name match
  if (timezoneMap[input]) {
    return timezoneMap[input];
  }
  
  // Check UTC offset format (UTC+1, UTC-5, etc.)
  const utcMatch = input.match(/^UTC([+-])(\d{1,2})$/);
  if (utcMatch) {
    const sign = utcMatch[1];
    const hours = parseInt(utcMatch[2]);
    return `UTC${sign}${hours.toString().padStart(2, '0')}:00`;
  }
  
  // If no match found, return null
  return null;
}

// === SCHEDULER ===
setInterval(async () => {
  const now = Math.floor(Date.now() / 1000);
  const rows = db.prepare('SELECT * FROM requests WHERE endTs IS NOT NULL AND endTs > ? ORDER BY startTs ASC').all(now);

  for (const row of rows) {
    const startMs = (row.startTs - 900) * 1000; // send 15 min before start
    const endMs = row.endTs * 1000;

    if (!row.messageId && Date.now() >= startMs) {
      try {
        const channel = await client.channels.fetch(row.channelId);
        if (!channel?.isTextBased()) continue;

        const data = JSON.parse(row.data);
        const message = await channel.send({ content: data.content });
        db.prepare('UPDATE requests SET messageId=? WHERE id=?').run(message.id, row.id);
      } catch (e) {
        console.error('Send failed', e);
      }
    }

    if (row.messageId && Date.now() >= endMs) {
      try {
        const channel = await client.channels.fetch(row.channelId);
        if (channel?.isTextBased()) {
          const msg = await channel.messages.fetch(row.messageId).catch(() => null);
          if (msg) await msg.delete().catch(() => null);
        }
      } catch {}
      db.prepare('DELETE FROM requests WHERE id=?').run(row.id);
    }
  }
}, 20000);

// === SLASH COMMAND HANDLING ===
client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag} (TZ: ${TZ})`);
});

// Channel restrictions and role permissions for each command
const COMMAND_PERMISSIONS = {
  training: {
    channel: CHANNELS.training,
    roles: [ROLES.esdStaff, ROLES.supervisor, ROLES.admin]
  },
  supervisor: {
    channel: CHANNELS.supervisor, 
    roles: [ROLES.adjutant, ROLES.fieldOfficer, ROLES.supervisor, ROLES.admin]
  },
  backup: {
    channel: CHANNELS.backup,
    roles: [ROLES.verified, ROLES.supervisor, ROLES.admin]
  },
  vip: {
    channel: CHANNELS.vip,
    roles: [ROLES.esdStaff, ROLES.vip, ROLES.supervisor, ROLES.admin]
  },
  untrained: {
    channel: CHANNELS.untrained,
    roles: [ROLES.esdStaff, ROLES.untrainedMember, ROLES.supervisor, ROLES.admin]
  },
  hostile: {
    channel: CHANNELS.chat,
    roles: [ROLES.verified, ROLES.esdStaff, ROLES.adjutant, ROLES.fieldOfficer, ROLES.vip, ROLES.supervisor, ROLES.admin]
  }
};

function hasRole(member, requiredRoles) {
  return requiredRoles.some(roleId => member.roles.cache.has(roleId));
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, channelId, user, guildId, member } = interaction;
  const permissions = COMMAND_PERMISSIONS[commandName];
  
  if (!permissions) return;
  
  // Check if command is allowed in this channel
  if (permissions.channel !== channelId) {
    await interaction.reply({
      content: `❌ This command can only be used in <#${permissions.channel}>`,
      flags: 64 // EPHEMERAL flag
    });
    return;
  }
  
  // Check if user has required role
  if (!hasRole(member, permissions.roles)) {
    await interaction.reply({
      content: `❌ You don't have permission to use this command.`,
      flags: 64 // EPHEMERAL flag
    });
    return;
  }

  try {
    if (commandName === 'hostile') {
      // Handle hostile ping command - ping both hostile role and requesting user
      const description = interaction.options.getString('description');
      
      await interaction.reply({
        content: `<@${user.id}> <@&${ROLES.hostile}> ${description}`,
        allowedMentions: { users: [user.id], roles: [ROLES.hostile] }
      });
      return;
    }

    if (commandName === 'backup') {
      // Handle backup request (no time scheduling, immediate)
      const description = interaction.options.getString('description');
      const manualRoblox = interaction.options.getString('roblox_profile');
      const autoRoblox = await getRobloxProfile(user.id);
      const robloxProfile = manualRoblox || autoRoblox;
      
      const message = `[Roblox Link]: ${robloxProfile || 'Not linked'}\n[Description]: ${description}\n[Ping]: <@&${ROLES.backup}>`;
      
      await interaction.reply({
        content: message,
        allowedMentions: { roles: [ROLES.backup] }
      });
      return;
    }

    if (commandName === 'vip') {
      // Handle VIP request with manual profile and time selection
      const requesting = interaction.options.getString('requesting');
      const needing = interaction.options.getString('needing');
      const robloxProfile = interaction.options.getString('roblox_profile');
      
      // Store VIP request data
      const requestId = `${user.id}_${Date.now()}`;
      pendingRequests.set(requestId, {
        type: 'vip',
        commandName,
        guildId,
        channelId,
        userId: user.id,
        requesting,
        needing,
        robloxProfile
      });

      const modal = createDateTimeModal(requestId, commandName);
      await interaction.showModal(modal);
      return;
    }

    // Handle scheduled commands that need time selection (training, supervisor, untrained)
    const description = interaction.options.getString('description');
    
    // Store request data
    const requestId = `${user.id}_${Date.now()}`;
    pendingRequests.set(requestId, {
      type: 'scheduled',
      commandName,
      guildId,
      channelId,
      userId: user.id,
      description
    });

    const modal = createDateTimeModal(requestId, commandName);
    await interaction.showModal(modal);
    
  } catch (error) {
    console.error('Error handling slash command:', error);
    await interaction.reply({
      content: '❌ An error occurred while processing your request.',
      flags: 64 // EPHEMERAL flag
    });
  }
});

// Handle modal submissions for date/time selection
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;

  if (!interaction.customId.startsWith('datetime_modal_')) return;

  const requestId = interaction.customId.replace('datetime_modal_', '');
  const pendingRequest = pendingRequests.get(requestId);
  
  if (!pendingRequest) {
    await interaction.reply({
      content: '❌ This request has expired. Please start again.',
      flags: 64
    });
    return;
  }

  try {
    // Get the date and time values from the modal
    const dateValue = interaction.fields.getTextInputValue('date_input');
    const startTimeValue = interaction.fields.getTextInputValue('start_time_input');
    const endTimeValue = interaction.fields.getTextInputValue('end_time_input');
    const timezoneValue = interaction.fields.getTextInputValue('timezone_input');
    
    // Parse the date (YYYY-MM-DD format)
    const dateMatch = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
      await interaction.reply({
        content: '❌ Invalid date format. Please use YYYY-MM-DD (e.g., 2025-09-05)',
        flags: 64
      });
      return;
    }
    
    // Parse start time (HH:MM format)
    const startTimeMatch = startTimeValue.match(/^(\d{1,2}):(\d{2})$/);
    if (!startTimeMatch) {
      await interaction.reply({
        content: '❌ Invalid start time format. Please use HH:MM (e.g., 14:30)',
        flags: 64
      });
      return;
    }
    
    // Parse end time (HH:MM format)
    const endTimeMatch = endTimeValue.match(/^(\d{1,2}):(\d{2})$/);
    if (!endTimeMatch) {
      await interaction.reply({
        content: '❌ Invalid end time format. Please use HH:MM (e.g., 16:30)',
        flags: 64
      });
      return;
    }
    
    // Parse and validate timezone
    const userTimezone = parseTimezone(timezoneValue);
    if (!userTimezone) {
      await interaction.reply({
        content: '❌ Invalid timezone. Please use EST, CET, PST, GMT, UTC+1, UTC-5, etc.',
        flags: 64
      });
      return;
    }
    
    // Build DateTime objects in USER's timezone first
    const startDtUser = DateTime.fromObject({
      year: parseInt(dateMatch[1]),
      month: parseInt(dateMatch[2]),
      day: parseInt(dateMatch[3]),
      hour: parseInt(startTimeMatch[1]),
      minute: parseInt(startTimeMatch[2])
    }, { zone: userTimezone });
    
    const endDtUser = DateTime.fromObject({
      year: parseInt(dateMatch[1]),
      month: parseInt(dateMatch[2]),
      day: parseInt(dateMatch[3]),
      hour: parseInt(endTimeMatch[1]),
      minute: parseInt(endTimeMatch[2])
    }, { zone: userTimezone });
    
    // Convert to Montreal timezone for storage and comparison
    const startDt = startDtUser.setZone(TZ);
    const endDt = endDtUser.setZone(TZ);
    
    // Validate DateTime objects
    if (!startDt.isValid || !endDt.isValid) {
      await interaction.reply({
        content: '❌ Invalid date or time. Please check your input and try again.',
        flags: 64
      });
      return;
    }
    
    // Validate time logic
    if (endDt <= startDt) {
      await interaction.reply({
        content: '❌ End time must be after start time.',
        flags: 64
      });
      return;
    }
    
    if (startDt < DateTime.now()) {
      await interaction.reply({
        content: '❌ Start time must be in the future.',
        flags: 64
      });
      return;
    }
    
    // Create Discord timestamps
    const startTimestamp = toDiscordTimestamp(startDt, 'F');
    const endTimestamp = toDiscordTimestamp(endDt, 'F');
    const relativeStart = toDiscordTimestamp(startDt, 'R');
    
    // Create message based on command type
    let messageContent = '';
    
    if (pendingRequest.type === 'vip') {
      let pingRole = pendingRequest.requesting === 'VIP' ? ROLES.vip : ROLES.vipProtection;
      let needingField = '';
      
      if (pendingRequest.requesting === 'VIP' && pendingRequest.needing) {
        needingField = `\n[Needing]: ${pendingRequest.needing}`;
      }
      
      messageContent = `[Username]: <@${pendingRequest.userId}>\n[Time]: ${startTimestamp} - ${endTimestamp} (${relativeStart})\n[Requesting]: ${pendingRequest.requesting}${needingField}\n[Profile]: ${pendingRequest.robloxProfile}\n[Ping]: <@&${pingRole}>`;
    } else {
      // Scheduled commands (training, supervisor, untrained)
      let pingRole;
      if (pendingRequest.commandName === 'training') {
        pingRole = `<@&${ROLES.echoCompany}> <@&${ROLES.adjutant}>`;
      } else if (pendingRequest.commandName === 'supervisor') {
        pingRole = `<@&${ROLES.supervisor}>`;
      } else if (pendingRequest.commandName === 'untrained') {
        pingRole = `<@&${ROLES.echoCompany}>`;
      }
      
      const fieldName = pendingRequest.commandName === 'supervisor' ? 'Training' : 'Training';
      messageContent = `[Username]: <@${pendingRequest.userId}>\n[${fieldName}]: ${pendingRequest.description}\n[Time]: ${startTimestamp} - ${endTimestamp} (${relativeStart})\n[Ping]: ${pingRole}`;
    }
    
    // Save to database
    const requestData = { content: messageContent };
    const stmt = db.prepare(`
      INSERT INTO requests (type, guildId, channelId, userId, data, startTs, endTs)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      pendingRequest.commandName,
      pendingRequest.guildId,
      pendingRequest.channelId,
      pendingRequest.userId,
      JSON.stringify(requestData),
      Math.floor(startDt.toSeconds()),
      Math.floor(endDt.toSeconds())
    );
    
    // Reply with success message showing both user's time and Discord timestamps
    const userTzName = userTimezone.includes('/') ? userTimezone.split('/')[1].replace('_', ' ') : timezoneValue.toUpperCase();
    
    await interaction.reply({
      content: `✅ **${pendingRequest.commandName.charAt(0).toUpperCase() + pendingRequest.commandName.slice(1)} request scheduled!**\n\n**Your time (${userTzName}):** ${startDtUser.toFormat('MMM dd, HH:mm')} - ${endDtUser.toFormat('HH:mm')}\n**Will be posted at:** ${toDiscordTimestamp(startDt.minus({ minutes: 15 }), 'F')}\n\n**Content:**\n${messageContent}`,
      flags: 64
    });
    
    // Clean up
    pendingRequests.delete(requestId);
    
  } catch (error) {
    console.error('Error handling modal submission:', error);
    await interaction.reply({
      content: '❌ An error occurred while processing your request.',
      flags: 64
    });
    pendingRequests.delete(requestId);
  }
});

client.login(process.env.DISCORD_TOKEN);

