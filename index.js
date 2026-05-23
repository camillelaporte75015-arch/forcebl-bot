require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PREFIX = '&';
const OWNER_ID = '1507202624724926466';

const LOG_FORCEBL_CHANNEL   = '1507635407419080825';
const LOG_UNFORCEBL_CHANNEL = '1507635474544590888';
const LOG_ADD_CHANNEL       = '1507635528709701712';
const LOG_REMOVE_CHANNEL    = '1507635579846922320';

// ─── BASE DE DONNÉES SQLite ───────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const db = new Database(path.join(DATA_DIR, 'bot.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS forcebl (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    reason      TEXT NOT NULL DEFAULT 'Aucune raison',
    by_id       TEXT NOT NULL,
    by_username TEXT NOT NULL,
    date        TEXT NOT NULL,
    time        TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS owners (
    id       TEXT PRIMARY KEY,
    username TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trust (
    id       TEXT PRIMARY KEY,
    username TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS protect (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    by_id       TEXT NOT NULL,
    by_username TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS hey (
    id       TEXT PRIMARY KEY,
    username TEXT NOT NULL
  );
`);

// ─── HELPERS DB ───────────────────────────────────────────────────────────────
const db_isForcebl = (id) => !!db.prepare('SELECT 1 FROM forcebl WHERE id = ?').get(id);
const db_isOwner   = (id) => !!db.prepare('SELECT 1 FROM owners  WHERE id = ?').get(id);
const db_isTrust   = (id) => !!db.prepare('SELECT 1 FROM trust   WHERE id = ?').get(id);
const db_isProtect = (id) => !!db.prepare('SELECT 1 FROM protect WHERE id = ?').get(id);
const db_isHey     = (id) => !!db.prepare('SELECT 1 FROM hey     WHERE id = ?').get(id);

const isOwner     = (id) => id === OWNER_ID;
const isTrust     = (id) => db_isTrust(id);
const isOW        = (id) => db_isOwner(id);
const canUseBot   = (id) => isOwner(id) || isTrust(id) || isOW(id);
const canUseTrust = (id) => isOwner(id) || isTrust(id);

// ─── DATE / HEURE FRANÇAISE ───────────────────────────────────────────────────
const frDate = () => new Date().toLocaleDateString('fr-FR',  { timeZone: 'Europe/Paris' });
const frTime = () => new Date().toLocaleTimeString('fr-FR',  { timeZone: 'Europe/Paris', hour12: false });

// ─── RESOLVE USER ─────────────────────────────────────────────────────────────
async function resolveUser(client, mention) {
  if (!mention) return null;
  const match = mention.match(/\d{17,20}/);
  if (!match) return null;
  try { return await client.users.fetch(match[0]); } catch { return null; }
}

// ─── SEND LOG ─────────────────────────────────────────────────────────────────
async function sendLog(client, channelId, embed) {
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch) await ch.send({ embeds: [embed] });
  } catch {}
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`Bot connecté : ${client.user.tag}`);
});

// ─── MESSAGES ─────────────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const raw     = message.content.slice(PREFIX.length).trim();
  const args    = raw.split(/\s+/);
  const command = args[0]?.toLowerCase();
  const authorId  = message.author.id;
  const authorTag = message.author.tag;

  // Commandes secrètes : silence total si pas owner
  if (['hey', 'unhey', 'heylist'].includes(command)) {
    if (!isOwner(authorId)) return;
  }

  // ════════════════════════════════════════════════════════════
  // &forcebl [list | info @/id | @/id raison]
  // ════════════════════════════════════════════════════════════
  if (command === 'forcebl') {
    const sub = args[1]?.toLowerCase();

    // &forcebl list
    if (sub === 'list') {
      if (!canUseBot(authorId)) return message.reply('Vous n\'avez pas l\'autorisation d\'exécuter cette commande.');
      const rows = db.prepare('SELECT * FROM forcebl').all();
      if (!rows.length) return message.reply({ embeds: [
        new EmbedBuilder().setColor(0x2b2d31).setTitle('Forcebl List').setDescription('La forcebl list est vide.')
      ]});
      const desc = rows.map(e =>
        `**${e.username}** (\`${e.id}\`) a été forcebl par **${e.by_username}**\n` +
        `Raison : ${e.reason}\nDate : ${e.date} — Heure : ${e.time}`
      ).join('\n\n');
      return message.reply({ embeds: [
        new EmbedBuilder().setColor(0xff3333).setTitle('Forcebl List').setDescription(desc)
      ]});
    }

    // &forcebl info @/id
    if (sub === 'info') {
      if (!canUseBot(authorId)) return message.reply('Vous n\'avez pas l\'autorisation d\'exécuter cette commande.');
      const target = await resolveUser(client, args[2]);
      if (!target) return message.reply('Utilisateur introuvable.');
      const entry = db.prepare('SELECT * FROM forcebl WHERE id = ?').get(target.id);
      if (!entry) return message.reply({ embeds: [
        new EmbedBuilder().setColor(0x2b2d31).setDescription(`**${target.tag}** n'est pas dans la forcebl.`)
      ]});
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setColor(0xff3333)
          .setTitle(`Forcebl Info — ${entry.username}`)
          .setDescription(
            `**${entry.username}** est forcebl de ce serveur\n\n` +
            `**Raison :** ${entry.reason}\n\n` +
            `**${entry.username}** a été forcebl par **${entry.by_username}**\n` +
            `**Date :** ${entry.date}\n**Heure :** ${entry.time}`
          )
      ]});
    }

    // &forcebl @/id [raison]
    if (!canUseBot(authorId)) return message.reply('Vous n\'avez pas l\'autorisation d\'exécuter cette commande.');
    const targetUser = await resolveUser(client, args[1]);
    if (!targetUser) return message.reply('Utilisateur introuvable.');

    // Vérifie hey
    if (db_isHey(targetUser.id)) {
      return message.reply({ embeds: [
        new EmbedBuilder().setColor(0xff0000)
          .setDescription(`Impossible de forcebl **${targetUser.username}**, cette personne est ultra protégée par le propriétaire du bot.`)
      ]});
    }

    // Vérifie protect
    if (db_isProtect(targetUser.id)) {
      if (isOW(authorId) && !canUseTrust(authorId)) {
        return message.reply({ embeds: [
          new EmbedBuilder().setColor(0xff9900)
            .setDescription(`**${targetUser.username}** est protect par un trust, vous ne pouvez pas forcebl cette personne.`)
        ]});
      }
      // Trust / owner : retire protect et forcebl quand même
      db.prepare('DELETE FROM protect WHERE id = ?').run(targetUser.id);
      await message.channel.send({ embeds: [
        new EmbedBuilder().setColor(0xff3333)
          .setDescription(`**${targetUser.username}** n'est plus protect et a été forcebl de ce serveur.`)
      ]});
    }

    const reason = args.slice(2).join(' ') || 'Aucune raison';
    const date = frDate();
    const time = frTime();

    try {
      await message.guild.bans.create(targetUser.id, { reason });
    } catch {
      return message.reply('Impossible de bannir cet utilisateur (permissions manquantes ?).');
    }

    db.prepare(`
      INSERT OR REPLACE INTO forcebl (id, username, reason, by_id, by_username, date, time)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(targetUser.id, targetUser.tag, reason, authorId, authorTag, date, time);

    await message.reply({ embeds: [
      new EmbedBuilder()
        .setColor(0xff3333)
        .setTitle('Forcebl')
        .setDescription(
          `**${targetUser.username}** est maintenant dans la forcebl, il a été banni de ce serveur.\n\n` +
          `**Raison :** ${reason}\n**Forcebl par :** ${authorTag}`
        )
        .setFooter({ text: `${date} • ${time}` })
    ]});

    await sendLog(client, LOG_FORCEBL_CHANNEL, new EmbedBuilder()
      .setColor(0xff3333).setTitle(' FORCEBL')
      .setDescription(
        `**Utilisateur :** ${targetUser.tag} (\`${targetUser.id}\`)\n` +
        `**Par :** ${authorTag}\n**Raison :** ${reason}\n**Date :** ${date}\n**Heure :** ${time}`
      )
    );
    return;
  }

  // ════════════════════════════════════════════════════════════
  // &unforcebl @/id
  // ════════════════════════════════════════════════════════════
  if (command === 'unforcebl') {
    if (!canUseBot(authorId)) return message.reply('Vous n\'avez pas l\'autorisation d\'exécuter cette commande.');
    const targetUser = await resolveUser(client, args[1]);
    if (!targetUser) return message.reply('Utilisateur introuvable.');

    const entry = db.prepare('SELECT * FROM forcebl WHERE id = ?').get(targetUser.id);
    if (!entry) return message.reply({ embeds: [
      new EmbedBuilder().setColor(0x2b2d31).setDescription(`**${targetUser.tag}** n'est pas dans la forcebl.`)
    ]});

    try { await message.guild.bans.remove(targetUser.id); } catch {}
    db.prepare('DELETE FROM forcebl WHERE id = ?').run(targetUser.id);

    const date = frDate(); const time = frTime();
    await message.reply({ embeds: [
      new EmbedBuilder().setColor(0x00cc66).setTitle('Unforcebl')
        .setDescription(`**${targetUser.username}** a été retiré de la forcebl et débanni.`)
        .setFooter({ text: `${date} • ${time}` })
    ]});

    await sendLog(client, LOG_UNFORCEBL_CHANNEL, new EmbedBuilder()
      .setColor(0x00cc66).setTitle('UNFORCEBL')
      .setDescription(
        `**Utilisateur :** ${targetUser.tag} (\`${targetUser.id}\`)\n` +
        `**Par :** ${authorTag}\n**Date :** ${date}\n**Heure :** ${time}`
      )
    );
    return;
  }

  // ════════════════════════════════════════════════════════════
  // &owlist
  // ════════════════════════════════════════════════════════════
  if (command === 'owlist') {
    if (!canUseBot(authorId)) return message.reply('Vous n\'avez pas l\'autorisation d\'exécuter cette commande.');
    const trustRows   = db.prepare('SELECT * FROM trust').all();
    const ownersRows  = db.prepare('SELECT * FROM owners').all();
    const protectRows = db.prepare('SELECT * FROM protect').all();

    const fmt  = (arr) => arr.length ? arr.map(u => `<@${u.id}> / \`${u.id}\``).join('\n') : '*Aucun*';
    const fmtP = (arr) => arr.length ? arr.map(u => `<@${u.id}> / \`${u.id}\` (protect par <@${u.by_id}>)`).join('\n') : '*Aucun*';

    return message.reply({ embeds: [
      new EmbedBuilder().setColor(0x5865f2).setTitle(' Ow List')
        .addFields(
          { name: ' Trust',   value: fmt(trustRows) },
          { name: ' OW Bot',  value: fmt(ownersRows) },
          { name: ' Protect', value: fmtP(protectRows) },
        )
    ]});
  }

  // ════════════════════════════════════════════════════════════
  // &ow @/id
  // ════════════════════════════════════════════════════════════
  if (command === 'ow') {
    if (!canUseTrust(authorId)) return message.reply('Vous n\'avez pas l\'autorisation d\'exécuter cette commande.');
    const targetUser = await resolveUser(client, args[1]);
    if (!targetUser) return message.reply('Utilisateur introuvable.');
    if (db_isOwner(targetUser.id)) return message.reply(`**${targetUser.username}** est déjà OW.`);

    db.prepare('INSERT OR REPLACE INTO owners (id, username) VALUES (?, ?)').run(targetUser.id, targetUser.tag);

    const date = frDate(); const time = frTime();
    await message.reply({ embeds: [
      new EmbedBuilder().setColor(0xffd700)
        .setDescription(`**${targetUser.username}** peut maintenant utiliser toutes les commandes de ce bot.`)
    ]});
    await sendLog(client, LOG_ADD_CHANNEL, new EmbedBuilder().setColor(0xffd700).setTitle('➕ Ajout membre')
      .setDescription(`**Ajout d'un membre en OW**\n\n**Membre :** ${targetUser.tag} (\`${targetUser.id}\`)\n**Par :** ${authorTag}\n**Ajout du rôle :** OW\n**Date :** ${date}\n**Heure :** ${time}`)
    );
    return;
  }

  // ════════════════════════════════════════════════════════════
  // &unow @/id
  // ════════════════════════════════════════════════════════════
  if (command === 'unow') {
    if (!canUseTrust(authorId)) return message.reply('Vous n\'avez pas l\'autorisation d\'exécuter cette commande.');
    const targetUser = await resolveUser(client, args[1]);
    if (!targetUser) return message.reply('Utilisateur introuvable.');

    db.prepare('DELETE FROM owners WHERE id = ?').run(targetUser.id);

    const date = frDate(); const time = frTime();
    await message.reply({ embeds: [
      new EmbedBuilder().setColor(0xff6600)
        .setDescription(`**${targetUser.username}** ne peut plus utiliser les commandes de ce bot.`)
    ]});
    await sendLog(client, LOG_REMOVE_CHANNEL, new EmbedBuilder().setColor(0xff6600).setTitle('➖ Retrait membre')
      .setDescription(`**Retrait d'un membre en OW**\n\n**Membre :** ${targetUser.tag} (\`${targetUser.id}\`)\n**Par :** ${authorTag}\n**Retrait du rôle :** OW\n**Date :** ${date}\n**Heure :** ${time}`)
    );
    return;
  }

  // ════════════════════════════════════════════════════════════
  // &trust @/id  (owner only)
  // ════════════════════════════════════════════════════════════
  if (command === 'trust') {
    if (!isOwner(authorId)) return message.reply('Vous n\'avez pas l\'autorisation d\'exécuter cette commande.');
    const targetUser = await resolveUser(client, args[1]);
    if (!targetUser) return message.reply('Utilisateur introuvable.');
    if (db_isTrust(targetUser.id)) return message.reply(`**${targetUser.username}** est déjà trust.`);

    db.prepare('DELETE FROM owners WHERE id = ?').run(targetUser.id);
    db.prepare('INSERT OR REPLACE INTO trust (id, username) VALUES (?, ?)').run(targetUser.id, targetUser.tag);

    const date = frDate(); const time = frTime();
    await message.reply({ embeds: [
      new EmbedBuilder().setColor(0x5865f2).setDescription(`**${targetUser.username}** est maintenant trust.`)
    ]});
    await sendLog(client, LOG_ADD_CHANNEL, new EmbedBuilder().setColor(0x5865f2).setTitle('➕ Ajout membre')
      .setDescription(`**Ajout d'un membre en Trust**\n\n**Membre :** ${targetUser.tag} (\`${targetUser.id}\`)\n**Par :** ${authorTag}\n**Ajout du rôle :** Trust\n**Date :** ${date}\n**Heure :** ${time}`)
    );
    return;
  }

  // ════════════════════════════════════════════════════════════
  // &untrust @/id  (owner only)
  // ════════════════════════════════════════════════════════════
  if (command === 'untrust') {
    if (!isOwner(authorId)) return message.reply('Vous n\'avez pas l\'autorisation d\'exécuter cette commande.');
    const targetUser = await resolveUser(client, args[1]);
    if (!targetUser) return message.reply('Utilisateur introuvable.');

    db.prepare('DELETE FROM trust WHERE id = ?').run(targetUser.id);

    const date = frDate(); const time = frTime();
    await message.reply({ embeds: [
      new EmbedBuilder().setColor(0xff3333).setDescription(`**${targetUser.username}** n'est plus trust.`)
    ]});
    await sendLog(client, LOG_REMOVE_CHANNEL, new EmbedBuilder().setColor(0xff3333).setTitle('➖ Retrait membre')
      .setDescription(`**Retrait d'un membre en Trust**\n\n**Membre :** ${targetUser.tag} (\`${targetUser.id}\`)\n**Par :** ${authorTag}\n**Retrait du rôle :** Trust\n**Date :** ${date}\n**Heure :** ${time}`)
    );
    return;
  }

  // ════════════════════════════════════════════════════════════
  // &protect @/id  (owner + trust)
  // ════════════════════════════════════════════════════════════
  if (command === 'protect') {
    if (!canUseTrust(authorId)) return message.reply('Vous n\'avez pas l\'autorisation d\'exécuter cette commande.');
    const targetUser = await resolveUser(client, args[1]);
    if (!targetUser) return message.reply('Utilisateur introuvable.');
    if (db_isProtect(targetUser.id)) return message.reply(`**${targetUser.username}** est déjà protect.`);

    db.prepare('INSERT OR REPLACE INTO protect (id, username, by_id, by_username) VALUES (?, ?, ?, ?)')
      .run(targetUser.id, targetUser.tag, authorId, authorTag);

    const date = frDate(); const time = frTime();
    await message.reply({ embeds: [
      new EmbedBuilder().setColor(0x00cc66).setDescription(`**${targetUser.username}** est maintenant protect.`)
    ]});
    await sendLog(client, LOG_ADD_CHANNEL, new EmbedBuilder().setColor(0x00cc66).setTitle('➕ Ajout membre')
      .setDescription(`**Ajout d'un membre en Protect**\n\n**Membre :** ${targetUser.tag} (\`${targetUser.id}\`)\n**Par :** ${authorTag}\n**Ajout du rôle :** Protect\n**Date :** ${date}\n**Heure :** ${time}`)
    );
    return;
  }

  // ════════════════════════════════════════════════════════════
  // &unprotect @/id  (owner + trust)
  // ════════════════════════════════════════════════════════════
  if (command === 'unprotect') {
    if (!canUseTrust(authorId)) return message.reply('Vous n\'avez pas l\'autorisation d\'exécuter cette commande.');
    const targetUser = await resolveUser(client, args[1]);
    if (!targetUser) return message.reply('Utilisateur introuvable.');

    db.prepare('DELETE FROM protect WHERE id = ?').run(targetUser.id);

    const date = frDate(); const time = frTime();
    await message.reply({ embeds: [
      new EmbedBuilder().setColor(0xff9900).setDescription(`**${targetUser.username}** est maintenant plus protect.`)
    ]});
    await sendLog(client, LOG_REMOVE_CHANNEL, new EmbedBuilder().setColor(0xff9900).setTitle('➖ Retrait membre')
      .setDescription(`**Retrait d'un membre en Protect**\n\n**Membre :** ${targetUser.tag} (\`${targetUser.id}\`)\n**Par :** ${authorTag}\n**Retrait du rôle :** Protect\n**Date :** ${date}\n**Heure :** ${time}`)
    );
    return;
  }

  // ════════════════════════════════════════════════════════════
  // &hey @/id  (owner only — secret)
  // ════════════════════════════════════════════════════════════
  if (command === 'hey') {
    const targetUser = await resolveUser(client, args[1]);
    if (!targetUser) return message.reply('Utilisateur introuvable.');
    if (db_isHey(targetUser.id)) return message.reply(`**${targetUser.username}** est déjà hey.`);

    db.prepare('INSERT OR REPLACE INTO hey (id, username) VALUES (?, ?)').run(targetUser.id, targetUser.tag);
    await message.reply({ embeds: [
      new EmbedBuilder().setColor(0x9b59b6)
        .setDescription(`on dirait que **${targetUser.username}** est maintenant intouchable`)
    ]});
    return;
  }

  // ════════════════════════════════════════════════════════════
  // &unhey @/id  (owner only — secret)
  // ════════════════════════════════════════════════════════════
  if (command === 'unhey') {
    const targetUser = await resolveUser(client, args[1]);
    if (!targetUser) return message.reply('Utilisateur introuvable.');

    db.prepare('DELETE FROM hey WHERE id = ?').run(targetUser.id);
    await message.reply({ embeds: [
      new EmbedBuilder().setColor(0x9b59b6)
        .setDescription(`**${targetUser.username}** est plus ultra protégé par toi, elle est vulnérable comme les autres.`)
    ]});
    return;
  }

  // ════════════════════════════════════════════════════════════
  // &heylist  (owner only — secret)
  // ════════════════════════════════════════════════════════════
  if (command === 'heylist') {
    const rows = db.prepare('SELECT * FROM hey').all();
    const desc = rows.length
      ? rows.map(u => `<@${u.id}> / \`${u.id}\``).join('\n')
      : '*Aucune personne hey pour l\'instant.*';
    return message.reply({ embeds: [
      new EmbedBuilder().setColor(0x9b59b6)
        .setTitle('Personnes protégées par toi (hey)')
        .setDescription(desc)
    ]});
  }
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) { console.error('❌ DISCORD_TOKEN manquant dans .env'); process.exit(1); }
client.login(TOKEN);
