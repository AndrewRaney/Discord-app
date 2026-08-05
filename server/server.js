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
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

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

const SECRET = "secret123";

const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: DB_PATH,
  logging: false,
});

// ── Models ────────────────────────────────────────────────────────────────────

const User = sequelize.define("User", {
  username: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  avatarColor: { type: DataTypes.STRING, allowNull: false, defaultValue: "#5865f2" },
  bio: { type: DataTypes.TEXT, allowNull: true, defaultValue: "" },
  avatarUrl: { type: DataTypes.STRING, allowNull: true },
  nowPlaying: { type: DataTypes.STRING, allowNull: true },
});

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
});

const DirectMessage = sequelize.define("DirectMessage", {
  user1: { type: DataTypes.STRING, allowNull: false },
  user2: { type: DataTypes.STRING, allowNull: false },
  dmKey: { type: DataTypes.STRING, allowNull: false, unique: true },
});

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
  canManageChannels:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  canKickMembers:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  canBanMembers:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  canInviteMembers:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true  },
  canPinMessages:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  canManageRoles:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
});

// ── HTTP / Socket.io ──────────────────────────────────────────────────────────

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
    avatarColor: userMap[member.username]?.avatarColor || "#5865f2",
    bio: userMap[member.username]?.bio || "",
    avatarUrl: userMap[member.username]?.avatarUrl || null,
  }));
  io.to(`server_${serverId}`).emit("server_members", result);
}

async function emitVoiceState(channelId) {
  const key = String(channelId);
  const users = voiceRooms.get(key) || new Set();
  const muteMap = voiceMuteStates.get(key) || new Map();
  const usersWithState = Array.from(users).map(u => ({
    username: u,
    muted: muteMap.get(u)?.muted || false,
    deafened: muteMap.get(u)?.deafened || false,
  }));
  io.emit("voice_state", { channelId: key, users: usersWithState });
}

// ── Socket.io ─────────────────────────────────────────────────────────────────

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
    Array.from(socket.rooms).forEach((room) => { if (room !== socket.id && room.startsWith("channel_")) socket.leave(room); });
    socket.join(`channel_${channelId}`);
    const messages = await Message.findAll({ where: { channelId }, order: [["createdAt", "ASC"]] });
    socket.emit("load_messages", messages);
  });

  socket.on("join_dm", async ({ dmKey: key, username }) => {
    if (!key) return;
    Array.from(socket.rooms).forEach((room) => {
      if (room !== socket.id && room.startsWith("dm_")) socket.leave(room);
      if (room !== socket.id && room.startsWith("channel_")) socket.leave(room);
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
    const { channelId, dmKey: key, username, message, replyToId } = data;
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

    if (channelId) {
      const channel = await Channel.findByPk(channelId);
      if (!channel) return;
      const saved = await Message.create({ serverId: channel.serverId, channelId, username, message, replyToId: replyToId || null, replyPreview, replyAuthor });
      io.to(`channel_${channelId}`).emit("receive_message", saved);
    } else if (key) {
      const saved = await Message.create({ dmKey: key, username, message, replyToId: replyToId || null, replyPreview, replyAuthor });
      io.to(`dm_${key}`).emit("receive_message", saved);
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
    const key = String(channelId);
    if (!voiceRooms.has(key)) voiceRooms.set(key, new Set());
    voiceRooms.get(key).add(username);
    if (!voiceMuteStates.has(key)) voiceMuteStates.set(key, new Map());
    voiceMuteStates.get(key).set(username, { muted: false, deafened: false });
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
    voiceMuteStates.get(key).set(username, { muted, deafened });
    await emitVoiceState(channelId);
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

  // ── Reactions ────────────────────────────────────────────────────────────
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

  // ── User status ──────────────────────────────────────────────────────────
  socket.on("set_status", ({ username, status }) => {
    if (!["online","away","dnd","invisible"].includes(status)) return;
    userStatuses.set(username, status);
    // Broadcast to everyone (simplified: broadcast globally)
    io.emit("user_status_changed", { username, status: status === "invisible" ? "offline" : status });
  });

  // ── Voice speaking indicator ─────────────────────────────────────────────
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

// ── REST Routes ───────────────────────────────────────────────────────────────

app.get("/", (req, res) => res.send("Server is running 🚀"));

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
    res.json({ token, username, avatarColor: user.avatarColor, bio: user.bio, avatarUrl: user.avatarUrl || null });
  } catch { res.status(500).json({ error: "Login failed" }); }
});

app.post("/update-profile", async (req, res) => {
  try {
    const { username, avatarColor, bio } = req.body;
    const user = await User.findOne({ where: { username } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (avatarColor) user.avatarColor = avatarColor;
    if (bio !== undefined) user.bio = bio;
    await user.save();
    res.json({ message: "Profile updated", avatarColor: user.avatarColor, bio: user.bio });
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
    const channels = await Channel.findAll({ where: { serverId: req.params.serverId }, order: [["type", "ASC"], ["createdAt", "ASC"]] });
    res.json(channels);
  } catch { res.status(500).json({ error: "Failed to load channels" }); }
});

app.post("/create-channel", async (req, res) => {
  try {
    const { serverId, name, type, username } = req.body;
    if (!serverId || !name || !username) return res.status(400).json({ error: "Missing data" });
    const member = await ServerMember.findOne({ where: { serverId, username } });
    if (!member || !["owner", "admin"].includes(member.role)) return res.status(403).json({ error: "No permission" });
    const channel = await Channel.create({ serverId, name: name.trim(), type: type || "text" });
    res.json({ message: "Channel created", channel });
  } catch { res.status(500).json({ error: "Failed to create channel" }); }
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
    if (!inviterMembership || !["owner", "admin"].includes(inviterMembership.role)) return res.status(403).json({ error: "Only owner or admin can invite" });
    const invitedUser = await User.findOne({ where: { username: usernameToInvite } });
    if (!invitedUser) return res.status(404).json({ error: "User does not exist" });
    const existing = await ServerMember.findOne({ where: { serverId, username: usernameToInvite } });
    if (existing) return res.status(400).json({ error: "User is already a member" });
    const existingInvite = await Invite.findOne({ where: { serverId, invitedUsername: usernameToInvite, status: "pending" } });
    if (existingInvite) return res.status(400).json({ error: "Invite already pending" });
    await Invite.create({ serverId, serverName: serverRecord.name, invitedUsername: usernameToInvite, invitedBy, status: "pending" });
    res.json({ message: "Invite sent" });
  } catch { res.status(500).json({ error: "Failed to invite user" }); }
});

app.get("/invites/:username", async (req, res) => {
  try {
    const invites = await Invite.findAll({ where: { invitedUsername: req.params.username, status: "pending" }, order: [["createdAt", "DESC"]] });
    res.json(invites);
  } catch { res.status(500).json({ error: "Failed to load invites" }); }
});

app.post("/accept-invite", async (req, res) => {
  try {
    const { inviteId, username } = req.body;
    const invite = await Invite.findByPk(inviteId);
    if (!invite) return res.status(404).json({ error: "Invite not found" });
    if (invite.invitedUsername !== username) return res.status(403).json({ error: "Not your invite" });
    // Feature 6: check if banned
    const banned = await Ban.findOne({ where: { serverId: String(invite.serverId), username } });
    if (banned) return res.status(403).json({ error: "You are banned from this server" });
    const existing = await ServerMember.findOne({ where: { serverId: invite.serverId, username } });
    if (!existing) await ServerMember.create({ serverId: invite.serverId, username, role: "member" });
    invite.status = "accepted";
    await invite.save();
    await emitServerMembers(invite.serverId);
    res.json({ message: "Joined server" });
  } catch { res.status(500).json({ error: "Failed to accept invite" }); }
});

app.get("/server-members/:serverId/:username", async (req, res) => {
  try {
    const { serverId, username } = req.params;
    const myMembership = await ServerMember.findOne({ where: { serverId, username } });
    if (!myMembership) return res.status(403).json({ error: "Not a member" });
    const members = await ServerMember.findAll({ where: { serverId }, order: [["role", "ASC"], ["username", "ASC"]] });
    const users = await User.findAll({ where: { username: members.map(m => m.username) } });
    const userMap = Object.fromEntries(users.map(u => [u.username, u]));
    const result = members.map((m) => ({
      id: m.id, username: m.username, role: m.role,
      online: onlineUsers.has(m.username),
      avatarColor: userMap[m.username]?.avatarColor || "#5865f2",
      bio: userMap[m.username]?.bio || "",
      avatarUrl: userMap[m.username]?.avatarUrl || null,           // Feature 10
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

// ── Custom Roles ───────────────────────────────────────────────────────────────

app.get("/server-roles/:serverId", async (req, res) => {
  try {
    const roles = await ServerRole.findAll({ where: { serverId: req.params.serverId }, order: [["name", "ASC"]] });
    res.json(roles);
  } catch { res.status(500).json({ error: "Failed to load roles" }); }
});

app.post("/create-role", async (req, res) => {
  try {
    const { serverId, name, color, createdBy, canManageChannels, canKickMembers, canBanMembers, canInviteMembers, canPinMessages, canManageRoles } = req.body;
    if (!await hasPerm(serverId, createdBy, "canManageRoles"))
      return res.status(403).json({ error: "No permission to manage roles" });
    const role = await ServerRole.create({ serverId, name: name.trim(), color: color || "#5865f2", canManageChannels: !!canManageChannels, canKickMembers: !!canKickMembers, canBanMembers: !!canBanMembers, canInviteMembers: canInviteMembers !== false, canPinMessages: !!canPinMessages, canManageRoles: !!canManageRoles });
    await emitServerMembers(serverId);
    res.json({ message: "Role created", role });
  } catch { res.status(500).json({ error: "Failed to create role" }); }
});

app.post("/update-role", async (req, res) => {
  try {
    const { roleId, name, color, updatedBy, canManageChannels, canKickMembers, canBanMembers, canInviteMembers, canPinMessages, canManageRoles } = req.body;
    const role = await ServerRole.findByPk(roleId);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (!await hasPerm(role.serverId, updatedBy, "canManageRoles")) return res.status(403).json({ error: "No permission" });
    Object.assign(role, { name: name.trim(), color, canManageChannels: !!canManageChannels, canKickMembers: !!canKickMembers, canBanMembers: !!canBanMembers, canInviteMembers: canInviteMembers !== false, canPinMessages: !!canPinMessages, canManageRoles: !!canManageRoles });
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
    const threads = await DirectMessage.findAll({ where: { [Op.or]: [{ user1: username }, { user2: username }] }, order: [["updatedAt", "DESC"]] });
    const result = await Promise.all(threads.map(async t => {
      const last = await Message.findOne({ where: { dmKey: t.dmKey }, order: [["createdAt", "DESC"]] });
      const other = t.user1 === username ? t.user2 : t.user1;
      const isOnline = onlineUsers.has(other);
      return { ...t.toJSON(), lastMessage: last?.message || null, lastMessageBy: last?.username || null, isOnline };
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
    if (!thread) thread = await DirectMessage.create({ user1: username, user2: targetUsername, dmKey: key });
    res.json({ thread, targetAvatarColor: target.avatarColor, targetBio: target.bio });
  } catch { res.status(500).json({ error: "Failed to open DM" }); }
});

app.post("/friend-request", async (req, res) => {
  try {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: "Missing data" });
    if (from === to) return res.status(400).json({ error: "Cannot add yourself" });
    const toUser = await User.findOne({ where: { username: to } });
    if (!toUser) return res.status(404).json({ error: "User not found" });
    const existing = await FriendRequest.findOne({ where: { [Op.or]: [{ from, to }, { from: to, to: from }] } });
    if (existing) {
      if (existing.status === "accepted") return res.status(400).json({ error: "Already friends" });
      if (existing.status === "pending") return res.status(400).json({ error: "Request already pending" });
    }
    await FriendRequest.create({ from, to, status: "pending" });
    const targetSocketId = onlineUsers.get(to);
    if (targetSocketId) io.to(targetSocketId).emit("friend_request_received", { from });
    res.json({ message: "Friend request sent" });
  } catch { res.status(500).json({ error: "Failed to send request" }); }
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
    const result = users.map(u => ({ username: u.username, avatarColor: u.avatarColor, bio: u.bio, online: onlineUsers.has(u.username) }));
    res.json(result);
  } catch { res.status(500).json({ error: "Failed to load friends" }); }
});

// ── Feature 5: Pinned Messages ────────────────────────────────────────────────

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

// ── Feature 6: Kick and Ban ───────────────────────────────────────────────────

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

// ── Feature 7: Link Preview ───────────────────────────────────────────────────

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

// ── Feature 8: Message Search ─────────────────────────────────────────────────

app.get("/search-messages", async (req, res) => {
  try {
    const { serverId, query } = req.query;
    if (!serverId || !query) return res.status(400).json({ error: "Missing params" });
    const messages = await Message.findAll({
      where: { serverId, message: { [Op.like]: `%${query}%` } },
      order: [["createdAt", "DESC"]],
      limit: 50
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

// ── Feature 9: Server Icon Upload ────────────────────────────────────────────

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

// ── Feature 10: Avatar Upload ─────────────────────────────────────────────────

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

// ── Reactions ─────────────────────────────────────────────────────────────────

app.get("/reactions/:messageId", async (req, res) => {
  try {
    const all = await Reaction.findAll({ where: { messageId: req.params.messageId } });
    const grouped = {};
    all.forEach(r => { if (!grouped[r.emoji]) grouped[r.emoji] = []; grouped[r.emoji].push(r.username); });
    res.json(grouped);
  } catch { res.status(500).json({}); }
});

// ── Audit Log ─────────────────────────────────────────────────────────────────

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

// ── Server Templates ───────────────────────────────────────────────────────────

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
    const tpl = SERVER_TEMPLATES[template];
    if (tpl) {
      for (const ch of tpl.channels) await Channel.create({ serverId: newServer.id, name: ch.name, type: ch.type });
    } else {
      await Channel.create({ serverId: newServer.id, name: "general", type: "text" });
      await Channel.create({ serverId: newServer.id, name: "General Voice", type: "voice" });
    }
    res.json({ message: "Server created", server: newServer });
  } catch { res.status(500).json({ error: "Failed to create server" }); }
});

// ── Auth Middleware ───────────────────────────────────────────────────────────

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

// ── Invites ───────────────────────────────────────────────────────────────────

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

// ── Block ─────────────────────────────────────────────────────────────────────

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

// ── Polls ─────────────────────────────────────────────────────────────────────

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

// ── Custom Emoji ──────────────────────────────────────────────────────────────

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

// ── Read Receipts ─────────────────────────────────────────────────────────────

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

// ── Now Playing ───────────────────────────────────────────────────────────────

app.post("/now-playing", auth, async (req, res) => {
  const { nowPlaying } = req.body;
  await User.update({ nowPlaying }, { where: { username: req.user } });
  io.emit("now_playing_update", { username: req.user, nowPlaying });
  res.json({ ok: true });
});

// ── Server Discovery ──────────────────────────────────────────────────────────

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

async function ensureCloudflared() {
  const { bin, install } = require("cloudflared");
  if (!fs.existsSync(bin)) {
    console.log("Installing cloudflared binary…");
    await install(bin);
  }
}

async function startPublicTunnel() {
  if (tunnelUrl) return tunnelUrl;
  if (tunnelStarting) {
    // wait briefly for in-flight start
    for (let i = 0; i < 40 && tunnelStarting; i++) await new Promise((r) => setTimeout(r, 250));
    if (tunnelUrl) return tunnelUrl;
  }
  tunnelStarting = true;
  tunnelError = null;
  try {
    await ensureCloudflared();
    const { Tunnel } = require("cloudflared");
    publicTunnel = Tunnel.quick("http://127.0.0.1:3001");
    tunnelUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Tunnel timed out")), 90000);
      publicTunnel.once("url", (url) => {
        clearTimeout(timer);
        resolve(url);
      });
      publicTunnel.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      publicTunnel.once("exit", () => {
        tunnelUrl = null;
        publicTunnel = null;
      });
    });
    console.log("Public tunnel:", tunnelUrl);
    return tunnelUrl;
  } catch (err) {
    console.error("Cloudflare tunnel failed, trying localtunnel…", err.message || err);
    try {
      const localtunnel = require("localtunnel");
      const t = await localtunnel({ port: 3001 });
      publicTunnel = t;
      tunnelUrl = t.url;
      t.on("close", () => {
        if (publicTunnel === t) {
          publicTunnel = null;
          tunnelUrl = null;
        }
      });
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

function stopPublicTunnel() {
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

// ── Start ─────────────────────────────────────────────────────────────────────

let listening = false;

function startServer() {
  if (listening) return Promise.resolve();
  return sequelize.sync({ alter: true }).then(() => {
    console.log("Database synced");
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
