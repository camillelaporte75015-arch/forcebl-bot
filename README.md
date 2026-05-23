# 🤖 ForceBlacklist Bot — Discord

Bot Discord avec système complet de ForceBlacklist, Ban, protection et gestion des rôles.

-----

## 📋 Fonctionnalités

|Commande                 |Qui peut l’utiliser    |Description                     |
|-------------------------|-----------------------|--------------------------------|
|`&forcebl @user [raison]`|ow / trust             |Forcebl + ban un membre         |
|`&unforcebl @user`       |ow / trust             |Retire de la forcebl + déban    |
|`&forcebl list`          |ow / trust             |Liste de toutes les forcebl     |
|`&forcebl info @user`    |ow / trust             |Infos détaillées sur une forcebl|
|`&ban @user [raison]`    |wl / ow / trust        |Ban un membre                   |
|`&unban @user`           |wl / ow / trust        |Déban un membre                 |
|`&banlist`               |wl / ow / trust        |Liste des bans                  |
|`&ban info @user`        |wl / ow / trust        |Infos détaillées sur un ban     |
|`&owlist`                |wl / ow / trust        |Affiche la hiérarchie complète  |
|`&ow @user`              |ow / trust             |Donne le rang ow                |
|`&unow @user`            |ow / trust             |Retire le rang ow               |
|`&trust @user`           |**owner only**         |Donne le rang trust             |
|`&untrust @user`         |**owner only**         |Retire le rang trust            |
|`&wl @user`              |trust                  |Donne le rang wl                |
|`&unwl @user`            |trust                  |Retire le rang wl               |
|`&protect @user`         |trust / owner          |Protège un membre contre les ow |
|`&unprotect @user`       |trust / owner          |Retire la protection            |
|`&hey @user`             |**owner only** (secret)|Protection absolue              |
|`&unhey @user`           |**owner only** (secret)|Retire la protection absolue    |
|`&heylist`               |**owner only** (secret)|Liste des membres hey           |

-----

## 🏗️ Hiérarchie des rôles

```
OWNER (toi, ID fixe)
  └── TRUST (sous-propriétaires)
        └── OW (modérateurs bot)
              └── WL (accès ban uniquement)
                    └── PROTECT (protégés contre les ow)
                          └── HEY (protégés absolus, invisible)
```

### Ce que chaque rang peut faire :

**Trust** — Toutes les commandes sauf `&hey`, `&unhey`, `&heylist`, `&trust`, `&untrust`

**OW** — `&forcebl`, `&unforcebl`, `&forcebl list`, `&forcebl info`, `&ban`, `&unban`, `&banlist`, `&ban info`, `&owlist`, `&ow`, `&unow`

**WL** — Seulement `&ban`, `&unban`, `&banlist`, `&ban info`, `&owlist`

**Protect** — Aucune commande, juste protégé des `&forcebl` par les ow

**Hey** — Aucune commande (si wl+hey = accès wl seulement), protégé de tout le monde sauf owner

-----

## 🔒 Règles de protection

|Situation                                        |Résultat                                               |
|-------------------------------------------------|-------------------------------------------------------|
|Un **ow** essaie de forcebl/ban un **protect**   |Bloqué + message d’erreur                              |
|Un **trust** forcebl un **protect**              |Succès, la protect est retirée définitivement          |
|Un **ow/trust** essaie de forcebl/ban un **hey** |Bloqué + message d’erreur                              |
|Seul l’**owner** peut forcebl/ban un **hey**     |✅                                                      |
|Un membre `wl + protect` → un ow essaie de le ban|Bloqué (protect prioritaire)                           |
|Un membre `wl + hey`                             |Accès aux commandes wl, personne ne peut le ban/forcebl|

-----

## 📡 Salons de logs

|Événement                          |Salon ID             |
|-----------------------------------|---------------------|
|ForceBlacklist                     |`1507635407419080825`|
|UnForceBlacklist                   |`1507635474544590888`|
|Ban                                |`1507846099895980323`|
|Débanni                            |`1507846151200575679`|
|Ajout de rôle (ow/trust/wl/protect)|`1507635528709701712`|
|Retrait de rôle                    |`1507635579846922320`|

-----

## 🚀 Installation

### Prérequis

- Node.js 18+ installé sur le VPS
- Un bot Discord créé sur [discord.com/developers](https://discord.com/developers)

### Étapes

**1. Cloner le repo**

```bash
git clone https://github.com/TON_USER/discord-forcebl-bot.git
cd discord-forcebl-bot
```

**2. Installer les dépendances**

```bash
npm install
```

**3. Configurer le token**

```bash
cp .env.example .env
nano .env
# Ajoute ton token Discord
```

**4. Permissions du bot sur Discord Developer Portal**

Va sur [discord.com/developers](https://discord.com/developers) → ton application → Bot :

- ✅ `SERVER MEMBERS INTENT`
- ✅ `MESSAGE CONTENT INTENT`
- ✅ `PRESENCE INTENT`

Dans OAuth2 → URL Generator, sélectionne :

- Scopes : `bot`
- Bot Permissions : `Ban Members`, `Send Messages`, `Embed Links`, `View Channels`, `Read Message History`

**5. Lancer le bot**

```bash
npm start
```

-----

## 🔄 Maintenir le bot actif sur VPS (PM2)

```bash
# Installer PM2
npm install -g pm2

# Lancer avec PM2
pm2 start index.js --name forcebl-bot

# Démarrer automatiquement au reboot
pm2 startup
pm2 save
```

Commandes utiles PM2 :

```bash
pm2 status          # Voir l'état
pm2 logs forcebl-bot  # Voir les logs
pm2 restart forcebl-bot  # Redémarrer
pm2 stop forcebl-bot     # Stopper
```

-----

## 💾 Base de données

Le bot utilise **SQLite** via `better-sqlite3`. La base de données est stockée dans `data.db` à la racine du projet.

Elle persiste automatiquement même si le VPS redémarre (tant que le fichier n’est pas supprimé).

**Tables :**

- `forcebl` — Membres forcebl
- `banlist` — Membres banni
- `roles` — Membres ow/trust/wl
- `protect` — Membres protégés
- `hey` — Membres ultra-protégés (owner only)

**Backup (optionnel) :**

```bash
# Copier la base de données
cp data.db data_backup_$(date +%Y%m%d).db
```

-----

## 🐛 Problèmes fréquents

**“Missing Permissions” quand le bot essaie de ban**
→ Assure-toi que le rôle du bot est **au-dessus** des membres dans les paramètres du serveur.

**Le bot ne répond pas**
→ Vérifie que `Message Content Intent` est activé sur le Developer Portal.

**Erreur `better-sqlite3`**
→ Lance `npm rebuild` ou `npm install --build-from-source`

-----

## 📁 Structure du projet

```
discord-forcebl-bot/
├── index.js        # Fichier principal (commandes + events)
├── database.js     # Couche base de données SQLite
├── package.json    # Dépendances
├── .env            # Token (ne pas commit !)
├── .env.example    # Exemple de configuration
├── .gitignore      # Fichiers ignorés par git
├── data.db         # Base de données (auto-créée, ne pas commit)
└── README.md       # Ce fichier
```
