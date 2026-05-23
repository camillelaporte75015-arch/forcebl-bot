const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.db'));

// ─── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS forcebl (
    userId    TEXT PRIMARY KEY,
    username  TEXT,
    byId      TEXT,
    reason    TEXT,
    date      TEXT,
    time      TEXT
  );

  CREATE TABLE IF NOT EXISTS banlist (
    userId    TEXT PRIMARY KEY,
    username  TEXT,
    byId      TEXT,
    reason    TEXT,
    date      TEXT,
    time      TEXT
  );

  CREATE TABLE IF NOT EXISTS roles (
    userId    TEXT PRIMARY KEY,
    username  TEXT,
    role      TEXT   -- 'ow' | 'trust' | 'wl'
  );

  CREATE TABLE IF NOT EXISTS protect (
    userId    TEXT PRIMARY KEY,
    username  TEXT,
    byId      TEXT,
    eligible  INTEGER DEFAULT 1  -- 1 = eligible for protect, 0 = lost protect once via trust forcebl
  );

  CREATE TABLE IF NOT EXISTS hey (
    userId    TEXT PRIMARY KEY,
    username  TEXT
  );
`);

// ─── ForceBlacklist ──────────────────────────────────────────────────────────

function addForcebl(userId, username, byId, reason, date, time) {
  db.prepare(`
    INSERT OR REPLACE INTO forcebl (userId, username, byId, reason, date, time)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, username, byId, reason || null, date, time);
}

function removeForcebl(userId) {
  db.prepare('DELETE FROM forcebl WHERE userId = ?').run(userId);
}

function getForceblEntry(userId) {
  return db.prepare('SELECT * FROM forcebl WHERE userId = ?').get(userId);
}

function getForceblList() {
  return db.prepare('SELECT * FROM forcebl ORDER BY rowid ASC').all();
}

// ─── BanList ─────────────────────────────────────────────────────────────────

function addBan(userId, username, byId, reason, date, time) {
  db.prepare(`
    INSERT OR REPLACE INTO banlist (userId, username, byId, reason, date, time)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, username, byId, reason || null, date, time);
}

function removeBan(userId) {
  db.prepare('DELETE FROM banlist WHERE userId = ?').run(userId);
}

function getBanEntry(userId) {
  return db.prepare('SELECT * FROM banlist WHERE userId = ?').get(userId);
}

function getBanList() {
  return db.prepare('SELECT * FROM banlist ORDER BY rowid ASC').all();
}

// ─── Roles (ow / trust / wl) ─────────────────────────────────────────────────

function setRole(userId, username, role) {
  db.prepare(`
    INSERT OR REPLACE INTO roles (userId, username, role) VALUES (?, ?, ?)
  `).run(userId, username, role);
}

function removeRole(userId, role) {
  const current = db.prepare('SELECT role FROM roles WHERE userId = ?').get(userId);
  if (current && current.role === role) {
    db.prepare('DELETE FROM roles WHERE userId = ?').run(userId);
  }
}

function getUserRoles(userId) {
  const row = db.prepare('SELECT role FROM roles WHERE userId = ?').get(userId);
  return row ? [row.role] : [];
}

function getOwList() {
  const all = db.prepare('SELECT * FROM roles').all();
  const trust   = all.filter(r => r.role === 'trust').map(r => ({ id: r.userId, username: r.username }));
  const ow      = all.filter(r => r.role === 'ow').map(r => ({ id: r.userId, username: r.username }));
  const wl      = all.filter(r => r.role === 'wl').map(r => ({ id: r.userId, username: r.username }));
  const protectRows = db.prepare('SELECT * FROM protect WHERE eligible = 1').all();
  const protect = protectRows.map(r => ({ id: r.userId, username: r.username, byId: r.byId }));
  return { trust, ow, wl, protect };
}

// ─── Protect ──────────────────────────────────────────────────────────────────

function addProtect(userId, username, byId) {
  db.prepare(`
    INSERT OR REPLACE INTO protect (userId, username, byId, eligible) VALUES (?, ?, ?, 1)
  `).run(userId, username, byId);
}

function removeProtect(userId) {
  // Mark as no longer eligible (lost protect via trust forcebl)
  db.prepare('DELETE FROM protect WHERE userId = ?').run(userId);
}

function isProtect(userId) {
  const row = db.prepare('SELECT eligible FROM protect WHERE userId = ?').get(userId);
  return row && row.eligible === 1;
}

// ─── Hey ─────────────────────────────────────────────────────────────────────

function addHey(userId, username) {
  db.prepare('INSERT OR REPLACE INTO hey (userId, username) VALUES (?, ?)').run(userId, username);
}

function removeHey(userId) {
  db.prepare('DELETE FROM hey WHERE userId = ?').run(userId);
}

function isHey(userId) {
  return !!db.prepare('SELECT userId FROM hey WHERE userId = ?').get(userId);
}

function getHeyList() {
  return db.prepare('SELECT * FROM hey').all().map(r => ({ id: r.userId, username: r.username }));
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  addForcebl, removeForcebl, getForceblEntry, getForceblList,
  addBan, removeBan, getBanEntry, getBanList,
  setRole, removeRole, getUserRoles, getOwList,
  addProtect, removeProtect, isProtect,
  addHey, removeHey, isHey, getHeyList,
};

// ─── Rate Limits ──────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS limits (
    type       TEXT PRIMARY KEY,  -- 'ban' or 'forcebl'
    maxCount   INTEGER,
    durationMs INTEGER
  );
`);

function setLimit(type, maxCount, durationMs) {
  db.prepare('INSERT OR REPLACE INTO limits (type, maxCount, durationMs) VALUES (?, ?, ?)').run(type, maxCount, durationMs);
}

function getLimit(type) {
  return db.prepare('SELECT * FROM limits WHERE type = ?').get(type);
}

module.exports = Object.assign(module.exports, { setLimit, getLimit });
