require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const db = require('./database');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = '&';
const OWNER_ID = '1507830698743038122';

const LOGS = {
  forcebl:   '1507635407419080825',
  unforcebl: '1507635474544590888',
  add_role:  '1507635528709701712',
  rem_role:  '1507635579846922320',
  ban:       '1507846099895980323',
  unban:     '1507846151200575679',
};

// ─── Rate limit cooldowns (in-memory, backed by DB for persistence) ───────────
// Map: userId -> { count, windowStart }
const cooldowns = { ban: new Map(), forcebl: new Map() };

function parseDuration(str) {
  // accepts: 2h, 30m, 1h30m, 90s
  let ms = 0;
  const hours   = str.match(/(\d+)h/);
  const minutes = str.match(/(\d+)m/);
  const seconds = str.match(/(\d+)s/);
  if (hours)   ms += parseInt(hours[1])   * 3600000;
  if (minutes) ms += parseInt(minutes[1]) * 60000;
  if (seconds) ms += parseInt(seconds[1]) * 1000;
  return ms || null;
}

function formatTimeLeft(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  let parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && !h) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}

/**
 * Check if user is within rate limit for a given type ('ban' or 'forcebl').
 * Returns { allowed: true } or { allowed: false, timeLeft: ms }
 */
function checkRateLimit(userId, type) {
  if (userId === OWNER_ID) return { allowed: true }; // owner is never limited
  const limit = db.getLimit(type);
  if (!limit) return { allowed: true }; // no limit set

  const now = Date.now();
  const map = cooldowns[type];
  const entry = map.get(userId) || { count: 0, windowStart: now };

  // If window expired, reset
  if (now - entry.windowStart >= limit.durationMs) {
    map.set(userId, { count: 0, windowStart: now });
    return { allowed: true };
  }

  if (entry.count >= limit.maxCount) {
    const timeLeft = (entry.windowStart + limit.durationMs) - now;
    return { allowed: false, timeLeft };
  }

  return { allowed: true };
}

function incrementUsage(userId, type) {
  if (userId === OWNER_ID) return;
  const now = Date.now();
  const map = cooldowns[type];
  const limit = db.getLimit(type);
  if (!limit) return;
  const entry = map.get(userId) || { count: 0, windowStart: now };

  // Reset window if expired
  if (now - entry.windowStart >= limit.durationMs) {
    map.set(userId, { count: 1, windowStart: now });
  } else {
    map.set(userId, { count: entry.count + 1, windowStart: entry.windowStart });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNow() {
  const now = new Date();
  const date = now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
  const time = now.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' });
  return { date, time };
}

async function resolveUser(guild, input) {
  if (!input) return null;
  const id = input.replace(/[<@!>]/g, '');
  try { return await client.users.fetch(id); } catch { return null; }
}

async function sendLog(guild, channelId, embed) {
  try {
    const ch = await guild.channels.fetch(channelId);
    if (ch) await ch.send({ embeds: [embed] });
  } catch (e) { console.error('Log send error:', e.message); }
}

function hasPermission(userId, level) {
  if (userId === OWNER_ID) return true;
  const roles = db.getUserRoles(userId);
  if (level === 'trust') return roles.includes('trust');
  if (level === 'ow')    return roles.includes('trust') || roles.includes('ow');
  if (level === 'wl')    return roles.includes('trust') || roles.includes('ow') || roles.includes('wl');
  return false;
}

function noPermEmbed() {
  return new EmbedBuilder().setColor(0xe74c3c).setDescription("Vous n'avez pas l'autorisation d'exécuter cette commande.");
}

function rateLimitEmbed(type, timeLeft) {
  const label = type === 'ban' ? 'ban' : 'forcebl';
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setDescription(`Vous avez atteint votre limite de **${label}**, merci de réessayer dans **${formatTimeLeft(timeLeft)}**.`);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

const commands = {

  // &forcebl
  async forcebl(message, args) {
    if (!hasPermission(message.author.id, 'ow'))
      return message.channel.send({ embeds: [noPermEmbed()] });

    if (args[0] === 'list') {
      const list = db.getForceblList();
      const embed = new EmbedBuilder().setColor(0xe74c3c).setTitle('📋 ForceBlacklist — Liste');
      if (!list.length) {
        embed.setDescription('Aucune personne dans la forcebl.');
      } else {
        let desc = '';
        for (const e of list) {
          desc += `<@${e.userId}> a été forcebl par <@${e.byId}>\n`;
          desc += `Raison : ${e.reason || 'aucune raison'}\n`;
          desc += `Date : ${e.date} — Heure : ${e.time}\n\n`;
        }
        embed.setDescription(desc);
      }
      return message.channel.send({ embeds: [embed] });
    }

    if (args[0] === 'info') {
      const target = await resolveUser(message.guild, args[1]);
      if (!target) return message.channel.send('Utilisateur introuvable.');
      const entry = db.getForceblEntry(target.id);
      if (!entry) return message.channel.send({ embeds: [new EmbedBuilder().setColor(0x95a5a6).setDescription(`<@${target.id}> n'est pas dans la forcebl.`)] });
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle(`🚫 ${target.username} est forcebl de ce serveur`)
        .setDescription(`**Raison :** ${entry.reason || 'aucune raison'}\n\n**${target.username}** a été forcebl par <@${entry.byId}>\n📅 ${entry.date} — 🕐 ${entry.time}`);
      return message.channel.send({ embeds: [embed] });
    }

    // Rate limit check
    const rl = checkRateLimit(message.author.id, 'forcebl');
    if (!rl.allowed) return message.channel.send({ embeds: [rateLimitEmbed('forcebl', rl.timeLeft)] });

    const target = await resolveUser(message.guild, args[0]);
    if (!target) return message.channel.send('Utilisateur introuvable.');
    if (target.id === OWNER_ID) return message.channel.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription('Impossible de forcebl le propriétaire du bot.')] });

    if (db.isHey(target.id))
      return message.channel.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription(`Impossible de forcebl **${target.username}**, cette personne est ultra protégée par le propriétaire du bot.`)] });

    const isProtected = db.isProtect(target.id);
    const isTrustOrOwner = message.author.id === OWNER_ID || db.getUserRoles(message.author.id).includes('trust');

    if (isProtected && !isTrustOrOwner)
      return message.channel.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription(`**${target.username}** est protect par un trust, vous ne pouvez pas forcebl cette personne.`)] });

    const reason = args.slice(1).join(' ') || null;
    const { date, time } = getNow();

    let extraMsg = '';
    if (isProtected && isTrustOrOwner) {
      db.removeProtect(target.id);
      extraMsg = `**${target.username}** n'est plus protect et a été forcebl de ce serveur.`;
    }

    db.addForcebl(target.id, target.username, message.author.id, reason, date, time);
    incrementUsage(message.author.id, 'forcebl');
    try { await message.guild.members.ban(target.id, { reason: reason || 'ForceBlacklist' }); } catch {}

    const embed = new EmbedBuilder().setColor(0xe74c3c).setTitle('🚫 ForceBlacklist')
      .setDescription(`**${target.username}** est maintenant dans la forcebl, il a été banni de ce serveur.\n\n**Raison :** ${reason || 'aucune raison'}\n**Forcebl par :** <@${message.author.id}>`);
    await message.channel.send({ embeds: [embed] });
    if (extraMsg) await message.channel.send(extraMsg);

    const logEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle('FORCEBL')
      .setDescription(`**Utilisateur :** ${target.username} (${target.id})\n**Par :** ${message.author.username}\n**Raison :** ${reason || 'aucune'}\n**Date :** ${date}\n**Heure :** ${time}`);
    await sendLog(message.guild, LOGS.forcebl, logEmbed);
  },

  // &unforcebl
  async unforcebl(message, args) {
    if (!hasPermission(message.author.id, 'ow'))
      return message.channel.send({ embeds: [noPermEmbed()] });
    const target = await resolveUser(message.guild, args[0]);
    if (!target) return message.channel.send('Utilisateur introuvable.');
    const entry = db.getForceblEntry(target.id);
    if (!entry) return message.channel.send({ embeds: [new EmbedBuilder().setColor(0x95a5a6).setDescription(`**${target.username}** n'est pas dans la forcebl.`)] });
    db.removeForcebl(target.id);
    try { await message.guild.members.unban(target.id); } catch {}
    const { date, time } = getNow();
    const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ UnForceBlacklist')
      .setDescription(`**${target.username}** a été retiré de la forcebl et débanni.`);
    await message.channel.send({ embeds: [embed] });
    const logEmbed = new EmbedBuilder().setColor(0x2ecc71).setTitle('UNFORCEBL')
      .setDescription(`**Utilisateur :** ${target.username} (${target.id})\n**Par :** ${message.author.username}\n**Date :** ${date}\n**Heure :** ${time}`);
    await sendLog(message.guild, LOGS.unforcebl, logEmbed);
  },

  // &ban
  async ban(message, args) {
    if (!hasPermission(message.author.id, 'wl'))
      return message.channel.send({ embeds: [noPermEmbed()] });

    if (args[0] === 'info') {
      const target = await resolveUser(message.guild, args[1]);
      if (!target) return message.channel.send('Utilisateur introuvable.');
      const entry = db.getBanEntry(target.id);
      if (!entry) return message.channel.send({ embeds: [new EmbedBuilder().setColor(0x95a5a6).setDescription(`<@${target.id}> n'est pas dans la banlist.`)] });
      const embed = new EmbedBuilder().setColor(0xe67e22).setTitle(`🔨 ${target.username} est banni de ce serveur`)
        .setDescription(`**Raison :** ${entry.reason || 'aucune raison'}\n\n**${target.username}** a été banni par <@${entry.byId}>\n📅 ${entry.date} — 🕐 ${entry.time}`);
      return message.channel.send({ embeds: [embed] });
    }

    // Rate limit check
    const rl = checkRateLimit(message.author.id, 'ban');
    if (!rl.allowed) return message.channel.send({ embeds: [rateLimitEmbed('ban', rl.timeLeft)] });

    const target = await resolveUser(message.guild, args[0]);
    if (!target) return message.channel.send('Utilisateur introuvable.');
    if (target.id === OWNER_ID) return message.channel.send('Impossible de bannir le propriétaire du bot.');

    if (db.isHey(target.id))
      return message.channel.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription(`Impossible de forcebl **${target.username}**, cette personne est ultra protégée par le propriétaire du bot.`)] });

    const isTrustOrOwner = message.author.id === OWNER_ID || db.getUserRoles(message.author.id).includes('trust');
    if (db.isProtect(target.id) && !isTrustOrOwner)
      return message.channel.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription(`**${target.username}** est protect par un trust, vous ne pouvez pas bannir cette personne.`)] });

    const reason = args.slice(1).join(' ') || null;
    const { date, time } = getNow();

    db.addBan(target.id, target.username, message.author.id, reason, date, time);
    incrementUsage(message.author.id, 'ban');
    try { await message.guild.members.ban(target.id, { reason: reason || 'Ban' }); } catch {}

    const embed = new EmbedBuilder().setColor(0xe67e22).setTitle('🔨 Ban')
      .setDescription(`**${target.username}** est maintenant dans la banlist, il a été banni de ce serveur.\n\n**Raison :** ${reason || 'aucune raison'}\n**Banni par :** <@${message.author.id}>`);
    await message.channel.send({ embeds: [embed] });

    const logEmbed = new EmbedBuilder().setColor(0xe67e22).setTitle('BAN')
      .setDescription(`**Utilisateur :** ${target.username} (${target.id})\n**Par :** ${message.author.username}\n**Raison :** ${reason || 'aucune'}\n**Date :** ${date}\n**Heure :** ${time}`);
    await sendLog(message.guild, LOGS.ban, logEmbed);
  },

  // &unban
  async unban(message, args) {
    if (!hasPermission(message.author.id, 'wl'))
      return message.channel.send({ embeds: [noPermEmbed()] });
    const target = await resolveUser(message.guild, args[0]);
    if (!target) return message.channel.send('Utilisateur introuvable.');
    const entry = db.getBanEntry(target.id);
    if (!entry) return message.channel.send({ embeds: [new EmbedBuilder().setColor(0x95a5a6).setDescription(`**${target.username}** n'est pas dans la banlist.`)] });
    db.removeBan(target.id);
    try { await message.guild.members.unban(target.id); } catch {}
    const { date, time } = getNow();
    const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Unban')
      .setDescription(`**${target.username}** a été retiré de la banlist et débanni.`);
    await message.channel.send({ embeds: [embed] });
    const logEmbed = new EmbedBuilder().setColor(0x2ecc71).setTitle('DÉBANNI')
      .setDescription(`**Utilisateur :** ${target.username} (${target.id})\n**Par :** ${message.author.username}\n**Date :** ${date}\n**Heure :** ${time}`);
    await sendLog(message.guild, LOGS.unban, logEmbed);
  },

  // &banlist
  async banlist(message) {
    if (!hasPermission(message.author.id, 'wl'))
      return message.channel.send({ embeds: [noPermEmbed()] });
    const list = db.getBanList();
    const embed = new EmbedBuilder().setColor(0xe67e22).setTitle('📋 BanList');
    if (!list.length) {
      embed.setDescription('Aucune personne dans la banlist.');
    } else {
      let desc = '';
      for (const e of list) {
        desc += `<@${e.userId}> a été banni par <@${e.byId}>\n`;
        desc += `Raison : ${e.reason || 'aucune raison'}\n`;
        desc += `Date : ${e.date} — Heure : ${e.time}\n\n`;
      }
      embed.setDescription(desc);
    }
    return message.channel.send({ embeds: [embed] });
  },

  // &owlist
  async owlist(message) {
    if (!hasPermission(message.author.id, 'wl'))
      return message.channel.send({ embeds: [noPermEmbed()] });
    const data = db.getOwList();
    let desc = '';
    if (data.trust.length)   { desc += '**— Trust —**\n';   for (const u of data.trust)   desc += `<@${u.id}> / ${u.id}\n`; desc += '\n'; }
    if (data.ow.length)      { desc += '**— OWBot —**\n';   for (const u of data.ow)      desc += `<@${u.id}> / ${u.id}\n`; desc += '\n'; }
    if (data.wl.length)      { desc += '**— WLBot —**\n';   for (const u of data.wl)      desc += `<@${u.id}> / ${u.id}\n`; desc += '\n'; }
    if (data.protect.length) { desc += '**— Protect —**\n'; for (const u of data.protect) desc += `<@${u.id}> / ${u.id} (protect par <@${u.byId}>)\n`; }
    if (!desc) desc = 'Aucun membre enregistré.';
    const embed = new EmbedBuilder().setColor(0x3498db).setTitle('📜 Owner List').setDescription(desc);
    return message.channel.send({ embeds: [embed] });
  },

  // &ow
  async ow(message, args) {
    if (!hasPermission(message.author.id, 'ow'))
      return message.channel.send({ embeds: [noPermEmbed()] });
    const target = await resolveUser(message.guild, args[0]);
    if (!target) return message.channel.send('Utilisateur introuvable.');
    db.setRole(target.id, target.username, 'ow');
    const { date, time } = getNow();
    const embed = new EmbedBuilder().setColor(0x3498db).setDescription(`**${target.username}** peut maintenant utiliser toutes les commandes de ce bot.`);
    await message.channel.send({ embeds: [embed] });
    const logEmbed = new EmbedBuilder().setColor(0x3498db).setTitle("Ajout d'un membre")
      .setDescription(`**Membre :** ${target.username} (${target.id})\n**Par :** ${message.author.username}\n**Ajout du rôle :** ow\n**Date :** ${date}\n**Heure :** ${time}`);
    await sendLog(message.guild, LOGS.add_role, logEmbed);
  },

  // &unow
  async unow(message, args) {
    if (!hasPermission(message.author.id, 'ow'))
      return message.channel.send({ embeds: [noPermEmbed()] });
    const target = await resolveUser(message.guild, args[0]);
    if (!target) return message.channel.send('Utilisateur introuvable.');
    db.removeRole(target.id, 'ow');
    const { date, time } = getNow();
    const embed = new EmbedBuilder().setColor(0x95a5a6).setDescription(`**${target.username}** ne peut plus utiliser les commandes de ce bot.`);
    await message.channel.send({ embeds: [embed] });
    const logEmbed = new EmbedBuilder().setColor(0x95a5a6).setTitle("Retrait d'un membre")
      .setDescription(`**Membre :** ${target.username} (${target.id})\n**Par :** ${message.author.username}\n**Retrait du rôle :** ow\n**Date :** ${date}\n**Heure :** ${time}`);
    await sendLog(message.guild, LOGS.rem_role, logEmbed);
  },

  // &trust
  async trust(message, args) {
    if (message.author.id !== OWNER_ID) return;
    const target = await resolveUser(message.guild, args[0]);
    if (!target) return message.channel.send('Utilisateur introuvable.');
    db.removeRole(target.id, 'ow');
    db.setRole(target.id, target.username, 'trust');
    const { date, time } = getNow();
    const embed = new EmbedBuilder().setColor(0x9b59b6).setDescription(`**${target.username}** est maintenant trust.`);
    await message.channel.send({ embeds: [embed] });
    const logEmbed = new EmbedBuilder().setColor(0x9b59b6).setTitle("Ajout d'un membre")
      .setDescription(`**Membre :** ${target.username} (${target.id})\n**Par :** ${message.author.username}\n**Ajout du rôle :** trust\n**Date :** ${date}\n**Heure :** ${time}`);
    await sendLog(message.guild, LOGS.add_role, logEmbed);
  },

  // &untrust
  async untrust(message, args) {
    if (message.author.id !== OWNER_ID) return;
    const target = await resolveUser(message.guild, args[0]);
    if (!target) return message.channel.send('Utilisateur introuvable.');
    db.removeRole(target.id, 'trust');
    const { date, time } = getNow();
    const embed = new EmbedBuilder().setColor(0x95a5a6).setDescription(`**${target.username}** n'est plus trust.`);
    await message.channel.send({ embeds: [embed] });
    const logEmbed = new EmbedBuilder().setColor(0x95a5a6).setTitle("Retrait d'un membre")
      .setDescription(`**Membre :** ${target.username} (${target.id})\n**Par :** ${message.author.username}\n**Retrait du rôle :** trust\n**Date :** ${date}\n**Heure :** ${time}`);
    await sendLog(message.guild, LOGS.rem_role, logEmbed);
  },

  // &wl
  async wl(message, args) {
    if (!hasPermission(message.author.id, 'trust'))
      return message.channel.send({ embeds: [noPermEmbed()] });
    const target = await resolveUser(message.guild, args[0]);
    if (!target) return message.channel.send('Utilisateur introuvable.');
    db.setRole(target.id, target.username, 'wl');
    const { date, time } = getNow();
    const embed = new EmbedBuilder().setColor(0x1abc9c).setDescription(`**${target.username}** est maintenant wl.`);
    await message.channel.send({ embeds: [embed] });
    const logEmbed = new EmbedBuilder().setColor(0x1abc9c).setTitle("Ajout d'un membre")
      .setDescription(`**Membre :** ${target.username} (${target.id})\n**Par :** ${message.author.username}\n**Ajout du rôle :** wl\n**Date :** ${date}\n**Heure :** ${time}`);
    await sendLog(message.guild, LOGS.add_role, logEmbed);
  },

  // &unwl
  async unwl(message, args) {
    if (!hasPermission(message.author.id, 'trust'))
      return message.channel.send({ embeds: [noPermEmbed()] });
    const target = await resolveUser(message.guild, args[0]);
    if (!target) return message.channel.send('Utilisateur introuvable.');
    db.removeRole(target.id, 'wl');
    const { date, time } = getNow();
    const embed = new EmbedBuilder().setColor(0x95a5a6).setDescription(`**${target.username}** a été supprimé de la wl.`);
    await message.channel.send({ embeds: [embed] });
    const logEmbed = new EmbedBuilder().setColor(0x95a5a6).setTitle("Retrait d'un membre")
      .setDescription(`**Membre :** ${target.username} (${target.id})\n**Par :** ${message.author.username}\n**Retrait du rôle :** wl\n**Date :** ${date}\n**Heure :** ${time}`);
    await sendLog(message.guild, LOGS.rem_role, logEmbed);
  },

  // &protect
  async protect(message, args) {
    if (!hasPermission(message.author.id, 'trust'))
      return message.channel.send({ embeds: [noPermEmbed()] });
    const target = await resolveUser(message.guild, args[0]);
    if (!target) return message.channel.send('Utilisateur introuvable.');
    db.addProtect(target.id, target.username, message.author.id);
    const { date, time } = getNow();
    const embed = new EmbedBuilder().setColor(0xf39c12).setDescription(`**${target.username}** est maintenant protect.`);
    await message.channel.send({ embeds: [embed] });
    const logEmbed = new EmbedBuilder().setColor(0xf39c12).setTitle("Ajout d'un membre")
      .setDescription(`**Membre :** ${target.username} (${target.id})\n**Par :** ${message.author.username}\n**Ajout du rôle :** protect\n**Date :** ${date}\n**Heure :** ${time}`);
    await sendLog(message.guild, LOGS.add_role, logEmbed);
  },

  // &unprotect
  async unprotect(message, args) {
    if (!hasPermission(message.author.id, 'trust'))
      return message.channel.send({ embeds: [noPermEmbed()] });
    const target = await resolveUser(message.guild, args[0]);
    if (!target) return message.channel.send('Utilisateur introuvable.');
    db.removeProtect(target.id);
    const { date, time } = getNow();
    const embed = new EmbedBuilder().setColor(0x95a5a6).setDescription(`**${target.username}** n'est maintenant plus protect.`);
    await message.channel.send({ embeds: [embed] });
    const logEmbed = new EmbedBuilder().setColor(0x95a5a6).setTitle("Retrait d'un membre")
      .setDescription(`**Membre :** ${target.username} (${target.id})\n**Par :** ${message.author.username}\n**Retrait du rôle :** protect\n**Date :** ${date}\n**Heure :** ${time}`);
    await sendLog(message.guild, LOGS.rem_role, logEmbed);
  },

  // &hey (silent for non-owner)
  async hey(message, args) {
    if (message.author.id !== OWNER_ID) return;
    const target = await resolveUser(message.guild, args[0]);
    if (!target) return;
    db.addHey(target.id, target.username);
    const embed = new EmbedBuilder().setColor(0xf1c40f).setDescription(`On dirait que **${target.username}** est maintenant intouchable.`);
    await message.channel.send({ embeds: [embed] });
  },

  // &unhey (silent for non-owner)
  async unhey(message, args) {
    if (message.author.id !== OWNER_ID) return;
    const target = await resolveUser(message.guild, args[0]);
    if (!target) return;
    db.removeHey(target.id);
    const embed = new EmbedBuilder().setColor(0x95a5a6).setDescription(`**${target.username}** n'est plus ultra protégé par toi, elle est vulnérable comme les autres.`);
    await message.channel.send({ embeds: [embed] });
  },

  // &heylist (silent for non-owner)
  async heylist(message) {
    if (message.author.id !== OWNER_ID) return;
    const list = db.getHeyList();
    let desc = '**Personnes protégées par toi (hey) :**\n\n';
    if (!list.length) desc += 'Aucune personne protégée.';
    else for (const u of list) desc += `<@${u.id}> / ${u.id}\n`;
    const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('⭐ Hey List').setDescription(desc);
    await message.channel.send({ embeds: [embed] });
  },

  // ── &limitban (owner only) ────────────────────────────────────────────────
  async limitban(message, args) {
    if (message.author.id !== OWNER_ID) return;
    if (!args[0] || !args[0].includes('/')) {
      return message.channel.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription('Format invalide. Utilise : `&limitban 2/2h`')] });
    }
    const [countStr, durationStr] = args[0].split('/');
    const count = parseInt(countStr);
    const durationMs = parseDuration(durationStr);
    if (isNaN(count) || count < 1 || !durationMs) {
      return message.channel.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription('Format invalide. Exemple : `&limitban 2/2h`')] });
    }
    db.setLimit('ban', count, durationMs);
    // Reset in-memory cooldowns when limit changes
    cooldowns.ban.clear();
    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('⏱️ Limite de ban configurée')
      .setDescription(`Les bans sont limités à **${count}** toutes les **${durationStr}**.\n\nTous les membres (ow, wl, trust) sont concernés par cette limite.`);
    await message.channel.send({ embeds: [embed] });
  },

  // ── &limitforcebl (owner only) ────────────────────────────────────────────
  async limitforcebl(message, args) {
    if (message.author.id !== OWNER_ID) return;
    if (!args[0] || !args[0].includes('/')) {
      return message.channel.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription('Format invalide. Utilise : `&limitforcebl 2/2h`')] });
    }
    const [countStr, durationStr] = args[0].split('/');
    const count = parseInt(countStr);
    const durationMs = parseDuration(durationStr);
    if (isNaN(count) || count < 1 || !durationMs) {
      return message.channel.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription('Format invalide. Exemple : `&limitforcebl 2/2h`')] });
    }
    db.setLimit('forcebl', count, durationMs);
    cooldowns.forcebl.clear();
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('⏱️ Limite de forcebl configurée')
      .setDescription(`Les forcebl sont limités à **${count}** toutes les **${durationStr}**.\n\nTous les membres (ow, wl, trust) sont concernés par cette limite.`);
    await message.channel.send({ embeds: [embed] });
  },

  // ── &play (owner only) ────────────────────────────────────────────────────
  async play(message, args) {
    if (message.author.id !== OWNER_ID) return;
    if (!args.length) return;
    const game = args.join(' ');
    try {
      await client.user.setActivity(game, { type: ActivityType.Playing });
      const embed = new EmbedBuilder()
        .setColor(0x7289da)
        .setDescription(`🎮 Je joue maintenant à **${game}**`);
      await message.channel.send({ embeds: [embed] });
    } catch (e) {
      console.error('Play error:', e);
    }
  },
};

// ─── Message handler ──────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const content = message.content.slice(PREFIX.length).trim();
  const parts = content.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  try {
    switch (cmd) {
      case 'forcebl':      await commands.forcebl(message, args); break;
      case 'unforcebl':    await commands.unforcebl(message, args); break;
      case 'ban':          await commands.ban(message, args); break;
      case 'unban':        await commands.unban(message, args); break;
      case 'banlist':      await commands.banlist(message); break;
      case 'owlist':       await commands.owlist(message); break;
      case 'ow':           await commands.ow(message, args); break;
      case 'unow':         await commands.unow(message, args); break;
      case 'trust':        await commands.trust(message, args); break;
      case 'untrust':      await commands.untrust(message, args); break;
      case 'wl':           await commands.wl(message, args); break;
      case 'unwl':         await commands.unwl(message, args); break;
      case 'protect':      await commands.protect(message, args); break;
      case 'unprotect':    await commands.unprotect(message, args); break;
      case 'hey':          await commands.hey(message, args); break;
      case 'unhey':        await commands.unhey(message, args); break;
      case 'heylist':      await commands.heylist(message); break;
      case 'limitban':     await commands.limitban(message, args); break;
      case 'limitforcebl': await commands.limitforcebl(message, args); break;
      case 'play':         await commands.play(message, args); break;
    }
  } catch (e) {
    console.error(`Error on command ${cmd}:`, e);
  }
});

client.once('ready', () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
