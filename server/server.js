const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const express = require("express");
const http = require("http");
const https = require("https");
const { Server } = require("socket.io");
const cors = require("cors");
const { Sequelize, DataTypes, Op } = require("sequelize");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");

// Data dir: local folder in dev, or Electron userData when packaged/shared
const DATA_DIR = process.env.DISCORD_LITE_DATA
  ? path.resolve(process.env.DISCORD_LITE_DATA)
  : __dirname;
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "database.sqlite");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

const app = express();
app.use(cors({ origin: "*" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
});
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/sounds", express.static(path.join(__dirname, "sounds")));

const SECRET = "secret123";

const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: DB_PATH,
  logging: false,
});

// --- Models ---

const User = sequelize.define("User", {
  username: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  avatarColor: { type: DataTypes.STRING, allowNull: false, defaultValue: "#5865f2" },
  bio: { type: DataTypes.TEXT, allowNull: true, defaultValue: "" },
  avatarUrl: { type: DataTypes.STRING, allowNull: true },
  nowPlaying: { type: DataTypes.STRING, allowNull: true }, // custom status text
  displayName: { type: DataTypes.STRING, allowNull: true },
  bannerColor: { type: DataTypes.STRING, allowNull: true },
  nameFont: { type: DataTypes.STRING, allowNull: false, defaultValue: "default" },
});

function publicProfile(user) {
  if (!user) {
    return {
      displayName: "",
      bannerColor: "#5865f2",
      nameFont: "default",
      customStatus: "",
      nowPlaying: "",
      avatarColor: "#5865f2",
      bio: "",
      avatarUrl: null,
    };
  }
  const customStatus = user.nowPlaying || "";
  return {
    displayName: user.displayName || user.username,
    bannerColor: user.bannerColor || user.avatarColor || "#5865f2",
    nameFont: user.nameFont || "default",
    customStatus,
    nowPlaying: customStatus,
    avatarColor: user.avatarColor || "#5865f2",
    bio: user.bio || "",
    avatarUrl: user.avatarUrl || null,
  };
}

const ChatServer = sequelize.define("ChatServer", {
  name: { type: DataTypes.STRING, allowNull: false },
  ownerUsername: { type: DataTypes.STRING, allowNull: false },
  iconUrl: { type: DataTypes.STRING, allowNull: true },
  isPublic: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  joinType: { type: DataTypes.STRING, allowNull: false, defaultValue: "invite" }, // "open" | "invite" | "apply"
  description: { type: DataTypes.TEXT, allowNull: true },
});

const Channel = sequelize.define("Channel", {
  serverId: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  type: { type: DataTypes.STRING, allowNull: false, defaultValue: "text" },
  restricted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  allowRoleIds: { type: DataTypes.TEXT, allowNull: true, defaultValue: "[]" },
  categoryId: { type: DataTypes.INTEGER, allowNull: true },
  position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
});

const ChannelCategory = sequelize.define("ChannelCategory", {
  serverId: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
});

const ServerMember = sequelize.define("ServerMember", {
  serverId:     { type: DataTypes.INTEGER, allowNull: false },
  username:     { type: DataTypes.STRING,  allowNull: false },
  role:         { type: DataTypes.STRING,  allowNull: false, defaultValue: "member" },
  customRoleId: { type: DataTypes.INTEGER, allowNull: true,  defaultValue: null },
});

const Invite = sequelize.define("Invite", {
  serverId: { type: DataTypes.INTEGER, allowNull: false },
  serverName: { type: DataTypes.STRING, allowNull: false },
  invitedUsername: { type: DataTypes.STRING, allowNull: false },
  invitedBy: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" },
});

const InviteLink = sequelize.define("InviteLink", {
  code: { type: DataTypes.STRING, unique: true, allowNull: false },
  serverId: { type: DataTypes.INTEGER, allowNull: false },
  createdBy: { type: DataTypes.STRING, allowNull: false },
  uses: { type: DataTypes.INTEGER, defaultValue: 0 },
});

const Message = sequelize.define("Message", {
  serverId: { type: DataTypes.INTEGER, allowNull: true },
  channelId: { type: DataTypes.INTEGER, allowNull: true },
  dmKey: { type: DataTypes.STRING, allowNull: true },
  username: { type: DataTypes.STRING, allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  edited: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  replyToId: { type: DataTypes.INTEGER, allowNull: true },         // Feature 4
  replyPreview: { type: DataTypes.STRING(200), allowNull: true },  // Feature 4
  replyAuthor: { type: DataTypes.STRING, allowNull: true },        // Feature 4
  pinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // Feature 5
  threadId: { type: DataTypes.INTEGER, allowNull: true }, // channel message thread (null = main channel)
});

const MessageThread = sequelize.define("MessageThread", {
  serverId: { type: DataTypes.INTEGER, allowNull: false },
  channelId: { type: DataTypes.INTEGER, allowNull: false },
  parentMessageId: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: true },
  createdBy: { type: DataTypes.STRING, allowNull: false },
});

const DirectMessage = sequelize.define("DirectMessage", {
  user1: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
  user2: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
  dmKey: { type: DataTypes.STRING, allowNull: false, unique: true },
  isGroup: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  name: { type: DataTypes.STRING, allowNull: true },
  members: { type: DataTypes.TEXT, allowNull: true, defaultValue: "[]" },
});

function parseThreadMembers(thread) {
  if (!thread) return [];
  if (thread.isGroup) {
    try {
      const list = JSON.parse(thread.members || "[]");
      return Array.isArray(list) ? list.filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }
  return [thread.user1, thread.user2].filter(Boolean);
}

const FriendRequest = sequelize.define("FriendRequest", {
  from: { type: DataTypes.STRING, allowNull: false },
  to: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" },
});

// Feature 6: Ban model
const Ban = sequelize.define("Ban", {
  serverId: { type: DataTypes.STRING, allowNull: false },
  username: { type: DataTypes.STRING, allowNull: false },
});

// Message Reactions
const Reaction = sequelize.define("Reaction", {
  messageId: { type: DataTypes.INTEGER, allowNull: false },
  serverId:  { type: DataTypes.INTEGER, allowNull: true },
  channelId: { type: DataTypes.INTEGER, allowNull: true },
  dmKey:     { type: DataTypes.STRING,  allowNull: true },
  emoji:     { type: DataTypes.STRING,  allowNull: false },
  username:  { type: DataTypes.STRING,  allowNull: false },
});

// Audit Log
const AuditLog = sequelize.define("AuditLog", {
  serverId:    { type: DataTypes.INTEGER, allowNull: false },
  action:      { type: DataTypes.STRING,  allowNull: false },
  performedBy: { type: DataTypes.STRING,  allowNull: false },
  target:      { type: DataTypes.STRING,  allowNull: true  },
  details:     { type: DataTypes.TEXT,    allowNull: true  },
});

// Block list
const Block = sequelize.define("Block", {
  blocker: { type: DataTypes.STRING, allowNull: false },
  blocked: { type: DataTypes.STRING, allowNull: false },
});

// Polls
const Poll = sequelize.define("Poll", {
  channelId:  { type: DataTypes.INTEGER, allowNull: true },
  dmKey:      { type: DataTypes.STRING,  allowNull: true },
  serverId:   { type: DataTypes.INTEGER, allowNull: true },
  username:   { type: DataTypes.STRING,  allowNull: false },
  question:   { type: DataTypes.TEXT,    allowNull: false },
  options:    { type: DataTypes.TEXT,    allowNull: false }, // JSON array
});

const PollVote = sequelize.define("PollVote", {
  pollId:   { type: DataTypes.INTEGER, allowNull: false },
  username: { type: DataTypes.STRING,  allowNull: false },
  optionIdx:{ type: DataTypes.INTEGER, allowNull: false },
});

// Custom Emoji
const CustomEmoji = sequelize.define("CustomEmoji", {
  serverId: { type: DataTypes.INTEGER, allowNull: false },
  name:     { type: DataTypes.STRING,  allowNull: false },
  url:      { type: DataTypes.STRING,  allowNull: false },
  addedBy:  { type: DataTypes.STRING,  allowNull: false },
});

// Read receipts for DMs
const ReadReceipt = sequelize.define("ReadReceipt", {
  dmKey:    { type: DataTypes.STRING,  allowNull: false },
  username: { type: DataTypes.STRING,  allowNull: false },
  lastReadId: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
});

// Custom Roles
const ServerRole = sequelize.define("ServerRole", {
  serverId:           { type: DataTypes.INTEGER, allowNull: false },
  name:               { type: DataTypes.STRING,  allowNull: false },
  color:              { type: DataTypes.STRING,  allowNull: false, defaultValue: "#5865f2" },
  hoist:              { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  position:           { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  canManageChannels:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  canKickMembers:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  canBanMembers:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  canInviteMembers:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true  },
  canPinMessages:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  canManageRoles:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
});

// --- HTTP / Socket.io ---

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const onlineUsers = new Map();
const socketUsers = new Map();
const voiceRooms = new Map();
const voiceMuteStates = new Map();
const voiceScreenSharers = new Map();
const userStatuses = new Map();  // username -> "online"|"away"|"dnd"|"invisible"

function dmKey(a, b) { return [a, b].sort().join(":"); }

async function logAudit(serverId, action, performedBy, target = null, details = null) {
  try { await AuditLog.create({ serverId, action, performedBy, target, details }); } catch {}
}

// Returns true if user has permission (owners always pass, admins always pass for backward compat, else check custom role)
async function hasPerm(serverId, username, perm) {
  const member = await ServerMember.findOne({ where: { serverId, username } });
  if (!member) return false;
  if (member.role === "owner" || member.role === "admin") return true;
  if (member.customRoleId) {
    const role = await ServerRole.findByPk(member.customRoleId);
    if (role && role[perm]) return true;
  }
  return false;
}

async function emitServerMembers(serverId) {
  const members = await ServerMember.findAll({ where: { serverId }, order: [["role", "ASC"], ["username", "ASC"]] });
  const users = await User.findAll({ where: { username: members.map(m => m.username) } });
  const userMap = Object.fromEntries(users.map(u => [u.username, u]));
  const roles = await ServerRole.findAll({ where: { serverId } });
  const roleMap = Object.fromEntries(roles.map(r => [r.id, r]));
  const result = members.map((member) => ({
    id: member.id, username: member.username, role: member.role,
    customRoleId: member.customRoleId || null,
    customRole: member.customRoleId ? roleMap[member.customRoleId] || null : null,
    online: onlineUsers.has(member.username),
    status: userStatuses.get(member.username) || (onlineUsers.has(member.username) ? "online" : "offline"),
    ...publicProfile(userMap[member.username]),
  }));
  io.to(`server_${serverId}`).emit("server_members", result);
}

function parseAllowRoleIds(channel) {
  try {
    const raw = channel.allowRoleIds;
    if (!raw) return [];
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.map(Number).filter(Boolean) : [];
  } catch { return []; }
}

async function memberCanAccessChannel(channel, username) {
  if (!channel.restricted) return true;
  const member = await ServerMember.findOne({ where: { serverId: channel.serverId, username } });
  if (!member) return false;
  if (member.role === "owner" || member.role === "admin") return true;
  const allowed = parseAllowRoleIds(channel);
  if (!allowed.length) return false;
  return member.customRoleId && allowed.includes(Number(member.customRoleId));
}

/** Ensure a server has categories and every channel is assigned + positioned. */
async function ensureServerCategories(serverId) {
  let cats = await ChannelCategory.findAll({ where: { serverId }, order: [["position", "ASC"], ["id", "ASC"]] });
  if (!cats.length) {
    const textCat = await ChannelCategory.create({ serverId, name: "Text Channels", position: 0 });
    const voiceCat = await ChannelCategory.create({ serverId, name: "Voice Channels", position: 1 });
    cats = [textCat, voiceCat];
  }
  const textCat = cats.find(c => /text/i.test(c.name)) || cats[0];
  const voiceCat = cats.find(c => /voice/i.test(c.name)) || cats[1] || cats[0];

  const channels = await Channel.findAll({ where: { serverId }, order: [["position", "ASC"], ["createdAt", "ASC"], ["id", "ASC"]] });
  const nextPos = {};
  for (const c of cats) nextPos[c.id] = 0;
  for (const ch of channels) {
    if (ch.categoryId != null && cats.some(c => c.id === ch.categoryId)) {
      nextPos[ch.categoryId] = Math.max(nextPos[ch.categoryId] || 0, (ch.position || 0) + 1);
      continue;
    }
    const cat = ch.type === "voice" ? voiceCat : textCat;
    const pos = nextPos[cat.id] || 0;
    ch.categoryId = cat.id;
    ch.position = pos;
    nextPos[cat.id] = pos + 1;
    await ch.save();
  }
  return ChannelCategory.findAll({ where: { serverId }, order: [["position", "ASC"], ["id", "ASC"]] });
}

async function listChannelsForUser(serverId, username) {
  const categories = await ensureServerCategories(serverId);
  const channels = await Channel.findAll({
    where: { serverId },
    order: [["position", "ASC"], ["createdAt", "ASC"], ["id", "ASC"]],
  });
  const visible = [];
  for (const ch of channels) {
    if (!username || await memberCanAccessChannel(ch, username)) visible.push(ch);
  }
  return { categories, channels: visible };
}

function emitChannelsUpdated(serverId) {
  io.to(`server_${serverId}`).emit("channels_updated", { serverId: Number(serverId) });
}

async function emitVoiceState(channelId) {
  const key = String(channelId);
  const users = voiceRooms.get(key) || new Set();
  const muteMap = voiceMuteStates.get(key) || new Map();
  const usersWithState = Array.from(users).map(u => {
    const st = muteMap.get(u) || {};
    return {
      username: u,
      muted: !!(st.muted || st.serverMuted),
      deafened: !!(st.deafened || st.serverDeafened),
      serverMuted: !!st.serverMuted,
      serverDeafened: !!st.serverDeafened,
    };
  });
  io.emit("voice_state", { channelId: key, users: usersWithState });
}

// --- Socket.io ---

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("register_socket_user", async (username) => {
    if (!username) return;
    onlineUsers.set(username, socket.id);
    socketUsers.set(socket.id, username);
    socket.join(`user_${username}`);
    const memberships = await ServerMember.findAll({ where: { username } });
    for (const m of memberships) await emitServerMembers(m.serverId);
  });

  socket.on("join_server", async (serverId) => {
    if (!serverId) return;
    // Only leave other server rooms — keep user_*, voice_*, dm_*, channel_* intact
    Array.from(socket.rooms).forEach((room) => {
      if (room !== socket.id && room.startsWith("server_")) socket.leave(room);
    });
    socket.join(`server_${serverId}`);
    await emitServerMembers(serverId);
  });

  socket.on("join_channel", async ({ channelId, serverId }) => {
    if (!channelId) return;
    Array.from(socket.rooms).forEach((room) => {
      if (room !== socket.id && room.startsWith("channel_")) socket.leave(room);
      if (room !== socket.id && room.startsWith("msgthread_")) socket.leave(room);
    });
    socket.join(`channel_${channelId}`);
    const messages = await Message.findAll({
      where: { channelId, threadId: { [Op.is]: null } },
      order: [["createdAt", "ASC"]],
    });
    // Attach reply counts for threads rooted at these messages
    const parents = messages.map(m => m.id);
    const threads = parents.length
      ? await MessageThread.findAll({ where: { parentMessageId: { [Op.in]: parents } } })
      : [];
    const threadByParent = Object.fromEntries(threads.map(t => [t.parentMessageId, t]));
    const counts = {};
    for (const t of threads) {
      counts[t.id] = await Message.count({ where: { threadId: t.id } });
    }
    const enriched = messages.map(m => {
      const json = m.toJSON();
      const th = threadByParent[m.id];
      if (th) {
        json.threadIdForParent = th.id;
        json.threadReplyCount = counts[th.id] || 0;
        json.threadName = th.name;
      }
      return json;
    });
    socket.emit("load_messages", enriched);
  });

  socket.on("create_message_thread", async ({ parentMessageId, username, name }) => {
    if (!parentMessageId || !username) return;
    const parent = await Message.findByPk(parentMessageId);
    if (!parent || !parent.channelId || parent.threadId) {
      socket.emit("thread_error", { error: "Can only start a thread from a channel message" });
      return;
    }
    const channel = await Channel.findByPk(parent.channelId);
    if (!channel || !(await memberCanAccessChannel(channel, username))) {
      socket.emit("thread_error", { error: "No access" });
      return;
    }
    let thread = await MessageThread.findOne({ where: { parentMessageId: parent.id } });
    if (!thread) {
      const autoName = (name && String(name).trim())
        || String(parent.message).replace(/\s+/g, " ").slice(0, 50)
        || "Thread";
      thread = await MessageThread.create({
        serverId: channel.serverId,
        channelId: channel.id,
        parentMessageId: parent.id,
        name: autoName,
        createdBy: username,
      });
    }
    const replyCount = await Message.count({ where: { threadId: thread.id } });
    socket.join(`msgthread_${thread.id}`);
    io.to(`channel_${channel.id}`).emit("thread_created", {
      thread: thread.toJSON(),
      parentMessageId: parent.id,
      replyCount,
    });
    socket.emit("thread_opened", {
      thread: thread.toJSON(),
      parent,
      messages: await Message.findAll({ where: { threadId: thread.id }, order: [["createdAt", "ASC"]] }),
      replyCount,
    });
  });

  socket.on("join_message_thread", async ({ threadId, username }) => {
    if (!threadId) return;
    const thread = await MessageThread.findByPk(threadId);
    if (!thread) {
      socket.emit("thread_error", { error: "Thread not found" });
      return;
    }
    const channel = await Channel.findByPk(thread.channelId);
    if (!channel || (username && !(await memberCanAccessChannel(channel, username)))) {
      socket.emit("thread_error", { error: "No access" });
      return;
    }
    Array.from(socket.rooms).forEach((room) => {
      if (room !== socket.id && room.startsWith("msgthread_")) socket.leave(room);
    });
    socket.join(`msgthread_${threadId}`);
    const parent = await Message.findByPk(thread.parentMessageId);
    const messages = await Message.findAll({ where: { threadId }, order: [["createdAt", "ASC"]] });
    socket.emit("thread_opened", {
      thread: thread.toJSON(),
      parent,
      messages,
      replyCount: messages.length,
    });
  });

  socket.on("leave_message_thread", ({ threadId }) => {
    if (threadId) socket.leave(`msgthread_${threadId}`);
  });

  socket.on("join_dm", async ({ dmKey: key, username: joinUser }) => {
    if (!key) return;
    if (joinUser) {
      const thread = await DirectMessage.findOne({ where: { dmKey: key } });
      if (thread && !parseThreadMembers(thread).includes(joinUser)) return;
    }
    Array.from(socket.rooms).forEach((room) => {
      if (room !== socket.id && room.startsWith("dm_")) socket.leave(room);
      if (room !== socket.id && room.startsWith("channel_")) socket.leave(room);
      if (room !== socket.id && room.startsWith("msgthread_")) socket.leave(room);
    });
    socket.join(`dm_${key}`);
    const messages = await Message.findAll({ where: { dmKey: key }, order: [["createdAt", "ASC"]] });
    socket.emit("load_messages", messages);
  });

  // DM call relay
  socket.on("dm_call_invite", (data) => { socket.to(`user_${data.to}`).emit("dm_call_invite", data); });
  socket.on("dm_call_reject", (data) => { socket.to(`user_${data.from}`).emit("dm_call_reject", data); });
  socket.on("dm_call_hangup", (data) => { socket.to(`dm_${data.dmKey}`).emit("dm_call_hangup", data); });
  socket.on("dm_offer", (data) => { socket.to(`user_${data.to}`).emit("dm_offer", { ...data, from: data.from }); });
  socket.on("dm_answer", (data) => { const from = socketUsers.get(socket.id); socket.to(`user_${data.to}`).emit("dm_answer", { ...data, from }); });
  socket.on("dm_ice", (data) => { const from = socketUsers.get(socket.id); socket.to(`user_${data.to}`).emit("dm_ice", { ...data, from }); });

  // Feature 4: replyToId support in send_message
  socket.on("send_message", async (data) => {
    const { channelId, dmKey: key, username, message, replyToId, threadId } = data;
    if (!username || !message) return;

    let replyPreview = null;
    let replyAuthor = null;
    if (replyToId) {
      const original = await Message.findByPk(replyToId);
      if (original) {
        replyPreview = original.message.slice(0, 80);
        replyAuthor = original.username;
      }
    }

    if (threadId) {
      const thread = await MessageThread.findByPk(threadId);
      if (!thread) return;
      const channel = await Channel.findByPk(thread.channelId);
      if (!channel || !(await memberCanAccessChannel(channel, username))) return;
      const saved = await Message.create({
        serverId: channel.serverId,
        channelId: channel.id,
        username,
        message,
        replyToId: replyToId || null,
        replyPreview,
        replyAuthor,
        threadId: thread.id,
      });
      const replyCount = await Message.count({ where: { threadId: thread.id } });
      const payload = { ...saved.toJSON(), threadReplyCount: replyCount };
      io.to(`msgthread_${thread.id}`).emit("receive_message", payload);
      io.to(`channel_${channel.id}`).emit("thread_reply_count", {
        threadId: thread.id,
        parentMessageId: thread.parentMessageId,
        replyCount,
      });
      return;
    }

    if (channelId) {
      const channel = await Channel.findByPk(channelId);
      if (!channel) return;
      if (!(await memberCanAccessChannel(channel, username))) return;
      const saved = await Message.create({
        serverId: channel.serverId,
        channelId,
        username,
        message,
        replyToId: replyToId || null,
        replyPreview,
        replyAuthor,
        threadId: null,
      });
      io.to(`channel_${channelId}`).emit("receive_message", saved);
      // Alert all online server members (even if they aren't in this channel room)
      const members = await ServerMember.findAll({ where: { serverId: channel.serverId } });
      const preview = String(message).startsWith("[FILE:") ? "📎 File" : String(message).slice(0, 120);
      const notif = {
        id: saved.id,
        channelId,
        serverId: channel.serverId,
        username,
        message: preview,
        channelName: channel.name
      };
      for (const m of members) {
        if (m.username === username) continue;
        if (!(await memberCanAccessChannel(channel, m.username))) continue;
        io.to(`user_${m.username}`).emit("message_notify", notif);
      }
    } else if (key) {
      const saved = await Message.create({ dmKey: key, username, message, replyToId: replyToId || null, replyPreview, replyAuthor });
      io.to(`dm_${key}`).emit("receive_message", saved);
      const thread = await DirectMessage.findOne({ where: { dmKey: key } });
      if (thread) {
        const preview = String(message).startsWith("[FILE:") ? "📎 File" : String(message).slice(0, 120);
        const notif = { id: saved.id, dmKey: key, username, message: preview };
        for (const member of parseThreadMembers(thread)) {
          if (member === username) continue;
          io.to(`user_${member}`).emit("message_notify", notif);
        }
        thread.changed("updatedAt", true);
        await thread.save();
      }
    }
  });

  socket.on("edit_message", async ({ messageId, newMessage, username }) => {
    const msg = await Message.findByPk(messageId);
    if (!msg || msg.username !== username) return;
    msg.message = newMessage; msg.edited = true;
    await msg.save();
    const room = msg.channelId ? `channel_${msg.channelId}` : `dm_${msg.dmKey}`;
    io.to(room).emit("message_edited", { id: msg.id, message: msg.message, edited: true });
  });

  socket.on("delete_message", async ({ messageId, username }) => {
    const msg = await Message.findByPk(messageId);
    if (!msg || msg.username !== username) return;
    const room = msg.channelId ? `channel_${msg.channelId}` : `dm_${msg.dmKey}`;
    await msg.destroy();
    io.to(room).emit("message_deleted", { id: messageId });
  });

  socket.on("join_voice", async ({ channelId, username }) => {
    if (!channelId || !username) return;
    const channel = await Channel.findByPk(channelId);
    if (!channel) return;
    if (!(await memberCanAccessChannel(channel, username))) return;
    const key = String(channelId);
    if (!voiceRooms.has(key)) voiceRooms.set(key, new Set());
    voiceRooms.get(key).add(username);
    if (!voiceMuteStates.has(key)) voiceMuteStates.set(key, new Map());
    voiceMuteStates.get(key).set(username, { muted: false, deafened: false, serverMuted: false, serverDeafened: false });
    socket.join(`voice_${channelId}`);
    socket.to(`voice_${channelId}`).emit("voice_user_joined", { username, socketId: socket.id });
    await emitVoiceState(channelId);
  });

  socket.on("leave_voice", async ({ channelId, username }) => {
    if (!channelId || !username) return;
    const key = String(channelId);
    if (voiceRooms.has(key)) voiceRooms.get(key).delete(username);
    if (voiceMuteStates.has(key)) voiceMuteStates.get(key).delete(username);
    socket.leave(`voice_${channelId}`);
    socket.to(`voice_${channelId}`).emit("voice_user_left", { username, socketId: socket.id });
    // Feature 11: clean up screenshare on leave
    if (voiceScreenSharers.has(key) && voiceScreenSharers.get(key).has(username)) {
      voiceScreenSharers.get(key).delete(username);
      io.to(`voice_${channelId}`).emit("screen_share_stopped", { username });
    }
    await emitVoiceState(channelId);
  });

  socket.on("voice_mute_state", async ({ channelId, username, muted, deafened }) => {
    if (!channelId || !username) return;
    const key = String(channelId);
    if (!voiceMuteStates.has(key)) voiceMuteStates.set(key, new Map());
    const prev = voiceMuteStates.get(key).get(username) || {};
    // Server mute/deafen cannot be cleared by the user
    let nextMuted = !!muted;
    let nextDeafened = !!deafened;
    if (prev.serverMuted) nextMuted = true;
    if (prev.serverDeafened) { nextDeafened = true; nextMuted = true; }
    voiceMuteStates.get(key).set(username, {
      muted: nextMuted,
      deafened: nextDeafened,
      serverMuted: !!prev.serverMuted,
      serverDeafened: !!prev.serverDeafened,
    });
    await emitVoiceState(channelId);
  });

  // Mods: force mute / deafen someone in VC
  socket.on("mod_voice_state", async ({ channelId, target, serverMuted, serverDeafened, by }) => {
    if (!channelId || !target || !by) return;
    const channel = await Channel.findByPk(channelId);
    if (!channel) return;
    if (!await hasPerm(channel.serverId, by, "canKickMembers")) return;
    if (target === by) return;
    const key = String(channelId);
    if (!voiceRooms.has(key) || !voiceRooms.get(key).has(target)) return;
    if (!voiceMuteStates.has(key)) voiceMuteStates.set(key, new Map());
    const prev = voiceMuteStates.get(key).get(target) || {};
    const sm = serverMuted !== undefined ? !!serverMuted : !!prev.serverMuted;
    const sd = serverDeafened !== undefined ? !!serverDeafened : !!prev.serverDeafened;
    const next = {
      serverMuted: sm,
      serverDeafened: sd,
      muted: sm || sd,
      deafened: sd,
    };
    voiceMuteStates.get(key).set(target, next);
    io.to(`user_${target}`).emit("force_voice_state", {
      channelId: key,
      serverMuted: next.serverMuted,
      serverDeafened: next.serverDeafened,
      muted: next.muted,
      deafened: next.deafened,
      by,
    });
    await emitVoiceState(channelId);
  });

  // Mods: move a user to another voice channel
  socket.on("mod_move_voice", async ({ fromChannelId, toChannelId, toChannelName, target, by }) => {
    if (!fromChannelId || !toChannelId || !target || !by) return;
    if (target === by) return;
    const fromCh = await Channel.findByPk(fromChannelId);
    const toCh = await Channel.findByPk(toChannelId);
    if (!fromCh || !toCh) return;
    if (String(fromCh.serverId) !== String(toCh.serverId)) return;
    if (toCh.type !== "voice") return;
    if (!await hasPerm(fromCh.serverId, by, "canKickMembers")) return;
    const fromKey = String(fromChannelId);
    if (!voiceRooms.has(fromKey) || !voiceRooms.get(fromKey).has(target)) return;
    if (!(await memberCanAccessChannel(toCh, target))) return;
    io.to(`user_${target}`).emit("force_move_voice", {
      fromChannelId: fromKey,
      toChannelId: String(toChannelId),
      toChannelName: toChannelName || toCh.name || "Voice",
      by,
    });
  });

  socket.on("voice_offer", ({ targetSocketId, offer, from }) => { io.to(targetSocketId).emit("voice_offer", { offer, from, socketId: socket.id }); });
  socket.on("voice_answer", ({ targetSocketId, answer }) => { io.to(targetSocketId).emit("voice_answer", { answer, socketId: socket.id }); });
  socket.on("voice_ice", ({ targetSocketId, candidate }) => { io.to(targetSocketId).emit("voice_ice", { candidate, socketId: socket.id }); });

  // Feature 2: Typing indicator relay
  socket.on("typing_start", ({ channelId, dmKey: key, username }) => {
    if (channelId) socket.to(`channel_${channelId}`).emit("typing_start", { username, channelId });
    else if (key) socket.to(`dm_${key}`).emit("typing_start", { username, dmKey: key });
  });

  socket.on("typing_stop", ({ channelId, dmKey: key, username }) => {
    if (channelId) socket.to(`channel_${channelId}`).emit("typing_stop", { username, channelId });
    else if (key) socket.to(`dm_${key}`).emit("typing_stop", { username, dmKey: key });
  });

  // Feature 11: Screenshare signaling
  socket.on("screen_share_start", ({ channelId, username }) => {
    const key = String(channelId);
    if (!voiceScreenSharers.has(key)) voiceScreenSharers.set(key, new Set());
    voiceScreenSharers.get(key).add(username);
    socket.to(`voice_${channelId}`).emit("screen_share_started", { username, socketId: socket.id });
  });

  socket.on("screen_share_stop", ({ channelId, username }) => {
    const key = String(channelId);
    if (voiceScreenSharers.has(key)) voiceScreenSharers.get(key).delete(username);
    io.to(`voice_${channelId}`).emit("screen_share_stopped", { username });
  });

  socket.on("screen_offer", ({ targetSocketId, offer }) => {
    io.to(targetSocketId).emit("screen_offer", { offer, socketId: socket.id });
  });

  socket.on("screen_answer", ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit("screen_answer", { answer, socketId: socket.id });
  });

  socket.on("screen_ice", ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit("screen_ice", { candidate, socketId: socket.id });
  });

  // --- Reactions ---
  socket.on("add_reaction", async ({ messageId, emoji, username, channelId, dmKey: dk }) => {
    const existing = await Reaction.findOne({ where: { messageId, emoji, username } });
    if (existing) return; // already reacted
    const msg = await Message.findByPk(messageId);
    if (!msg) return;
    await Reaction.create({ messageId, serverId: msg.serverId, channelId: msg.channelId, dmKey: msg.dmKey, emoji, username });
    const all = await Reaction.findAll({ where: { messageId } });
    const grouped = {};
    all.forEach(r => { if (!grouped[r.emoji]) grouped[r.emoji] = []; grouped[r.emoji].push(r.username); });
    if (channelId) io.to(`channel_${channelId}`).emit("reaction_update", { messageId, reactions: grouped });
    else if (dk) io.to(`dm_${dk}`).emit("reaction_update", { messageId, reactions: grouped });
  });

  socket.on("remove_reaction", async ({ messageId, emoji, username, channelId, dmKey: dk }) => {
    await Reaction.destroy({ where: { messageId, emoji, username } });
    const all = await Reaction.findAll({ where: { messageId } });
    const grouped = {};
    all.forEach(r => { if (!grouped[r.emoji]) grouped[r.emoji] = []; grouped[r.emoji].push(r.username); });
    if (channelId) io.to(`channel_${channelId}`).emit("reaction_update", { messageId, reactions: grouped });
    else if (dk) io.to(`dm_${dk}`).emit("reaction_update", { messageId, reactions: grouped });
  });

  // --- User status ---
  socket.on("set_status", ({ username, status }) => {
    if (!["online","away","dnd","invisible"].includes(status)) return;
    userStatuses.set(username, status);
    // Broadcast to everyone (simplified: broadcast globally)
    io.emit("user_status_changed", { username, status: status === "invisible" ? "offline" : status });
  });

  // --- Voice speaking indicator ---
  socket.on("voice_speaking", ({ channelId, username, speaking }) => {
    socket.to(`voice_${channelId}`).emit("voice_speaking", { username, speaking });
  });

  socket.on("disconnect", async () => {
    const username = socketUsers.get(socket.id);
    if (username) {
      onlineUsers.delete(username);
      socketUsers.delete(socket.id);
      voiceRooms.forEach((users, channelId) => {
        if (users.has(username)) {
          users.delete(username);
          if (voiceMuteStates.has(channelId)) voiceMuteStates.get(channelId).delete(username);
          socket.to(`voice_${channelId}`).emit("voice_user_left", { username, socketId: socket.id });
          emitVoiceState(channelId);
          // Feature 11: clean up screenshare on disconnect
          if (voiceScreenSharers.has(channelId) && voiceScreenSharers.get(channelId).has(username)) {
            voiceScreenSharers.get(channelId).delete(username);
            io.to(`voice_${channelId}`).emit("screen_share_stopped", { username });
          }
        }
      });
      const memberships = await ServerMember.findAll({ where: { username } });
      for (const m of memberships) await emitServerMembers(m.serverId);
    }
  });
});

// --- REST Routes ---

app.get("/", (req, res) => res.send("Server is running"));

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const existing = await User.findOne({ where: { username } });
    if (existing) return res.status(400).json({ error: "User already exists" });
    const hashed = await bcrypt.hash(password, 10);
    const colors = ["#5865f2","#ed4245","#3ba55c","#faa61a","#eb459e","#4fdc7c","#00b0f4","#ff7043"];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];
    await User.create({ username, password: hashed, avatarColor });
    res.json({ message: "Registered successfully" });
  } catch { res.status(500).json({ error: "Registration failed" }); }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });
    const token = jwt.sign({ username }, SECRET, { expiresIn: "30d" });
    res.json({
      token,
      username,
      ...publicProfile(user),
    });
  } catch { res.status(500).json({ error: "Login failed" }); }
});

app.post("/update-profile", async (req, res) => {
  try {
    const { username, avatarColor, bio, displayName, bannerColor, nameFont, customStatus, nowPlaying } = req.body;
    const user = await User.findOne({ where: { username } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (avatarColor) user.avatarColor = avatarColor;
    if (bio !== undefined) user.bio = bio;
    if (displayName !== undefined) {
      const cleaned = String(displayName || "").trim().slice(0, 32);
      user.displayName = cleaned || null;
    }
    if (bannerColor !== undefined) user.bannerColor = bannerColor || null;
    if (nameFont !== undefined) {
      const allowed = ["default", "serif", "mono", "rounded", "display"];
      user.nameFont = allowed.includes(nameFont) ? nameFont : "default";
    }
    if (customStatus !== undefined || nowPlaying !== undefined) {
      user.nowPlaying = String(customStatus ?? nowPlaying ?? "").trim().slice(0, 128) || null;
    }
    await user.save();
    const profile = publicProfile(user);
    io.emit("profile_update", { username: user.username, ...profile });
    // refresh member lists for all servers this user is in
    const memberships = await ServerMember.findAll({ where: { username: user.username } });
    for (const m of memberships) await emitServerMembers(m.serverId);
    res.json({ message: "Profile updated", ...profile });
  } catch { res.status(500).json({ error: "Failed to update profile" }); }
});

app.post("/change-password", async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    const user = await User.findOne({ where: { username } });
    if (!user) return res.status(404).json({ error: "User not found" });
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(400).json({ error: "Current password is incorrect" });
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: "Password updated" });
  } catch { res.status(500).json({ error: "Failed to change password" }); }
});

app.get("/my-servers/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const memberships = await ServerMember.findAll({ where: { username } });
    const serverIds = memberships.map((m) => m.serverId);
    if (!serverIds.length) return res.json([]);
    const servers = await ChatServer.findAll({ where: { id: { [Op.in]: serverIds } }, order: [["createdAt", "ASC"]] });
    res.json(servers); // includes iconUrl since it's on the model
  } catch { res.status(500).json({ error: "Failed to load servers" }); }
});

app.get("/channels/:serverId", async (req, res) => {
  try {
    const username = req.query.username || "";
    const payload = await listChannelsForUser(req.params.serverId, username);
    res.json(payload);
  } catch { res.status(500).json({ error: "Failed to load channels" }); }
});

app.post("/create-category", async (req, res) => {
  try {
    const { serverId, name, username } = req.body;
    if (!serverId || !name || !username) return res.status(400).json({ error: "Missing data" });
    if (!await hasPerm(serverId, username, "canManageChannels"))
      return res.status(403).json({ error: "No permission" });
    await ensureServerCategories(serverId);
    const maxPos = await ChannelCategory.max("position", { where: { serverId } });
    const category = await ChannelCategory.create({
      serverId,
      name: String(name).trim().slice(0, 100) || "New Category",
      position: (maxPos == null ? -1 : maxPos) + 1,
    });
    emitChannelsUpdated(serverId);
    res.json({ message: "Category created", category });
  } catch { res.status(500).json({ error: "Failed to create category" }); }
});

app.post("/rename-category", async (req, res) => {
  try {
    const { categoryId, name, username } = req.body;
    const category = await ChannelCategory.findByPk(categoryId);
    if (!category) return res.status(404).json({ error: "Category not found" });
    if (!await hasPerm(category.serverId, username, "canManageChannels"))
      return res.status(403).json({ error: "No permission" });
    category.name = String(name || "").trim().slice(0, 100) || category.name;
    await category.save();
    emitChannelsUpdated(category.serverId);
    res.json({ message: "Category renamed", category });
  } catch { res.status(500).json({ error: "Failed to rename category" }); }
});

app.post("/delete-category", async (req, res) => {
  try {
    const { categoryId, username } = req.body;
    const category = await ChannelCategory.findByPk(categoryId);
    if (!category) return res.status(404).json({ error: "Category not found" });
    if (!await hasPerm(category.serverId, username, "canManageChannels"))
      return res.status(403).json({ error: "No permission" });
    const cats = await ensureServerCategories(category.serverId);
    if (cats.length <= 1) return res.status(400).json({ error: "Cannot delete the last category" });
    const fallback = cats.find(c => c.id !== category.id);
    const channels = await Channel.findAll({ where: { categoryId: category.id } });
    let pos = await Channel.max("position", { where: { categoryId: fallback.id } });
    pos = pos == null ? 0 : pos + 1;
    for (const ch of channels) {
      ch.categoryId = fallback.id;
      ch.position = pos++;
      await ch.save();
    }
    await category.destroy();
    emitChannelsUpdated(category.serverId);
    res.json({ message: "Category deleted" });
  } catch { res.status(500).json({ error: "Failed to delete category" }); }
});

app.post("/reorder-channels", async (req, res) => {
  try {
    const { serverId, username, categories } = req.body;
    if (!serverId || !username || !Array.isArray(categories))
      return res.status(400).json({ error: "Missing data" });
    if (!await hasPerm(serverId, username, "canManageChannels"))
      return res.status(403).json({ error: "No permission" });
    for (let i = 0; i < categories.length; i++) {
      const entry = categories[i];
      const cat = await ChannelCategory.findOne({ where: { id: entry.id, serverId } });
      if (!cat) continue;
      cat.position = entry.position != null ? entry.position : i;
      await cat.save();
      const ids = Array.isArray(entry.channelIds) ? entry.channelIds : [];
      for (let j = 0; j < ids.length; j++) {
        await Channel.update(
          { categoryId: cat.id, position: j },
          { where: { id: ids[j], serverId } }
        );
      }
    }
    emitChannelsUpdated(serverId);
    res.json({ message: "Channels reordered" });
  } catch { res.status(500).json({ error: "Failed to reorder channels" }); }
});

app.post("/create-channel", async (req, res) => {
  try {
    const { serverId, name, type, username, restricted, allowRoleIds, categoryId } = req.body;
    if (!serverId || !name || !username) return res.status(400).json({ error: "Missing data" });
    const member = await ServerMember.findOne({ where: { serverId, username } });
    if (!member || !["owner", "admin"].includes(member.role)) {
      if (!await hasPerm(serverId, username, "canManageChannels"))
        return res.status(403).json({ error: "No permission" });
    }
    const cats = await ensureServerCategories(serverId);
    const chType = type || "text";
    let cat = categoryId ? cats.find(c => c.id === Number(categoryId)) : null;
    if (!cat) {
      cat = chType === "voice"
        ? (cats.find(c => /voice/i.test(c.name)) || cats[cats.length - 1])
        : (cats.find(c => /text/i.test(c.name)) || cats[0]);
    }
    const maxPos = await Channel.max("position", { where: { categoryId: cat.id } });
    const channel = await Channel.create({
      serverId,
      name: name.trim(),
      type: chType,
      restricted: !!restricted,
      allowRoleIds: JSON.stringify(Array.isArray(allowRoleIds) ? allowRoleIds : []),
      categoryId: cat.id,
      position: (maxPos == null ? -1 : maxPos) + 1,
    });
    emitChannelsUpdated(serverId);
    res.json({ message: "Channel created", channel });
  } catch { res.status(500).json({ error: "Failed to create channel" }); }
});

app.post("/update-channel-perms", async (req, res) => {
  try {
    const { channelId, username, restricted, allowRoleIds } = req.body;
    const channel = await Channel.findByPk(channelId);
    if (!channel) return res.status(404).json({ error: "Channel not found" });
    if (!await hasPerm(channel.serverId, username, "canManageChannels"))
      return res.status(403).json({ error: "No permission" });
    channel.restricted = !!restricted;
    channel.allowRoleIds = JSON.stringify(Array.isArray(allowRoleIds) ? allowRoleIds : []);
    await channel.save();
    res.json({ message: "Channel permissions updated", channel });
  } catch { res.status(500).json({ error: "Failed to update channel" }); }
});

app.post("/delete-channel", async (req, res) => {
  try {
    const { channelId, username } = req.body;
    const channel = await Channel.findByPk(channelId);
    if (!channel) return res.status(404).json({ error: "Channel not found" });
    const member = await ServerMember.findOne({ where: { serverId: channel.serverId, username } });
    if (!member || !["owner", "admin"].includes(member.role)) return res.status(403).json({ error: "No permission" });
    await Message.destroy({ where: { channelId } });
    await channel.destroy();
    emitChannelsUpdated(channel.serverId);
    res.json({ message: "Channel deleted" });
  } catch { res.status(500).json({ error: "Failed to delete channel" }); }
});

app.post("/invite-user", async (req, res) => {
  try {
    const { serverId, usernameToInvite, invitedBy } = req.body;
    if (!serverId || !usernameToInvite || !invitedBy) return res.status(400).json({ error: "Missing data" });
    const serverRecord = await ChatServer.findByPk(serverId);
    if (!serverRecord) return res.status(404).json({ error: "Server not found" });
    const inviterMembership = await ServerMember.findOne({ where: { serverId, username: invitedBy } });
    if (!inviterMembership) return res.status(403).json({ error: "Not a member" });
    // Owner/admin always; custom role may deny; plain members can invite (same as invite links)
    const isMod = ["owner", "admin"].includes(inviterMembership.role);
    let canInvite = isMod;
    if (!canInvite && inviterMembership.customRoleId) {
      const role = await ServerRole.findByPk(inviterMembership.customRoleId);
      canInvite = !role || role.canInviteMembers !== false;
    } else if (!canInvite) {
      canInvite = true;
    }
    if (!canInvite) return res.status(403).json({ error: "No permission to invite" });
    const invitedUser = await User.findOne({ where: { username: usernameToInvite } });
    if (!invitedUser) return res.status(404).json({ error: "User does not exist" });
    const existing = await ServerMember.findOne({ where: { serverId, username: usernameToInvite } });
    if (existing) return res.status(400).json({ error: "User is already a member" });
    const existingInvite = await Invite.findOne({ where: { serverId, invitedUsername: usernameToInvite, status: "pending" } });
    if (existingInvite) return res.status(400).json({ error: "Invite already pending" });
    const created = await Invite.create({ serverId, serverName: serverRecord.name, invitedUsername: usernameToInvite, invitedBy, status: "pending" });
    // Deliver like Discord: invite appears as a DM card from the inviter
    const key = dmKey(invitedBy, usernameToInvite);
    let thread = await DirectMessage.findOne({ where: { dmKey: key } });
    if (!thread) {
      thread = await DirectMessage.create({ user1: invitedBy, user2: usernameToInvite, dmKey: key, isGroup: false });
    }
    const invitePayload = {
      inviteId: created.id,
      serverId: Number(serverId),
      serverName: serverRecord.name,
      iconUrl: serverRecord.iconUrl || null,
      invitedBy
    };
    const inviteMsg = `[IRIS_INVITE]${JSON.stringify(invitePayload)}`;
    const saved = await Message.create({ dmKey: key, username: invitedBy, message: inviteMsg });
    const savedJson = {
      ...saved.toJSON(),
      avatarColor: null,
      avatarUrl: null,
      displayName: invitedBy
    };
    const inviterUser = await User.findOne({ where: { username: invitedBy } });
    if (inviterUser) {
      savedJson.avatarColor = inviterUser.avatarColor;
      savedJson.avatarUrl = inviterUser.avatarUrl;
      savedJson.displayName = inviterUser.displayName || invitedBy;
    }
    io.to(`dm_${key}`).emit("receive_message", savedJson);
    io.to(`user_${usernameToInvite}`).emit("receive_message", savedJson);
    io.to(`user_${invitedBy}`).emit("receive_message", savedJson);
    io.to(`user_${usernameToInvite}`).emit("server_invite", {
      id: created.id,
      serverId: Number(serverId),
      serverName: serverRecord.name,
      invitedBy,
      dmKey: key,
      iconUrl: serverRecord.iconUrl || null
    });
    res.json({ message: "Invite sent", inviteId: created.id, dmKey: key });
  } catch { res.status(500).json({ error: "Failed to invite user" }); }
});

app.get("/invites/:username", async (req, res) => {
  try {
    const invites = await Invite.findAll({ where: { invitedUsername: req.params.username, status: "pending" }, order: [["createdAt", "DESC"]] });
    // Backfill Discord-style DM invite cards for older pending invites
    for (const inv of invites) {
      try {
        const key = dmKey(inv.invitedBy, inv.invitedUsername);
        let thread = await DirectMessage.findOne({ where: { dmKey: key } });
        if (!thread) {
          thread = await DirectMessage.create({ user1: inv.invitedBy, user2: inv.invitedUsername, dmKey: key, isGroup: false });
        }
        const marker = `[IRIS_INVITE]{"inviteId":${inv.id}`;
        const existingMsg = await Message.findOne({
          where: {
            dmKey: key,
            message: { [Op.like]: marker + "%" }
          }
        });
        if (!existingMsg) {
          const srv = await ChatServer.findByPk(inv.serverId);
          const payload = {
            inviteId: inv.id,
            serverId: inv.serverId,
            serverName: inv.serverName,
            iconUrl: srv?.iconUrl || null,
            invitedBy: inv.invitedBy
          };
          await Message.create({
            dmKey: key,
            username: inv.invitedBy,
            message: `[IRIS_INVITE]${JSON.stringify(payload)}`
          });
        }
      } catch (_) {}
    }
    res.json(invites);
  } catch { res.status(500).json({ error: "Failed to load invites" }); }
});

app.post("/accept-invite", async (req, res) => {
  try {
    const { inviteId, username } = req.body;
    const invite = await Invite.findByPk(inviteId);
    if (!invite) return res.status(404).json({ error: "Invite not found" });
    if (invite.invitedUsername !== username) return res.status(403).json({ error: "Not your invite" });
    if (invite.status !== "pending") return res.status(400).json({ error: "Invite is no longer pending" });
    const banned = await Ban.findOne({ where: { serverId: String(invite.serverId), username } });
    if (banned) return res.status(403).json({ error: "You are banned from this server" });
    const existing = await ServerMember.findOne({ where: { serverId: invite.serverId, username } });
    if (!existing) await ServerMember.create({ serverId: invite.serverId, username, role: "member" });
    invite.status = "accepted";
    await invite.save();
    await emitServerMembers(invite.serverId);
    io.to(`user_${username}`).emit("server_invite_resolved", { inviteId: invite.id, status: "accepted", serverId: invite.serverId });
    if (invite.invitedBy) {
      io.to(`user_${invite.invitedBy}`).emit("server_invite_resolved", { inviteId: invite.id, status: "accepted", serverId: invite.serverId });
    }
    res.json({ message: "Joined server", serverId: invite.serverId, serverName: invite.serverName });
  } catch { res.status(500).json({ error: "Failed to accept invite" }); }
});

app.post("/decline-invite", async (req, res) => {
  try {
    const { inviteId, username } = req.body;
    const invite = await Invite.findByPk(inviteId);
    if (!invite) return res.status(404).json({ error: "Invite not found" });
    if (invite.invitedUsername !== username) return res.status(403).json({ error: "Not your invite" });
    if (invite.status !== "pending") return res.status(400).json({ error: "Invite is no longer pending" });
    invite.status = "declined";
    await invite.save();
    io.to(`user_${username}`).emit("server_invite_resolved", { inviteId: invite.id, status: "declined" });
    if (invite.invitedBy) {
      io.to(`user_${invite.invitedBy}`).emit("server_invite_resolved", { inviteId: invite.id, status: "declined" });
    }
    res.json({ message: "Invite declined" });
  } catch { res.status(500).json({ error: "Failed to decline invite" }); }
});

app.get("/server-members/:serverId/:username", async (req, res) => {
  try {
    const { serverId, username } = req.params;
    const myMembership = await ServerMember.findOne({ where: { serverId, username } });
    if (!myMembership) return res.status(403).json({ error: "Not a member" });
    const members = await ServerMember.findAll({ where: { serverId }, order: [["role", "ASC"], ["username", "ASC"]] });
    const users = await User.findAll({ where: { username: members.map(m => m.username) } });
    const userMap = Object.fromEntries(users.map(u => [u.username, u]));
    const roles = await ServerRole.findAll({ where: { serverId } });
    const roleMap = Object.fromEntries(roles.map(r => [r.id, r]));
    const result = members.map((m) => ({
      id: m.id, username: m.username, role: m.role,
      customRoleId: m.customRoleId || null,
      customRole: m.customRoleId ? roleMap[m.customRoleId] || null : null,
      online: onlineUsers.has(m.username),
      status: userStatuses.get(m.username) || (onlineUsers.has(m.username) ? "online" : "offline"),
      ...publicProfile(userMap[m.username]),
    }));
    res.json({ myRole: myMembership.role, members: result });
  } catch { res.status(500).json({ error: "Failed to load members" }); }
});

app.post("/change-role", async (req, res) => {
  try {
    const { serverId, memberId, newRole, changedBy } = req.body;
    const changer = await ServerMember.findOne({ where: { serverId, username: changedBy } });
    if (!changer || changer.role !== "owner") return res.status(403).json({ error: "Only owner can change roles" });
    const member = await ServerMember.findByPk(memberId);
    if (!member || String(member.serverId) !== String(serverId)) return res.status(404).json({ error: "Member not found" });
    if (member.role === "owner") return res.status(400).json({ error: "Cannot change owner role" });
    if (!["admin", "member"].includes(newRole)) return res.status(400).json({ error: "Invalid role" });
    member.role = newRole;
    await member.save();
    await emitServerMembers(serverId);
    res.json({ message: "Role updated" });
  } catch { res.status(500).json({ error: "Failed to change role" }); }
});

app.post("/delete-server", async (req, res) => {
  try {
    const { serverId, username } = req.body;
    const serverRecord = await ChatServer.findByPk(serverId);
    if (!serverRecord) return res.status(404).json({ error: "Server not found" });
    if (serverRecord.ownerUsername !== username) return res.status(403).json({ error: "Only the server creator can delete it" });
    await Message.destroy({ where: { serverId } });
    await Invite.destroy({ where: { serverId } });
    await ServerMember.destroy({ where: { serverId } });
    await Channel.destroy({ where: { serverId } });
    await Ban.destroy({ where: { serverId: String(serverId) } });
    await ServerRole.destroy({ where: { serverId } });
    await ChatServer.destroy({ where: { id: serverId } });
    res.json({ message: "Server deleted" });
  } catch { res.status(500).json({ error: "Failed to delete server" }); }
});

// --- Custom Roles ---

app.get("/server-roles/:serverId", async (req, res) => {
  try {
    const roles = await ServerRole.findAll({
      where: { serverId: req.params.serverId },
      order: [["position", "DESC"], ["name", "ASC"]]
    });
    res.json(roles);
  } catch { res.status(500).json({ error: "Failed to load roles" }); }
});

app.post("/create-role", async (req, res) => {
  try {
    const { serverId, name, color, createdBy, hoist, canManageChannels, canKickMembers, canBanMembers, canInviteMembers, canPinMessages, canManageRoles } = req.body;
    if (!await hasPerm(serverId, createdBy, "canManageRoles"))
      return res.status(403).json({ error: "No permission to manage roles" });
    const maxPos = await ServerRole.max("position", { where: { serverId } });
    const role = await ServerRole.create({
      serverId, name: name.trim(), color: color || "#5865f2",
      hoist: !!hoist,
      position: (maxPos || 0) + 1,
      canManageChannels: !!canManageChannels, canKickMembers: !!canKickMembers, canBanMembers: !!canBanMembers,
      canInviteMembers: canInviteMembers !== false, canPinMessages: !!canPinMessages, canManageRoles: !!canManageRoles
    });
    await emitServerMembers(serverId);
    res.json({ message: "Role created", role });
  } catch { res.status(500).json({ error: "Failed to create role" }); }
});

app.post("/update-role", async (req, res) => {
  try {
    const { roleId, name, color, updatedBy, hoist, canManageChannels, canKickMembers, canBanMembers, canInviteMembers, canPinMessages, canManageRoles } = req.body;
    const role = await ServerRole.findByPk(roleId);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (!await hasPerm(role.serverId, updatedBy, "canManageRoles")) return res.status(403).json({ error: "No permission" });
    Object.assign(role, {
      name: name.trim(), color, hoist: !!hoist,
      canManageChannels: !!canManageChannels, canKickMembers: !!canKickMembers, canBanMembers: !!canBanMembers,
      canInviteMembers: canInviteMembers !== false, canPinMessages: !!canPinMessages, canManageRoles: !!canManageRoles
    });
    await role.save();
    await emitServerMembers(role.serverId);
    res.json({ message: "Role updated", role });
  } catch { res.status(500).json({ error: "Failed to update role" }); }
});

app.post("/delete-role", async (req, res) => {
  try {
    const { roleId, deletedBy } = req.body;
    const role = await ServerRole.findByPk(roleId);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (!await hasPerm(role.serverId, deletedBy, "canManageRoles")) return res.status(403).json({ error: "No permission" });
    // Unassign role from all members
    await ServerMember.update({ customRoleId: null }, { where: { serverId: role.serverId, customRoleId: roleId } });
    await role.destroy();
    await emitServerMembers(role.serverId);
    res.json({ message: "Role deleted" });
  } catch { res.status(500).json({ error: "Failed to delete role" }); }
});

app.post("/reorder-roles", async (req, res) => {
  try {
    const { serverId, roleIds, updatedBy } = req.body;
    if (!Array.isArray(roleIds) || !serverId) return res.status(400).json({ error: "Missing data" });
    if (!await hasPerm(serverId, updatedBy, "canManageRoles")) return res.status(403).json({ error: "No permission" });
    // roleIds[0] = highest position
    for (let i = 0; i < roleIds.length; i++) {
      await ServerRole.update(
        { position: roleIds.length - i },
        { where: { id: roleIds[i], serverId } }
      );
    }
    await emitServerMembers(serverId);
    res.json({ message: "Roles reordered" });
  } catch { res.status(500).json({ error: "Failed to reorder roles" }); }
});

app.post("/assign-role", async (req, res) => {
  try {
    const { serverId, targetUsername, roleId, assignedBy } = req.body;
    if (!await hasPerm(serverId, assignedBy, "canManageRoles")) return res.status(403).json({ error: "No permission" });
    const member = await ServerMember.findOne({ where: { serverId, username: targetUsername } });
    if (!member) return res.status(404).json({ error: "Member not found" });
    member.customRoleId = roleId || null;
    await member.save();
    await emitServerMembers(serverId);
    res.json({ message: "Role assigned" });
  } catch { res.status(500).json({ error: "Failed to assign role" }); }
});

app.get("/dm-threads/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const pairwise = await DirectMessage.findAll({
      where: {
        [Op.and]: [
          { [Op.or]: [{ isGroup: false }, { isGroup: null }] },
          { [Op.or]: [{ user1: username }, { user2: username }] }
        ]
      }
    });
    const groups = await DirectMessage.findAll({ where: { isGroup: true } });
    const myGroups = groups.filter((t) => parseThreadMembers(t).includes(username));
    const threads = [...pairwise, ...myGroups].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const result = await Promise.all(threads.map(async (t) => {
      const last = await Message.findOne({ where: { dmKey: t.dmKey }, order: [["createdAt", "DESC"]] });
      const members = parseThreadMembers(t);
      const others = members.filter((m) => m !== username);
      const other = t.isGroup ? null : (others[0] || null);
      const isOnline = t.isGroup
        ? others.some((m) => onlineUsers.has(m))
        : !!(other && onlineUsers.has(other));
      return {
        ...t.toJSON(),
        members,
        displayName: t.isGroup ? (t.name || others.join(", ") || "Group") : other,
        lastMessage: last?.message || null,
        lastMessageBy: last?.username || null,
        isOnline
      };
    }));
    res.json(result);
  } catch { res.status(500).json({ error: "Failed to load DM threads" }); }
});

app.post("/open-dm", async (req, res) => {
  try {
    const { username, targetUsername } = req.body;
    if (!username || !targetUsername) return res.status(400).json({ error: "Missing data" });
    const target = await User.findOne({ where: { username: targetUsername } });
    if (!target) return res.status(404).json({ error: "User not found" });
    const key = dmKey(username, targetUsername);
    let thread = await DirectMessage.findOne({ where: { dmKey: key } });
    if (!thread) thread = await DirectMessage.create({ user1: username, user2: targetUsername, dmKey: key, isGroup: false });
    res.json({ thread, targetAvatarColor: target.avatarColor, targetBio: target.bio });
  } catch { res.status(500).json({ error: "Failed to open DM" }); }
});

app.post("/group-dm", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const name = String(req.body.name || "").trim().slice(0, 64);
    let members = Array.isArray(req.body.members) ? req.body.members.map((m) => String(m || "").trim()).filter(Boolean) : [];
    if (!username) return res.status(400).json({ error: "Missing username" });
    members = [...new Set(members.filter((m) => m.toLowerCase() !== username.toLowerCase()))];
    if (members.length < 1) return res.status(400).json({ error: "Add at least one other person" });
    if (members.length > 9) return res.status(400).json({ error: "Group DMs are limited to 10 people" });

    const resolved = [];
    for (const m of members) {
      const u = await User.findOne({
        where: sequelize.where(sequelize.fn("lower", sequelize.col("username")), m.toLowerCase())
      });
      if (!u) return res.status(404).json({ error: `User not found: ${m}` });
      resolved.push(u.username);
    }
    const all = [...new Set([username, ...resolved])].sort((a, b) => a.localeCompare(b));
    const key = "g:" + crypto.randomBytes(8).toString("hex");
    const display = name || all.filter((m) => m !== username).join(", ");
    const thread = await DirectMessage.create({
      user1: username,
      user2: "",
      dmKey: key,
      isGroup: true,
      name: display,
      members: JSON.stringify(all)
    });
    const preview = { type: "group_dm", dmKey: key, name: display, by: username, members: all };
    for (const m of all) {
      if (m === username) continue;
      io.to(`user_${m}`).emit("group_dm_created", preview);
    }
    res.json({ thread: { ...thread.toJSON(), members: all, displayName: display } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create group DM" });
  }
});

app.get("/dm-thread/:dmKey", async (req, res) => {
  try {
    const thread = await DirectMessage.findOne({ where: { dmKey: req.params.dmKey } });
    if (!thread) return res.status(404).json({ error: "Thread not found" });
    const members = parseThreadMembers(thread);
    res.json({ ...thread.toJSON(), members, displayName: thread.isGroup ? (thread.name || "Group") : null });
  } catch {
    res.status(500).json({ error: "Failed to load thread" });
  }
});

app.post("/friend-request", async (req, res) => {
  try {
    const from = String(req.body.from || "").trim();
    const toRaw = String(req.body.to || "").trim();
    if (!from || !toRaw) return res.status(400).json({ error: "Missing data" });
    if (from.toLowerCase() === toRaw.toLowerCase()) return res.status(400).json({ error: "Cannot add yourself" });

    // Case-insensitive username match (YeetDaddy === yeetdaddy)
    const toUser = await User.findOne({
      where: sequelize.where(sequelize.fn("lower", sequelize.col("username")), toRaw.toLowerCase())
    });
    if (!toUser) return res.status(404).json({ error: "User not found" });
    const to = toUser.username;

    const existing = await FriendRequest.findOne({
      where: {
        [Op.or]: [
          { from, to },
          { from: to, to: from }
        ]
      }
    });
    if (existing) {
      if (existing.status === "accepted") return res.status(400).json({ error: "Already friends" });
      if (existing.status === "pending") return res.status(400).json({ error: "Request already pending" });
    }

    const created = await FriendRequest.create({ from, to, status: "pending" });
    // Notify by socket id AND user room (more reliable over tunnels)
    const targetSocketId = onlineUsers.get(to);
    if (targetSocketId) io.to(targetSocketId).emit("friend_request_received", { from, id: created.id });
    io.to(`user_${to}`).emit("friend_request_received", { from, id: created.id });
    res.json({ message: "Friend request sent", to });
  } catch (e) {
    console.error("friend-request error:", e);
    res.status(500).json({ error: "Failed to send request" });
  }
});

app.get("/friend-requests/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const pending = await FriendRequest.findAll({ where: { to: username, status: "pending" }, order: [["createdAt", "DESC"]] });
    res.json(pending);
  } catch { res.status(500).json({ error: "Failed to load requests" }); }
});

app.post("/friend-request/respond", async (req, res) => {
  try {
    const { requestId, username, action } = req.body;
    const req2 = await FriendRequest.findByPk(requestId);
    if (!req2) return res.status(404).json({ error: "Request not found" });
    if (req2.to !== username) return res.status(403).json({ error: "Not your request" });
    req2.status = action === "accept" ? "accepted" : "declined";
    await req2.save();
    if (action === "accept") {
      const senderSocketId = onlineUsers.get(req2.from);
      if (senderSocketId) io.to(senderSocketId).emit("friend_request_accepted", { by: username });
    }
    res.json({ message: action === "accept" ? "Friend added" : "Request declined" });
  } catch { res.status(500).json({ error: "Failed to respond" }); }
});

app.get("/friends/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const accepted = await FriendRequest.findAll({ where: { status: "accepted", [Op.or]: [{ from: username }, { to: username }] } });
    const friendNames = accepted.map(r => r.from === username ? r.to : r.from);
    const users = await User.findAll({ where: { username: friendNames } });
    const result = users.map(u => ({
      username: u.username,
      displayName: u.displayName || u.username,
      avatarColor: u.avatarColor,
      avatarUrl: u.avatarUrl || null,
      bio: u.bio,
      online: onlineUsers.has(u.username)
    }));
    res.json(result);
  } catch { res.status(500).json({ error: "Failed to load friends" }); }
});

// --- Feature 5: Pinned Messages ---

app.post("/pin-message", async (req, res) => {
  try {
    const { messageId, username, serverId } = req.body;
    const member = await ServerMember.findOne({ where: { serverId, username } });
    if (!member || !["owner", "admin"].includes(member.role)) return res.status(403).json({ error: "No permission" });
    const msg = await Message.findByPk(messageId);
    if (!msg) return res.status(404).json({ error: "Message not found" });
    msg.pinned = true;
    await msg.save();
    res.json({ message: "Pinned" });
  } catch { res.status(500).json({ error: "Failed to pin message" }); }
});

app.post("/unpin-message", async (req, res) => {
  try {
    const { messageId, username, serverId } = req.body;
    const member = await ServerMember.findOne({ where: { serverId, username } });
    if (!member || !["owner", "admin"].includes(member.role)) return res.status(403).json({ error: "No permission" });
    const msg = await Message.findByPk(messageId);
    if (!msg) return res.status(404).json({ error: "Message not found" });
    msg.pinned = false;
    await msg.save();
    res.json({ message: "Unpinned" });
  } catch { res.status(500).json({ error: "Failed to unpin message" }); }
});

app.get("/pinned-messages/:channelId", async (req, res) => {
  try {
    const messages = await Message.findAll({ where: { channelId: req.params.channelId, pinned: true }, order: [["createdAt", "DESC"]] });
    res.json(messages);
  } catch { res.status(500).json({ error: "Failed to load pinned messages" }); }
});

// --- Feature 6: Kick and Ban ---

app.post("/kick-member", async (req, res) => {
  try {
    const { serverId, targetUsername, kickedBy } = req.body;
    const kicker = await ServerMember.findOne({ where: { serverId, username: kickedBy } });
    if (!kicker || !["owner", "admin"].includes(kicker.role)) return res.status(403).json({ error: "No permission" });
    const target = await ServerMember.findOne({ where: { serverId, username: targetUsername } });
    if (!target) return res.status(404).json({ error: "Member not found" });
    if (target.role === "owner") return res.status(403).json({ error: "Cannot kick owner" });
    await target.destroy();
    const targetSocketId = onlineUsers.get(targetUsername);
    if (targetSocketId) io.to(targetSocketId).emit("kicked", { serverId });
    await emitServerMembers(serverId);
    await logAudit(serverId, "kick", kickedBy, targetUsername);
    res.json({ message: "Kicked" });
  } catch { res.status(500).json({ error: "Failed to kick member" }); }
});

app.post("/leave-server", async (req, res) => {
  try {
    const { serverId, username } = req.body;
    if (!serverId || !username) return res.status(400).json({ error: "Missing fields" });
    const membership = await ServerMember.findOne({ where: { serverId, username } });
    if (!membership) return res.status(404).json({ error: "Not a member" });
    if (membership.role === "owner") return res.status(403).json({ error: "Owner cannot leave — delete the server or transfer ownership" });
    await membership.destroy();
    await emitServerMembers(serverId);
    await logAudit(serverId, "leave", username, username);
    res.json({ message: "Left server" });
  } catch { res.status(500).json({ error: "Failed to leave server" }); }
});

app.post("/ban-member", async (req, res) => {
  try {
    const { serverId, targetUsername, bannedBy } = req.body;
    const banner = await ServerMember.findOne({ where: { serverId, username: bannedBy } });
    if (!banner || !["owner", "admin"].includes(banner.role)) return res.status(403).json({ error: "No permission" });
    const target = await ServerMember.findOne({ where: { serverId, username: targetUsername } });
    if (!target) return res.status(404).json({ error: "Member not found" });
    if (target.role === "owner") return res.status(403).json({ error: "Cannot ban owner" });
    await target.destroy();
    const existingBan = await Ban.findOne({ where: { serverId: String(serverId), username: targetUsername } });
    if (!existingBan) await Ban.create({ serverId: String(serverId), username: targetUsername });
    const targetSocketId = onlineUsers.get(targetUsername);
    if (targetSocketId) io.to(targetSocketId).emit("banned", { serverId });
    await emitServerMembers(serverId);
    await logAudit(serverId, "ban", bannedBy, targetUsername);
    res.json({ message: "Banned" });
  } catch { res.status(500).json({ error: "Failed to ban member" }); }
});

app.get("/bans/:serverId", async (req, res) => {
  try {
    const bans = await Ban.findAll({ where: { serverId: req.params.serverId } });
    res.json(bans);
  } catch { res.status(500).json({ error: "Failed to load bans" }); }
});

app.post("/unban-member", async (req, res) => {
  try {
    const { serverId, targetUsername, unbannedBy } = req.body;
    const serverRecord = await ChatServer.findByPk(serverId);
    if (!serverRecord || serverRecord.ownerUsername !== unbannedBy) return res.status(403).json({ error: "Only owner can unban" });
    await Ban.destroy({ where: { serverId: String(serverId), username: targetUsername } });
    res.json({ message: "Unbanned" });
  } catch { res.status(500).json({ error: "Failed to unban member" }); }
});

// --- Feature 7: Link Preview ---

function fetchUrl(targetUrl, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many redirects"));
    const mod = targetUrl.startsWith("https") ? https : http;
    const options = { headers: { "User-Agent": "Mozilla/5.0 (compatible; DiscordBot/1.0)" } };
    const req = mod.get(targetUrl, options, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        return resolve(fetchUrl(r.headers.location, redirects + 1));
      }
      let body = "";
      r.on("data", d => { body += d; if (body.length > 300000) r.destroy(); });
      r.on("end", () => resolve(body));
      r.on("error", reject);
    });
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.on("error", reject);
  });
}

app.get("/link-preview", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.json({});
  try {
    const body = await fetchUrl(url);
    const getOg = (prop) => {
      const m = body.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"))
        || body.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, "i"));
      return m ? m[1] : null;
    };
    const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = getOg("og:title") || (titleMatch ? titleMatch[1].trim() : null);
    const description = getOg("og:description");
    const image = getOg("og:image");
    if (!title) return res.json({});
    res.json({ title, description, image, url });
  } catch {
    res.json({});
  }
});

// --- Feature 8: Message Search ---

app.get("/search-messages", async (req, res) => {
  try {
    const { serverId, query, author, channelId } = req.query;
    if (!serverId || !query) return res.status(400).json({ error: "Missing params" });
    const where = {
      serverId,
      message: { [Op.like]: `%${query}%` },
    };
    if (author) where.username = { [Op.like]: String(author) }; // SQLite LIKE is case-insensitive for ASCII
    if (channelId) where.channelId = channelId;
    const messages = await Message.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: 80
    });
    const channelIds = [...new Set(messages.filter(m => m.channelId).map(m => m.channelId))];
    const chans = channelIds.length ? await Channel.findAll({ where: { id: { [Op.in]: channelIds } } }) : [];
    const chanMap = Object.fromEntries(chans.map(c => [c.id, c.name]));
    const result = messages.map(m => ({
      id: m.id, message: m.message, username: m.username,
      channelId: m.channelId, channelName: chanMap[m.channelId] || "unknown",
      createdAt: m.createdAt
    }));
    res.json(result);
  } catch { res.status(500).json({ error: "Search failed" }); }
});

// --- Feature 9: Server Icon Upload ---

app.post("/upload-server-icon", upload.single("file"), async (req, res) => {
  try {
    const { serverId, uploadedBy } = req.body;
    const serverRecord = await ChatServer.findByPk(serverId);
    if (!serverRecord) return res.status(404).json({ error: "Server not found" });
    if (serverRecord.ownerUsername !== uploadedBy) return res.status(403).json({ error: "Only owner can change icon" });
    serverRecord.iconUrl = "/uploads/" + req.file.filename;
    await serverRecord.save();
    res.json({ message: "Icon updated", iconUrl: serverRecord.iconUrl });
  } catch { res.status(500).json({ error: "Failed to upload icon" }); }
});

// --- Feature 10: Avatar Upload ---

app.post("/upload-avatar", upload.single("file"), async (req, res) => {
  try {
    const { username } = req.body;
    const user = await User.findOne({ where: { username } });
    if (!user) return res.status(404).json({ error: "User not found" });
    user.avatarUrl = "/uploads/" + req.file.filename;
    await user.save();
    res.json({ message: "Avatar updated", avatarUrl: user.avatarUrl });
  } catch { res.status(500).json({ error: "Failed to upload avatar" }); }
});

// Existing file upload
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({ url: `/uploads/${req.file.filename}`, originalName: req.file.originalname, mimetype: req.file.mimetype });
  } catch { res.status(500).json({ error: "Upload failed" }); }
});

// Clear multer / upload errors (e.g. file too large)
app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "File too large (max 50MB)" });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message || "Upload error" });
  }
  next(err);
});

// --- Reactions ---

app.get("/reactions/:messageId", async (req, res) => {
  try {
    const all = await Reaction.findAll({ where: { messageId: req.params.messageId } });
    const grouped = {};
    all.forEach(r => { if (!grouped[r.emoji]) grouped[r.emoji] = []; grouped[r.emoji].push(r.username); });
    res.json(grouped);
  } catch { res.status(500).json({}); }
});

// --- Audit Log ---

app.get("/audit-log/:serverId", async (req, res) => {
  try {
    const entries = await AuditLog.findAll({
      where: { serverId: req.params.serverId },
      order: [["createdAt", "DESC"]],
      limit: 100
    });
    res.json(entries);
  } catch { res.status(500).json([]); }
});

// --- Server Templates ---

const SERVER_TEMPLATES = {
  gaming: {
    channels: [
      { name: "general",       type: "text"  },
      { name: "announcements", type: "text"  },
      { name: "lfg",           type: "text"  },
      { name: "clips",         type: "text"  },
      { name: "General Voice", type: "voice" },
      { name: "Gaming Voice",  type: "voice" },
    ]
  },
  community: {
    channels: [
      { name: "welcome",       type: "text"  },
      { name: "announcements", type: "text"  },
      { name: "general",       type: "text"  },
      { name: "media",         type: "text"  },
      { name: "off-topic",     type: "text"  },
      { name: "Lounge",        type: "voice" },
    ]
  },
  study: {
    channels: [
      { name: "general",       type: "text"  },
      { name: "resources",     type: "text"  },
      { name: "questions",     type: "text"  },
      { name: "Study Room 1",  type: "voice" },
      { name: "Study Room 2",  type: "voice" },
    ]
  },
};

app.post("/create-server", async (req, res) => {
  try {
    const { serverName, username, template } = req.body;
    if (!serverName || !username) return res.status(400).json({ error: "Missing data" });
    const newServer = await ChatServer.create({ name: serverName.trim(), ownerUsername: username });
    await ServerMember.create({ serverId: newServer.id, username, role: "owner" });
    const textCat = await ChannelCategory.create({ serverId: newServer.id, name: "Text Channels", position: 0 });
    const voiceCat = await ChannelCategory.create({ serverId: newServer.id, name: "Voice Channels", position: 1 });
    const tpl = SERVER_TEMPLATES[template];
    let textPos = 0;
    let voicePos = 0;
    const seed = tpl
      ? tpl.channels
      : [{ name: "general", type: "text" }, { name: "General Voice", type: "voice" }];
    for (const ch of seed) {
      const isVoice = ch.type === "voice";
      await Channel.create({
        serverId: newServer.id,
        name: ch.name,
        type: ch.type,
        categoryId: isVoice ? voiceCat.id : textCat.id,
        position: isVoice ? voicePos++ : textPos++,
      });
    }
    res.json({ message: "Server created", server: newServer });
  } catch { res.status(500).json({ error: "Failed to create server" }); }
});

// --- Auth Middleware ---

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded.username;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// --- Invites ---

app.post("/create-invite", auth, async (req, res) => {
  const { serverId } = req.body;
  const member = await ServerMember.findOne({ where: { serverId, username: req.user } });
  if (!member) return res.status(403).json({ error: "Not a member" });
  const code = Math.random().toString(36).slice(2, 9).toUpperCase();
  const invite = await InviteLink.create({ code, serverId, createdBy: req.user });
  res.json({ code: invite.code });
});

app.get("/invite/:code", async (req, res) => {
  const invite = await InviteLink.findOne({ where: { code: req.params.code } });
  if (!invite) return res.status(404).json({ error: "Invalid invite" });
  const srv = await ChatServer.findByPk(invite.serverId);
  const memberCount = await ServerMember.count({ where: { serverId: invite.serverId } });
  res.json({ serverName: srv ? srv.name : "Unknown", serverId: invite.serverId, memberCount, createdBy: invite.createdBy, uses: invite.uses });
});

app.post("/join-invite", auth, async (req, res) => {
  const { code } = req.body;
  const invite = await InviteLink.findOne({ where: { code } });
  if (!invite) return res.status(404).json({ error: "Invalid invite code" });
  const existing = await ServerMember.findOne({ where: { serverId: invite.serverId, username: req.user } });
  if (existing) return res.json({ serverId: invite.serverId, alreadyMember: true });
  await ServerMember.create({ serverId: invite.serverId, username: req.user, role: "member" });
  await invite.increment("uses");
  res.json({ serverId: invite.serverId, joined: true });
});

// --- Block ---

app.post("/block", auth, async (req, res) => {
  const { target } = req.body;
  const existing = await Block.findOne({ where: { blocker: req.user, blocked: target } });
  if (!existing) await Block.create({ blocker: req.user, blocked: target });
  res.json({ ok: true });
});

app.post("/unblock", auth, async (req, res) => {
  await Block.destroy({ where: { blocker: req.user, blocked: req.body.target } });
  res.json({ ok: true });
});

app.get("/blocks/:username", async (req, res) => {
  const blocks = await Block.findAll({ where: { blocker: req.params.username } });
  res.json(blocks.map(b => b.blocked));
});

// --- Polls ---

app.post("/poll/create", auth, async (req, res) => {
  const { channelId, dmKey, serverId, question, options } = req.body;
  const poll = await Poll.create({ channelId, dmKey, serverId, username: req.user, question, options: JSON.stringify(options) });
  res.json({ id: poll.id, question, options, username: req.user, votes: [] });
});

app.post("/poll/vote", auth, async (req, res) => {
  const { pollId, optionIdx } = req.body;
  await PollVote.destroy({ where: { pollId, username: req.user } });
  await PollVote.create({ pollId, username: req.user, optionIdx });
  const votes = await PollVote.findAll({ where: { pollId } });
  res.json({ votes: votes.map(v => ({ username: v.username, optionIdx: v.optionIdx })) });
});

app.get("/poll/:id", async (req, res) => {
  const poll = await Poll.findByPk(req.params.id);
  if (!poll) return res.status(404).json({ error: "Not found" });
  const votes = await PollVote.findAll({ where: { pollId: poll.id } });
  res.json({ ...poll.toJSON(), options: JSON.parse(poll.options), votes: votes.map(v => ({ username: v.username, optionIdx: v.optionIdx })) });
});

// --- Custom Emoji ---

app.post("/emoji/upload", auth, upload.single("file"), async (req, res) => {
  const { serverId, name } = req.body;
  if (!req.file) return res.status(400).json({ error: "No file" });
  const url = `/uploads/${req.file.filename}`;
  const emoji = await CustomEmoji.create({ serverId, name, url, addedBy: req.user });
  res.json({ id: emoji.id, name, url });
});

app.get("/emoji/:serverId", async (req, res) => {
  const emojis = await CustomEmoji.findAll({ where: { serverId: req.params.serverId } });
  res.json(emojis);
});

app.delete("/emoji/:id", auth, async (req, res) => {
  await CustomEmoji.destroy({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// --- Read Receipts ---

app.post("/read-receipt", auth, async (req, res) => {
  const { dmKey, lastReadId } = req.body;
  const [receipt] = await ReadReceipt.findOrCreate({ where: { dmKey, username: req.user }, defaults: { lastReadId } });
  if (receipt.lastReadId < lastReadId) await receipt.update({ lastReadId });
  res.json({ ok: true });
});

app.get("/read-receipt/:dmKey", auth, async (req, res) => {
  const receipts = await ReadReceipt.findAll({ where: { dmKey: req.params.dmKey } });
  res.json(receipts);
});

// --- Custom Status (stored in nowPlaying column) ---

app.post("/now-playing", auth, async (req, res) => {
  const status = String(req.body.customStatus ?? req.body.nowPlaying ?? "").trim().slice(0, 128);
  await User.update({ nowPlaying: status || null }, { where: { username: req.user } });
  io.emit("now_playing_update", { username: req.user, nowPlaying: status, customStatus: status });
  const memberships = await ServerMember.findAll({ where: { username: req.user } });
  for (const m of memberships) await emitServerMembers(m.serverId);
  res.json({ ok: true, customStatus: status });
});

app.post("/custom-status", auth, async (req, res) => {
  const status = String(req.body.customStatus ?? req.body.nowPlaying ?? "").trim().slice(0, 128);
  await User.update({ nowPlaying: status || null }, { where: { username: req.user } });
  io.emit("now_playing_update", { username: req.user, nowPlaying: status, customStatus: status });
  const memberships = await ServerMember.findAll({ where: { username: req.user } });
  for (const m of memberships) await emitServerMembers(m.serverId);
  res.json({ ok: true, customStatus: status });
});

// --- Server Discovery ---

app.get("/discover", async (req, res) => {
  const servers = await ChatServer.findAll({ where: { isPublic: true } });
  const result = await Promise.all(servers.map(async s => {
    const memberCount = await ServerMember.count({ where: { serverId: s.id } });
    return { id: s.id, name: s.name, iconUrl: s.iconUrl, description: s.description, joinType: s.joinType, memberCount };
  }));
  res.json(result);
});

app.post("/server/update-visibility", auth, async (req, res) => {
  const { serverId, isPublic, joinType, description } = req.body;
  const member = await ServerMember.findOne({ where: { serverId, username: req.user } });
  if (!member || member.role !== "owner") return res.status(403).json({ error: "Not owner" });
  await ChatServer.update({ isPublic, joinType, description }, { where: { id: serverId } });
  res.json({ ok: true });
});

app.post("/server/apply", auth, async (req, res) => {
  const { serverId } = req.body;
  const srv = await ChatServer.findByPk(serverId);
  if (!srv) return res.status(404).json({ error: "Not found" });
  if (srv.joinType === "open") {
    const existing = await ServerMember.findOne({ where: { serverId, username: req.user } });
    if (!existing) await ServerMember.create({ serverId, username: req.user, role: "member" });
    return res.json({ joined: true });
  }
  // For invite/apply — send invite to owner
  await Invite.create({ serverId, serverName: srv.name, invitedUsername: req.user, invitedBy: req.user, status: "pending" });
  // Notify owner
  const owner = await ServerMember.findOne({ where: { serverId, role: "owner" } });
  if (owner) io.to(`user_${owner.username}`).emit("server_application", { serverId, serverName: srv.name, applicant: req.user });
  res.json({ applied: true });
});

const os = require("os");

let publicTunnel = null;
let tunnelUrl = null;
let tunnelStarting = false;
let tunnelError = null;
let tunnelStopRequested = false;

async function ensureCloudflared() {
  const { bin, install } = require("cloudflared");
  if (!fs.existsSync(bin)) {
    console.log("Installing cloudflared binary…");
    await install(bin);
  }
  return bin;
}

function publishTunnelUrl(url) {
  if (!url) return;
  tunnelUrl = url;
  writeHostUrlFile(url);
  try { io.emit("host_tunnel_url", { url }); } catch (_) {}
}

function scheduleTunnelRestart(reason) {
  if (tunnelStopRequested) return;
  console.warn("Tunnel ended:", reason || "unknown", "— restarting in 3s…");
  setTimeout(() => {
    if (tunnelStopRequested) return;
    startPublicTunnel().catch((e) => console.error("Tunnel restart failed:", e.message || e));
  }, 3000);
}

async function startNamedCloudflareTunnel(token) {
  const bin = await ensureCloudflared();
  const configuredUrl = (process.env.CLOUDFLARE_TUNNEL_URL || process.env.DISCORD_LITE_TUNNEL_URL || "").trim();
  const child = spawn(bin, ["tunnel", "--no-autoupdate", "run", "--token", token], {
    stdio: "ignore",
    windowsHide: true,
  });
  publicTunnel = {
    stop() { try { child.kill(); } catch (_) {} },
    close() { try { child.kill(); } catch (_) {} },
  };
  child.on("exit", () => {
    if (publicTunnel && publicTunnel.stop) {
      publicTunnel = null;
      tunnelUrl = null;
      scheduleTunnelRestart("named tunnel exit");
    }
  });
  if (configuredUrl) {
    publishTunnelUrl(configuredUrl.replace(/\/$/, ""));
    console.log("Named Cloudflare tunnel (stable URL):", tunnelUrl);
    return tunnelUrl;
  }
  console.warn("Named tunnel token set, but CLOUDFLARE_TUNNEL_URL is empty — set it to your https://hostname");
  return null;
}

async function startPublicTunnel() {
  if (tunnelUrl) return tunnelUrl;
  if (tunnelStarting) {
    for (let i = 0; i < 40 && tunnelStarting; i++) await new Promise((r) => setTimeout(r, 250));
    if (tunnelUrl) return tunnelUrl;
  }
  tunnelStarting = true;
  tunnelStopRequested = false;
  tunnelError = null;
  try {
    const namedToken = (process.env.CLOUDFLARE_TUNNEL_TOKEN || process.env.TUNNEL_TOKEN || "").trim();
    if (namedToken) {
      return await startNamedCloudflareTunnel(namedToken);
    }

    await ensureCloudflared();
    const { Tunnel } = require("cloudflared");
    publicTunnel = Tunnel.quick("http://127.0.0.1:3001");
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Tunnel timed out")), 90000);
      publicTunnel.once("url", (u) => {
        clearTimeout(timer);
        resolve(u);
      });
      publicTunnel.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      publicTunnel.once("exit", () => {
        publicTunnel = null;
        tunnelUrl = null;
        scheduleTunnelRestart("quick tunnel exit");
      });
    });
    publishTunnelUrl(url);
    console.log("Public tunnel (quick — changes on restart):", tunnelUrl);
    return tunnelUrl;
  } catch (err) {
    console.error("Cloudflare tunnel failed, trying localtunnel…", err.message || err);
    try {
      const localtunnel = require("localtunnel");
      const t = await localtunnel({ port: 3001 });
      publicTunnel = t;
      t.on("close", () => {
        if (publicTunnel === t) {
          publicTunnel = null;
          tunnelUrl = null;
          scheduleTunnelRestart("localtunnel close");
        }
      });
      publishTunnelUrl(t.url);
      console.log("Public tunnel (localtunnel):", tunnelUrl);
      return tunnelUrl;
    } catch (err2) {
      tunnelError = (err2 && err2.message) || (err && err.message) || "Tunnel failed";
      console.error("Tunnel failed:", tunnelError);
      throw err2;
    }
  } finally {
    tunnelStarting = false;
  }
}

function writeHostUrlFile(url) {
  if (!url) return;
  const named = !!(process.env.CLOUDFLARE_TUNNEL_TOKEN || process.env.TUNNEL_TOKEN);
  const body =
    "Iris — public host URL\r\n" +
    "================================\r\n" +
    "Share this with friends. They paste it as Server address.\r\n" +
    "\r\n" +
    url +
    "\r\n" +
    "\r\n" +
    (named
      ? "This is a named Cloudflare tunnel (stable URL across restarts).\r\n"
      : "Note: Cloudflare quick tunnels change after each host restart.\r\n" +
        "For a stable URL, set CLOUDFLARE_TUNNEL_TOKEN + CLOUDFLARE_TUNNEL_URL.\r\n" +
        "If the host PC reboots, open this file again and re-share the new link.\r\n") +
    "Updated: " + new Date().toISOString() + "\r\n";
  const targets = [];
  try {
    targets.push(path.join(DATA_DIR, "Iris-Host-URL.txt"));
  } catch (_) {}
  try {
    const desktop = path.join(os.homedir(), "Desktop");
    targets.push(path.join(desktop, "Iris-Host-URL.txt"));
  } catch (_) {}
  for (const file of targets) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body, "utf8");
      console.log("Host URL written to", file);
    } catch (e) {
      console.warn("Could not write host URL file:", file, e.message || e);
    }
  }
}

function stopPublicTunnel() {
  tunnelStopRequested = true;
  if (!publicTunnel) return;
  try {
    if (typeof publicTunnel.stop === "function") publicTunnel.stop();
    else if (typeof publicTunnel.close === "function") publicTunnel.close();
  } catch (_) {}
  publicTunnel = null;
  tunnelUrl = null;
  tunnelError = null;
}

app.get("/lan-info", (req, res) => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const family = net.family === "IPv4" || net.family === 4;
      if (family && !net.internal) ips.push({ name, address: net.address });
    }
  }
  res.json({
    port: 3001,
    ips,
    urls: ips.map((i) => `http://${i.address}:3001`),
    tunnelUrl,
    tunnelStarting,
    tunnelError
  });
});

app.get("/tunnel", (req, res) => {
  res.json({ url: tunnelUrl, starting: tunnelStarting, error: tunnelError });
});

app.post("/tunnel/start", async (req, res) => {
  try {
    const url = await startPublicTunnel();
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: tunnelError || e.message || "Failed to start tunnel" });
  }
});

app.post("/tunnel/stop", (req, res) => {
  stopPublicTunnel();
  res.json({ ok: true });
});

app.get("/health", (req, res) => res.json({ ok: true, tunnelUrl }));

// --- Tenor GIF proxy (v2) ---

function getTenorApiKey() {
  return (process.env.TENOR_API_KEY || process.env.DISCORD_LITE_TENOR_KEY || "").trim();
}

function normalizeTenorResults(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.map((item) => {
    const formats = item.media_formats || {};
    const preview =
      formats.tinygif?.url ||
      formats.nanogif?.url ||
      formats.tinygif_transparent?.url ||
      formats.gif?.url ||
      "";
    const url = formats.gif?.url || formats.mediumgif?.url || preview;
    if (!preview || !url) return null;
    return { preview, url, id: item.id, description: item.content_description || "" };
  }).filter(Boolean);
}

async function fetchTenor(pathname, query = {}) {
  const key = getTenorApiKey();
  if (!key) {
    const err = new Error("TENOR_API_KEY not configured");
    err.code = "NO_KEY";
    throw err;
  }
  const params = new URLSearchParams({
    key,
    client_key: "iris_chat",
    media_filter: "gif,tinygif",
    limit: String(query.limit || 21),
  });
  if (query.q) params.set("q", String(query.q));
  const url = `https://tenor.googleapis.com/v2/${pathname}?${params.toString()}`;
  const body = await fetchUrl(url);
  return JSON.parse(body);
}

app.get("/gifs/featured", async (req, res) => {
  try {
    if (!getTenorApiKey()) {
      return res.status(503).json({
        error: "GIF search needs a Tenor API key — set TENOR_API_KEY on the host",
        results: []
      });
    }
    const data = await fetchTenor("featured", { limit: req.query.limit || 21 });
    res.json({ results: normalizeTenorResults(data) });
  } catch (e) {
    if (e && e.code === "NO_KEY") {
      return res.status(503).json({
        error: "GIF search needs a Tenor API key — set TENOR_API_KEY on the host",
        results: []
      });
    }
    res.status(502).json({ error: "Could not load GIFs", results: [] });
  }
});

app.get("/gifs/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ results: [] });
    if (!getTenorApiKey()) {
      return res.status(503).json({
        error: "GIF search needs a Tenor API key — set TENOR_API_KEY on the host",
        results: []
      });
    }
    const data = await fetchTenor("search", { q, limit: req.query.limit || 21 });
    res.json({ results: normalizeTenorResults(data) });
  } catch (e) {
    if (e && e.code === "NO_KEY") {
      return res.status(503).json({
        error: "GIF search needs a Tenor API key — set TENOR_API_KEY on the host",
        results: []
      });
    }
    res.status(502).json({ error: "GIF search failed", results: [] });
  }
});

app.get("/ice-servers", (req, res) => {
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  // Optional custom TURN: DISCORD_LITE_TURN_URLS=turn:host:3478|user|pass;turns:host:443|user|pass
  const custom = (process.env.DISCORD_LITE_TURN_URLS || "").trim();
  if (custom) {
    for (const part of custom.split(";")) {
      const [urls, username, credential] = part.split("|").map((s) => (s || "").trim());
      if (urls) iceServers.push({ urls, username: username || undefined, credential: credential || undefined });
    }
  } else {
    // Public openrelay fallback (better NAT traversal for friends on different networks)
    iceServers.push(
      { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turns:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
    );
  }
  res.json({ iceServers });
});

// --- Start ---

let listening = false;

/** Snapshot database.sqlite before schema sync / startup (keeps last 14). */
function backupDatabaseOnStartup() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.log("No existing database yet — will create a new one at:");
      console.log(" ", DB_PATH);
      return;
    }
    const backupDir = path.join(DATA_DIR, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(backupDir, `database-${stamp}.sqlite`);
    fs.copyFileSync(DB_PATH, dest);
    console.log("DB backup saved:", dest);

    const keep = 14;
    const files = fs.readdirSync(backupDir)
      .filter((f) => f.startsWith("database-") && f.endsWith(".sqlite"))
      .map((f) => ({ f, t: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of files.slice(keep)) {
      try { fs.unlinkSync(path.join(backupDir, old.f)); } catch (_) {}
    }
  } catch (e) {
    console.warn("DB backup skipped:", e.message || e);
  }
}

function startServer() {
  if (listening) return Promise.resolve();
  console.log("----------------------------------------");
  console.log("Iris data folder:");
  console.log(" ", DATA_DIR);
  console.log("Database file:");
  console.log(" ", DB_PATH);
  console.log("----------------------------------------");
  backupDatabaseOnStartup();
  // Prefer sync without alter — SQLite alter often fails (Invites_backup UNIQUE errors).
  // New columns/tables are added with safe helpers below.
  const SCHEMA_VERSION = 7;
  const schemaMarker = path.join(DATA_DIR, ".schema-version");
  let doAlter = false;
  if (process.env.DISCORD_LITE_DB_ALTER === "1") doAlter = true;
  if (doAlter) console.log("DB schema sync: alter=true (forced)");
  else console.log("DB schema sync: alter=false (safe mode)");

  async function tableHasColumn(table, column) {
    const [rows] = await sequelize.query(`PRAGMA table_info(\`${table}\`)`);
    return (rows || []).some((r) => r.name === column);
  }

  async function safeAddColumn(table, column, sqlType) {
    if (await tableHasColumn(table, column)) return;
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${sqlType}`);
    console.log(`Added column ${table}.${column}`);
  }

  async function cleanupFailedAlterBackups() {
    const [tables] = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_backup'"
    );
    for (const t of tables || []) {
      try {
        await sequelize.query(`DROP TABLE IF EXISTS \`${t.name}\``);
        console.log("Dropped leftover", t.name);
      } catch (_) {}
    }
  }

  return sequelize.sync({ alter: doAlter }).then(async () => {
    console.log("Database synced");
    try {
      await cleanupFailedAlterBackups();
      await ChannelCategory.sync();
      await MessageThread.sync();
      await safeAddColumn("Channels", "categoryId", "INTEGER");
      await safeAddColumn("Channels", "position", "INTEGER NOT NULL DEFAULT 0");
      await safeAddColumn("Messages", "threadId", "INTEGER");
      const servers = await ChatServer.findAll({ attributes: ["id"] });
      for (const s of servers) await ensureServerCategories(s.id);
    } catch (e) {
      console.warn("Schema migration helpers:", e.message || e);
    }
    try { fs.writeFileSync(schemaMarker, String(SCHEMA_VERSION), "utf8"); } catch (_) {}
    return new Promise((resolve, reject) => {
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" || err.code === "EACCES") {
          console.log("Port 3001 busy — assuming server already running");
          listening = true;
          resolve();
          startPublicTunnel().catch(() => {});
        } else {
          reject(err);
        }
      });
      server.listen(3001, "0.0.0.0", () => {
        listening = true;
        console.log("Server running on port 3001 (LAN accessible)");
        resolve();
        // Public internet tunnel (Cloudflare) so friends can join from anywhere
        startPublicTunnel().catch(() => {});
      });
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Failed to start:", error);
    process.exit(1);
  });
}

module.exports = { startServer, app, server, io, startPublicTunnel, stopPublicTunnel };
