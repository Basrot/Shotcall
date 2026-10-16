import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-now';
const APP_ORIGIN = process.env.APP_ORIGIN?.trim();
const joinAttempts = new Map();
const io = new Server(server, {
  cors: { origin: APP_ORIGIN || true, methods: ['GET', 'POST'] },
  pingInterval: 25000,
  pingTimeout: 20000
});

app.use(cors({ origin: APP_ORIGIN || true }));
app.use(express.json({ limit: '200kb' }));
app.disable('x-powered-by');

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const safeRoom = (room) => ({ id: room.id, name: room.name, code: room.code, active: !!room.active, createdAt: room.created_at });
const safeQuestion = (q, includeCorrect = false) => {
  if (!q) return null;
  const result = {
    id: q.id, roomId: q.room_id, title: q.title, options: JSON.parse(q.options_json),
    status: q.status, basePoints: q.base_points, underdogEnabled: !!q.underdog_enabled,
    underdogThreshold: q.underdog_threshold, underdogMultiplier: q.underdog_multiplier,
    minVotes: q.min_votes, createdAt: q.created_at, openedAt: q.opened_at,
    lockedAt: q.locked_at, resolvedAt: q.resolved_at
  };
  if (includeCorrect) result.correctOption = q.correct_option;
  return result;
};
function httpError(res, status, message) { return res.status(status).json({ error: message }); }
function makeToken(payload, expiresIn = '7d') { return jwt.sign(payload, JWT_SECRET, { expiresIn }); }
function authAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin') throw new Error('wrong role');
    req.admin = payload;
    next();
  } catch { return httpError(res, 401, 'Phiên quản trị không hợp lệ. Hãy đăng nhập lại.'); }
}
function authPlayer(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'player') throw new Error('wrong role');
    req.player = payload;
    next();
  } catch { return httpError(res, 401, 'Phiên người chơi không hợp lệ. Hãy vào phòng lại.'); }
}
function getRoomByCode(code) { return db.prepare('SELECT * FROM rooms WHERE code = ? AND active = 1').get(String(code || '').trim().toUpperCase()); }
function getQuestion(id) { return db.prepare('SELECT * FROM questions WHERE id = ?').get(id); }
function voteStats(questionId) {
  const rows = db.prepare('SELECT option_key, COUNT(*) AS n FROM predictions WHERE question_id = ? GROUP BY option_key').all(questionId);
  const total = rows.reduce((s, r) => s + r.n, 0);
  return { total, counts: Object.fromEntries(rows.map(r => [r.option_key, r.n])), percentages: Object.fromEntries(rows.map(r => [r.option_key, total ? Math.round(r.n * 1000 / total) / 10 : 0])) };
}
function leaderboard(roomId) {
  return db.prepare(`
    SELECT p.id AS playerId, p.nickname,
      COALESCE(SUM(s.points), 0) AS points,
      COALESCE(SUM(s.is_correct), 0) AS correctCount,
      COUNT(s.id) AS resolvedCount,
      COALESCE(SUM(CASE WHEN s.is_correct = 1 AND s.multiplier > 1 THEN 1 ELSE 0 END), 0) AS underdogWins
    FROM players p LEFT JOIN scores s ON s.player_id = p.id
    WHERE p.room_id = ?
    GROUP BY p.id ORDER BY points DESC, correctCount DESC, p.created_at ASC
  `).all(roomId).map((r, i) => ({ rank: i + 1, ...r }));
}
function roomState(roomId, viewerPlayerId = null, admin = false) {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room) return null;
  const questions = db.prepare('SELECT * FROM questions WHERE room_id = ? ORDER BY created_at DESC').all(roomId);
  return {
    room: safeRoom(room),
    questions: questions.map(q => {
      const publicQ = safeQuestion(q, admin || q.status === 'resolved');
      publicQ.stats = voteStats(q.id);
      if (viewerPlayerId) {
        const p = db.prepare('SELECT option_key FROM predictions WHERE question_id = ? AND player_id = ?').get(q.id, viewerPlayerId);
        publicQ.myOption = p?.option_key || null;
        const score = db.prepare('SELECT points, multiplier, is_correct FROM scores WHERE question_id = ? AND player_id = ?').get(q.id, viewerPlayerId);
        publicQ.myScore = score || null;
      }
      return publicQ;
    }),
    leaderboard: leaderboard(roomId)
  };
}
function emitRoom(roomId) {
  io.to(`room:${roomId}`).emit('room:update', roomState(roomId));
  io.to(`admin:${roomId}`).emit('room:update', roomState(roomId, null, true));
  // Send player-specific state so every connected player sees new questions/status changes immediately.
  const players = db.prepare('SELECT id FROM players WHERE room_id = ?').all(roomId);
  for (const player of players) emitPlayerState(roomId, player.id);
}
function emitPlayerState(roomId, playerId) {
  io.to(`player:${playerId}`).emit('player:update', roomState(roomId, playerId, false));
}
function getRoomForPlayer(playerId) {
  return db.prepare('SELECT room_id FROM players WHERE id = ?').get(playerId)?.room_id;
}

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'VMC Live Prediction', time: now() }));

// Admin auth
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (String(username || '') !== ADMIN_USERNAME) return httpError(res, 401, 'Sai tài khoản hoặc mật khẩu.');
  const configuredHash = process.env.ADMIN_PASSWORD_HASH;
  const valid = configuredHash
    ? await bcrypt.compare(String(password || ''), configuredHash)
    : String(password || '') === ADMIN_PASSWORD;
  if (!valid) return httpError(res, 401, 'Sai tài khoản hoặc mật khẩu.');
  const token = makeToken({ role: 'admin', username: ADMIN_USERNAME }, '12h');
  return res.json({ token, username: ADMIN_USERNAME });
});

app.get('/api/admin/rooms', authAdmin, (_req, res) => {
  res.json({ rooms: db.prepare('SELECT * FROM rooms ORDER BY created_at DESC').all().map(safeRoom) });
});
app.post('/api/admin/rooms', authAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) return httpError(res, 400, 'Tên phòng không được để trống.');
  let code;
  for (let i = 0; i < 10; i++) {
    code = crypto.randomBytes(3).toString('hex').toUpperCase();
    if (!db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code)) break;
  }
  const room = { id: uid(), name, code, created_at: now(), active: 1 };
  db.prepare('INSERT INTO rooms (id,name,code,created_at,active) VALUES (@id,@name,@code,@created_at,@active)').run(room);
  res.json({ room: safeRoom(room) });
});
app.post('/api/admin/rooms/:id/close', authAdmin, (req, res) => {
  const result = db.prepare('UPDATE rooms SET active = 0 WHERE id = ?').run(req.params.id);
  if (!result.changes) return httpError(res, 404, 'Không tìm thấy phòng.');
  io.to(`room:${req.params.id}`).emit('room:closed');
  res.json({ ok: true });
});
app.get('/api/admin/rooms/:id/state', authAdmin, (req, res) => {
  const state = roomState(req.params.id, null, true);
  if (!state) return httpError(res, 404, 'Không tìm thấy phòng.');
  res.json(state);
});
app.post('/api/admin/rooms/:id/questions', authAdmin, (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ? AND active = 1').get(req.params.id);
  if (!room) return httpError(res, 404, 'Phòng không tồn tại hoặc đã đóng.');
  const title = String(req.body?.title || '').trim().slice(0, 300);
  const rawOptions = Array.isArray(req.body?.options) ? req.body.options : [];
  const options = rawOptions.map((o, i) => ({ key: String.fromCharCode(65 + i), text: String(o).trim().slice(0, 100) })).filter(o => o.text);
  if (title.length < 5) return httpError(res, 400, 'Câu hỏi cần ít nhất 5 ký tự.');
  if (options.length < 2 || options.length > 8) return httpError(res, 400, 'Cần từ 2 đến 8 đáp án.');
  const basePoints = Math.max(1, Math.min(10000, Number.parseInt(req.body?.basePoints, 10) || 100));
  const threshold = Math.max(1, Math.min(50, Number(req.body?.underdogThreshold) || 15));
  const multiplier = Math.max(1, Math.min(5, Number(req.body?.underdogMultiplier) || 2));
  const minVotes = Math.max(2, Math.min(1000, Number.parseInt(req.body?.minVotes, 10) || 10));
  const q = {
    id: uid(), room_id: room.id, title, options_json: JSON.stringify(options), status: 'draft',
    correct_option: null, base_points: basePoints, underdog_enabled: req.body?.underdogEnabled === false ? 0 : 1,
    underdog_threshold: threshold, underdog_multiplier: multiplier, min_votes: minVotes,
    created_at: now(), opened_at: null, locked_at: null, resolved_at: null
  };
  db.prepare(`INSERT INTO questions
  (id,room_id,title,options_json,status,correct_option,base_points,underdog_enabled,underdog_threshold,underdog_multiplier,min_votes,created_at,opened_at,locked_at,resolved_at)
  VALUES (@id,@room_id,@title,@options_json,@status,@correct_option,@base_points,@underdog_enabled,@underdog_threshold,@underdog_multiplier,@min_votes,@created_at,@opened_at,@locked_at,@resolved_at)`).run(q);
  emitRoom(room.id);
  res.json({ question: safeQuestion(q, true) });
});
app.post('/api/admin/questions/:id/open', authAdmin, (req, res) => {
  const q = getQuestion(req.params.id);
  if (!q) return httpError(res, 404, 'Không tìm thấy câu hỏi.');
  if (!['draft'].includes(q.status)) return httpError(res, 409, 'Chỉ có thể mở câu hỏi đang ở trạng thái nháp.');
  db.prepare("UPDATE questions SET status='open', opened_at=? WHERE id=?").run(now(), q.id);
  emitRoom(q.room_id);
  res.json({ ok: true });
});
app.post('/api/admin/questions/:id/lock', authAdmin, (req, res) => {
  const q = getQuestion(req.params.id);
  if (!q) return httpError(res, 404, 'Không tìm thấy câu hỏi.');
  if (q.status !== 'open') return httpError(res, 409, 'Câu hỏi không ở trạng thái mở.');
  db.prepare("UPDATE questions SET status='locked', locked_at=? WHERE id=?").run(now(), q.id);
  emitRoom(q.room_id);
  res.json({ ok: true, stats: voteStats(q.id) });
});
app.post('/api/admin/questions/:id/resolve', authAdmin, (req, res) => {
  const q = getQuestion(req.params.id);
  if (!q) return httpError(res, 404, 'Không tìm thấy câu hỏi.');
  if (q.status !== 'locked') return httpError(res, 409, 'Chỉ công bố kết quả sau khi khóa dự đoán.');
  const correctOption = String(req.body?.correctOption || '');
  const options = JSON.parse(q.options_json);
  if (!options.some(o => o.key === correctOption)) return httpError(res, 400, 'Đáp án đúng không hợp lệ.');
  const stats = voteStats(q.id);
  const total = stats.total;
  const correctCount = stats.counts[correctOption] || 0;
  const correctPct = total ? (correctCount / total) * 100 : 0;
  const eligibleUnderdog = !!q.underdog_enabled && total >= q.min_votes && correctPct <= q.underdog_threshold;
  const multiplier = eligibleUnderdog ? q.underdog_multiplier : 1;
  const predictions = db.prepare('SELECT * FROM predictions WHERE question_id = ?').all(q.id);
  const insertScore = db.prepare(`INSERT INTO scores (id,question_id,player_id,points,multiplier,is_correct,created_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(question_id,player_id) DO UPDATE SET points=excluded.points,multiplier=excluded.multiplier,is_correct=excluded.is_correct,created_at=excluded.created_at`);
  const tx = db.transaction(() => {
    for (const p of predictions) {
      const isCorrect = p.option_key === correctOption;
      const points = isCorrect ? Math.round(q.base_points * (eligibleUnderdog ? multiplier : 1)) : 0;
      insertScore.run(uid(), q.id, p.player_id, points, isCorrect ? (eligibleUnderdog ? multiplier : 1) : 1, isCorrect ? 1 : 0, now());
    }
    db.prepare("UPDATE questions SET status='resolved', correct_option=?, resolved_at=? WHERE id=?").run(correctOption, now(), q.id);
  });
  tx();
  emitRoom(q.room_id);
  for (const p of predictions) emitPlayerState(q.room_id, p.player_id);
  res.json({ ok: true, correctOption, correctPct: Math.round(correctPct * 10) / 10, underdogApplied: eligibleUnderdog, multiplier, totalVotes: total });
});
app.post('/api/admin/questions/:id/cancel', authAdmin, (req, res) => {
  const q = getQuestion(req.params.id);
  if (!q) return httpError(res, 404, 'Không tìm thấy câu hỏi.');
  if (q.status === 'resolved') return httpError(res, 409, 'Không thể hủy câu đã chấm điểm.');
  db.prepare("UPDATE questions SET status='cancelled', locked_at=COALESCE(locked_at,?), resolved_at=? WHERE id=?").run(now(), now(), q.id);
  emitRoom(q.room_id);
  res.json({ ok: true });
});

// Player endpoints
app.post('/api/rooms/join', async (req, res) => {
  // Basic in-memory throttling protects the 6-digit recovery PIN from rapid guessing.
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
  const attempt = joinAttempts.get(ip) || { count: 0, resetAt: Date.now() + 10 * 60 * 1000 };
  if (Date.now() > attempt.resetAt) { attempt.count = 0; attempt.resetAt = Date.now() + 10 * 60 * 1000; }
  attempt.count += 1;
  joinAttempts.set(ip, attempt);
  if (attempt.count > 20) return httpError(res, 429, 'Bạn thử quá nhiều lần. Vui lòng đợi 10 phút rồi thử lại.');
  if (joinAttempts.size > 5000) { for (const [key, value] of joinAttempts) if (Date.now() > value.resetAt) joinAttempts.delete(key); }
  const code = String(req.body?.code || '').trim().toUpperCase();
  const nickname = String(req.body?.nickname || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  const recoveryPin = String(req.body?.recoveryPin || '').trim();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) return httpError(res, 400, 'Mã phòng không hợp lệ.');
  if (nickname.length < 2) return httpError(res, 400, 'Nickname cần ít nhất 2 ký tự.');
  if (!/^\d{6}$/.test(recoveryPin)) return httpError(res, 400, 'Mã khôi phục phải gồm đúng 6 chữ số.');
  const room = getRoomByCode(code);
  if (!room) return httpError(res, 404, 'Không tìm thấy phòng hoặc phòng đã đóng.');
  const existing = db.prepare('SELECT * FROM players WHERE room_id=? AND nickname=? COLLATE NOCASE').get(room.id, nickname);
  if (existing) {
    if (!existing.recovery_pin_hash) return httpError(res, 409, 'Tên này đã được đăng ký ở phiên bản cũ và chưa có mã khôi phục. Hãy dùng phiên đăng nhập cũ hoặc nhờ quản trị viên hỗ trợ.');
    const validPin = await bcrypt.compare(recoveryPin, existing.recovery_pin_hash);
    if (!validPin) return httpError(res, 401, 'Tên này đã có người đăng ký. Mã khôi phục không chính xác.');
    const token = makeToken({ role: 'player', playerId: existing.id, roomId: room.id }, '30d');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    db.prepare('UPDATE players SET token_hash=? WHERE id=?').run(tokenHash, existing.id);
    return res.json({ token, resumed: true, player: { id: existing.id, nickname: existing.nickname }, state: roomState(room.id, existing.id, false) });
  }
  const player = { id: uid(), room_id: room.id, nickname, token_hash: '', recovery_pin_hash: await bcrypt.hash(recoveryPin, 10), created_at: now() };
  const token = makeToken({ role: 'player', playerId: player.id, roomId: room.id }, '30d');
  player.token_hash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO players (id,room_id,nickname,token_hash,recovery_pin_hash,created_at) VALUES (@id,@room_id,@nickname,@token_hash,@recovery_pin_hash,@created_at)').run(player);
  emitRoom(room.id);
  res.json({ token, resumed: false, player: { id: player.id, nickname }, state: roomState(room.id, player.id, false) });
});
app.get('/api/player/state', authPlayer, (req, res) => {
  const roomId = getRoomForPlayer(req.player.playerId);
  if (!roomId || roomId !== req.player.roomId) return httpError(res, 401, 'Người chơi không còn trong phòng.');
  const state = roomState(roomId, req.player.playerId, false);
  if (!state) return httpError(res, 404, 'Không tìm thấy phòng.');
  res.json(state);
});
app.post('/api/player/questions/:id/predict', authPlayer, (req, res) => {
  const playerId = req.player.playerId;
  const roomId = getRoomForPlayer(playerId);
  const q = getQuestion(req.params.id);
  if (!q || !roomId || q.room_id !== roomId) return httpError(res, 404, 'Không tìm thấy câu hỏi.');
  if (q.status !== 'open') return httpError(res, 409, 'Câu hỏi đã khóa hoặc chưa mở.');
  const options = JSON.parse(q.options_json);
  const optionKey = String(req.body?.optionKey || '');
  if (!options.some(o => o.key === optionKey)) return httpError(res, 400, 'Đáp án không hợp lệ.');
  try {
    db.prepare('INSERT INTO predictions (id,question_id,player_id,option_key,submitted_at) VALUES (?,?,?,?,?)')
      .run(uid(), q.id, playerId, optionKey, now());
  } catch {
    return httpError(res, 409, 'Bạn đã gửi dự đoán cho câu này. Mỗi người chỉ được chọn một lần.');
  }
  emitRoom(roomId);
  emitPlayerState(roomId, playerId);
  res.json({ ok: true, optionKey });
});

// Socket.IO: room membership is derived from signed token, never from client-provided player id.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next();
  try { socket.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { next(new Error('Phiên đăng nhập không hợp lệ')); }
});
io.on('connection', socket => {
  const user = socket.user;
  if (!user) return;
  if (user.role === 'admin') {
    socket.on('admin:watch', roomId => {
      const room = db.prepare('SELECT id FROM rooms WHERE id=?').get(String(roomId));
      if (room) {
        socket.join(`admin:${room.id}`);
        socket.emit('room:update', roomState(room.id, null, true));
      }
    });
  } else if (user.role === 'player') {
    const roomId = getRoomForPlayer(user.playerId);
    if (roomId && roomId === user.roomId) {
      socket.join(`room:${roomId}`);
      socket.join(`player:${user.playerId}`);
      socket.emit('player:update', roomState(roomId, user.playerId, false));
    }
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../dist');
app.use(express.static(distPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(distPath, 'index.html'), err => { if (err) res.status(404).send('Frontend chưa được build. Chạy npm run build.'); });
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`VMC Live Prediction server listening on http://0.0.0.0:${PORT}`);
  if (ADMIN_PASSWORD === 'change-me-now' && !process.env.ADMIN_PASSWORD_HASH) {
    console.warn('WARNING: Change ADMIN_PASSWORD in .env before exposing this server to the internet.');
  }
});