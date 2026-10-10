/**
 * ==========================================
 * NAONIME FULL PLATFORM SERVER (v2.3 - Updated)
 * ==========================================
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

const DB_FILE = path.join(__dirname, 'database.json');
function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ 
      users: [], 
      data: {}, 
      profiles: {}, 
      friends: {}, 
      publicChat: [] 
    }, null, 2));
  }
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    if (!db.profiles) db.profiles = {};
    if (!db.friends) db.friends = {};
    if (!db.publicChat) db.publicChat = [];
    return db;
  } catch (e) {
    return { users: [], data: {}, profiles: {}, friends: {}, publicChat: [] };
  }
}
function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const ADMIN_EMAIL = 'akuadminkamumemberyah@gmail.com';

const config = {
  port: process.env.PORT || 80,
  baseUrl: process.env.BASE_URL || 'https://otakudesu.blog',
  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  ],
  timeout: 30000,
  retries: 5,
  delayMin: 300,
  delayMax: 800
};

class ApiResponse {
  static success(res, data, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({ success: true, status: statusCode, message, data, timestamp: new Date().toISOString() });
  }
  static error(res, message = 'Internal Server Error', statusCode = 500, details = null) {
    const response = { success: false, status: statusCode, message, timestamp: new Date().toISOString() };
    if (details) response.details = details;
    return res.status(statusCode).json(response);
  }
}

class RequestHandler {
  constructor() { this.uaIndex = 0; }
  delay(min = config.delayMin, max = config.delayMax) {
    return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
  }
  getHeaders(ref = config.baseUrl) {
    return {
      'User-Agent': config.userAgents[0],
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
      'Referer': ref || config.baseUrl,
      'Connection': 'keep-alive'
    };
  }
  async request(method, url, data = null, headers = {}, retries = config.retries) {
    let lastError = null;
    for (let i = 0; i < retries; i++) {
      try {
        await this.delay();
        return await axios({ method, url, headers, data, timeout: config.timeout, httpsAgent: new https.Agent({ rejectUnauthorized: false, keepAlive: true }), validateStatus: status => status >= 200 && status < 400 });
      } catch (error) {
        lastError = error;
        if (i < retries - 1) await this.delay(1500, 4000);
      }
    }
    throw lastError;
  }
  async fetchHTML(url) {
    const response = await this.request('GET', url, null, this.getHeaders(url));
    return response.data;
  }
  async postAjax(payload) {
    const params = new URLSearchParams(payload);
    const url = `${config.baseUrl}/wp-admin/admin-ajax.php`;
    const response = await this.request('POST', url, params.toString(), { ...this.getHeaders(config.baseUrl), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' });
    return response.data;
  }
}

class OtakudesuScraper {
  constructor() { this.base = config.baseUrl; this.requestHandler = new RequestHandler(); }
  parseCardDetpost($, element) {
    const $el =$(element);
    const link = $el.find('.thumb a').attr('href');
    const title = $el.find('.jdlflm').text().trim();
    if (!link || !title) return null;
    return { title, url: link.startsWith('http') ? link : this.base + link, poster: $el.find('.thumbz img').attr('src') || null, episode: $el.find('.epz').text().trim() || null, status:$el.find('.epztipe').text().trim() || null, source: 'otakudesu' };
  }
  parseEpisodeList($) {
    const episodes = [];
    $('.episodelist ul li').each((i, el) => {
      const $a =$(el).find('a');
      const title = $a.text().trim();
      const href = $a.attr('href');
      if (href && title) episodes.push({ title, url: href.startsWith('http') ? href : this.base + href });
    });
    return episodes;
  }
  extractPostId($) {
    const ids = new Set();
    $('[data-content]').each((i, el) => {
      try {
        const parsed = JSON.parse(Buffer.from($(el).attr('data-content'), 'base64').toString('utf-8'));
        if (parsed.id) ids.add(parsed.id);
      } catch (e) {}
    });
    return ids.size > 0 ? [...ids][0] : null;
  }
  async getNonce() {
    try {
      const res = await this.requestHandler.postAjax({ action: 'aa1208d27f29ca340c92c66d1926f13f' });
      return res?.data || null;
    } catch (e) { return null; }
  }
  async getStreamUrl(postId, index, quality, nonce) {
    try {
      const res = await this.requestHandler.postAjax({ action: '2a3505c93b0035d3f455df82bf976b84', id: postId, i: index, q: quality, nonce });
      if (!res || !res.data) return null;
      const html = Buffer.from(res.data, 'base64').toString('utf-8');
      return cheerio.load(html)('iframe').attr('src') || null;
    } catch (e) { return null; }
  }
  async extractStreams(html) {
    const $ = cheerio.load(html);
    const postId = this.extractPostId($);
    if (!postId) return {};
    const nonce = await this.getNonce();
    if (!nonce) return {};
    const streams = {};
    $('.mirrorstream ul a').each((j, a) => {
      const $a =$(a);
      const dataContent = $a.attr('data-content');
      if (dataContent) {
        try {
          const parsed = JSON.parse(Buffer.from(dataContent, 'base64').toString('utf-8'));
          if (parsed.id === postId) streams[`${parsed.q}_${$a.text().trim()}`] = { postId, i: parsed.i, q: parsed.q, nonce };
        } catch (e) {}
      }
    });
    const result = {};
    for (const [key, p] of Object.entries(streams)) {
      const url = await this.getStreamUrl(p.postId, p.i, p.q, p.nonce);
      if (url) result[key] = url;
    }
    return result;
  }
  async home() {
    const $ = cheerio.load(await this.requestHandler.fetchHTML(this.base + '/'));
    const items = [];
    $('.detpost:has(.epz:contains("Episode"))').each((i, el) => {
      const card = this.parseCardDetpost($, el);
      if (card) items.push(card);
    });
    return { items };
  }
  async search(query) {
    const $ = cheerio.load(await this.requestHandler.fetchHTML(`${this.base}/?s=${encodeURIComponent(query)}&post_type=anime`));
    const items = [];
    $('.chivsrc li').each((i, el) => {
      const $el =$(el);
      const link = $el.find('h2 a').attr('href');
      const title = $el.find('h2 a').text().trim();
      if (link && title) {
        items.push({ title, url: link.startsWith('http') ? link : this.base + link, poster: $el.find('img').attr('src') || null, status:$el.find('.set:nth-child(2)').text().replace('Status :', '').trim() || null, source: 'otakudesu' });
      }
    });
    return { query, items };
  }
  async detail(slug) {
    const $ = cheerio.load(await this.requestHandler.fetchHTML(`${this.base}/anime/${slug}/`));
    return { title: $('.jdlrx h1').text().trim() || $('title').text().trim(), poster: $('.fotoanime img').attr('src') || null, sinopsis:$('.sinopc p').text().trim() || null, episodes: this.parseEpisodeList($), source: 'otakudesu' };
  }
  async episode(slug) {
    const html = await this.requestHandler.fetchHTML(`${this.base}/episode/${slug}/`);
    const $ = cheerio.load(html);
    return { title: $('h1.posttl').text().trim() || $('title').text().trim(), streams: await this.extractStreams(html) };
  }
}

const scraper = new OtakudesuScraper();

const donghuaRoutes = require('./donghua');
const mangakuRouter = require('./mangaku');
const alternativeRoutes = require('./alternative');
const filmRoutes = require('./film');

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" }, contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

app.get('/api/home', async (req, res, next) => {
  try { ApiResponse.success(res, await scraper.home(), 'Home fetched'); } catch (e) { next(e); }
});

app.get('/api/search', async (req, res, next) => {
  try {
    const q = req.query.q;
    let items = [];
    try {
      const animeResult = await scraper.search(q);
      if (animeResult && animeResult.items) items.push(...animeResult.items);
    } catch (err) {}
    try {
      const aniRes = await axios.get(`http://127.0.0.1:5000/search/${encodeURIComponent(q)}`);
      let rawAni = aniRes.data.results || aniRes.data || [];
      rawAni.forEach(item => { items.push({ title: item.title || item.judul, url: item.url || item.link, poster: item.thumbnail || item.poster || item.image || item.img || '', source: 'anichin' }); });
    } catch (err) {}
    try {
      const filmRes = await axios.get(`https://tv9.gf21.fun/?s=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://tv9.gf21.fun' } });
      const $= cheerio.load(filmRes.data);$('article, .item, .movies, .result-item, .search-item').each((i, el) => {
        const $el =$(el);
        const title = $el.find('h3, h2.title, .title, .judul').text().trim();
        const url = $el.find('a').attr('href');
        const $img =$el.find('img');
        let poster = $img.attr('data-lazy-loaded') || $img.attr('data-src') || $img.attr('src');
        if (title && url) items.push({ title, url: url.startsWith('http') ? url : 'https://tv9.gf21.fun' + url, poster: poster || '', episode: 'HD', source: 'film' });
      });
    } catch (err) {}
    try {
      const mangakuRes = await axios.get(`https://mangamint.kaedenoki.net/api/search/${encodeURIComponent(q)}`);
      let rawManga = mangakuRes.data.manga_list || [];
      rawManga.forEach(item => { items.push({ title: item.title, url: item.endpoint, poster: item.thumb, episode: item.chapter || 'Chapter Baru', source: 'mangaku' }); });
    } catch (err) {}
    ApiResponse.success(res, { query: q, items }, 'Search fetched');
  } catch (e) { next(e); }
});

app.get('/api/anime/detail', async (req, res, next) => {
  try {
    const animeUrl = req.query.url;
    const slug = animeUrl ? animeUrl.split('/').filter(Boolean).pop() : '';
    ApiResponse.success(res, await scraper.detail(slug), 'Detail fetched');
  } catch (e) { next(e); }
});

app.get('/api/episode/detail', async (req, res, next) => {
  try {
    const { url, source } = req.query;
    if (source === 'anichin') {
      req.url = `/episode?url=${encodeURIComponent(url)}`;
      return donghuaRoutes(req, res, next);
    }
    const slug = url ? url.split('/').filter(Boolean).pop() : '';
    ApiResponse.success(res, await scraper.episode(slug), 'Episode fetched');
  } catch (e) { next(e); }
});

app.use('/api/donghua', donghuaRoutes);
app.use('/api/mangaku', mangakuRouter);
app.use('/api/film', filmRoutes);
app.use('/api/alternative', alternativeRoutes);

app.post('/api/auth/register', (req, res) => {
  const { email, password, nickname } = req.body;
  if (!email || !password || !email.endsWith('@gmail.com')) return ApiResponse.error(res, 'Gunakan Gmail valid (@gmail.com)', 400);
  const db = readDB();
  if (db.users.some(u => u.email === email)) return ApiResponse.error(res, 'Gmail sudah terdaftar', 400);
  const isAdmin = (email === ADMIN_EMAIL);
  const user = { email, password, nickname: nickname || email.split('@')[0], role: isAdmin ? 'admin' : 'user', level: isAdmin ? 999 : 1, xp: 0, createdAt: new Date().toISOString() };
  db.users.push(user);
  db.data[email] = { favorites: [], history: [] };
  db.profiles[email] = { avatar: '', banner: '', bio: 'Penggemar anime Naonime.' };
  db.friends[email] = { requests: [], list: [] };
  writeDB(db);
  ApiResponse.success(res, { email, nickname: user.nickname, level: user.level }, 'Registrasi berhasil');
});

app.post('/api/auth/login', (req, res) => {
  const { email, password, nickname } = req.body;
  if (!email || !password) return ApiResponse.error(res, 'Gmail dan password wajib diisi', 400);
  const db = readDB();
  let user = db.users.find(u => u.email === email && u.password === password);
  if (!user && email === ADMIN_EMAIL) {
    user = { email, password, nickname: nickname || 'Admin Naonime', role: 'admin', level: 999, xp: 9999, createdAt: new Date().toISOString() };
    db.users.push(user);
    if (!db.data[email]) db.data[email] = { favorites: [], history: [] };
    if (!db.profiles[email]) db.profiles[email] = { avatar: '', banner: '', bio: 'Admin Naonime' };
    if (!db.friends[email]) db.friends[email] = { requests: [], list: [] };
    writeDB(db);
  }
  if (!user) return ApiResponse.error(res, 'Gmail atau password salah', 401);
  if (email === ADMIN_EMAIL) { user.level = 999; user.role = 'admin'; }
  if (nickname && user.nickname !== nickname) user.nickname = nickname;
  writeDB(db);
  ApiResponse.success(res, { email: user.email, nickname: user.nickname, level: user.level, role: user.role, favorites: db.data[email]?.favorites || [], history: db.data[email]?.history || [], profile: db.profiles[email] || {}, friends: db.friends[email] || {} }, 'Login berhasil');
});

app.get('/api/user/:email/data', (req, res) => {
  const { email } = req.params;
  const db = readDB();
  const user = db.users.find(u => u.email === email) || { level: email === ADMIN_EMAIL ? 999 : 1, nickname: email.split('@')[0] };
  if (email === ADMIN_EMAIL) user.level = 999;
  if (!db.data[email]) db.data[email] = { favorites: [], history: [] };
  if (!db.profiles[email]) db.profiles[email] = { avatar: '', banner: '', bio: '' };
  if (!db.friends[email]) db.friends[email] = { requests: [], list: [] };
  ApiResponse.success(res, { ...db.data[email], nickname: user.nickname, level: user.level, role: user.role || (email === ADMIN_EMAIL ? 'admin' : 'user'), profile: db.profiles[email], friends: db.friends[email] }, 'Data user dimuat');
});

app.post('/api/user/:email/data', (req, res) => {
  const { email } = req.params;
  const { favorites, history } = req.body;
  const db = readDB();
  if (favorites) db.data[email].favorites = favorites;
  if (history) db.data[email].history = history;
  writeDB(db);
  ApiResponse.success(res, db.data[email], 'Data berhasil disimpan');
});

// --- PERTEMANAN BERBASIS NICKNAME ---
app.post('/api/friends/request', (req, res) => {
  const { senderEmail, receiverNickname } = req.body;
  const db = readDB();
  const senderUser = db.users.find(u => u.email === senderEmail);
  const receiverUser = db.users.find(u => u.nickname === receiverNickname);

  if (!receiverUser) return ApiResponse.error(res, 'Nickname teman tidak ditemukan', 404);
  if (senderUser.nickname === receiverNickname) return ApiResponse.error(res, 'Tidak bisa menambah diri sendiri', 400);

  const receiverEmail = receiverUser.email;
  if (!db.friends[receiverEmail]) db.friends[receiverEmail] = { requests: [], list: [] };
  if (db.friends[receiverEmail].list.includes(senderUser.nickname)) return ApiResponse.error(res, 'Sudah berteman', 400);
  if (db.friends[receiverEmail].requests.includes(senderUser.nickname)) return ApiResponse.error(res, 'Permintaan sudah dikirim sebelumnya', 400);

  db.friends[receiverEmail].requests.push(senderUser.nickname);
  writeDB(db);
  ApiResponse.success(res, {}, 'Permintaan pertemanan terkirim');
});

app.post('/api/friends/accept', (req, res) => {
  const { userEmail, senderNickname } = req.body;
  const db = readDB();
  const targetUser = db.users.find(u => u.email === userEmail);
  const senderUser = db.users.find(u => u.nickname === senderNickname);

  if (!targetUser || !senderUser) return ApiResponse.error(res, 'User tidak ditemukan', 404);

  const targetEmail = targetUser.email;
  const senderEmail = senderUser.email;

  if (!db.friends[targetEmail]) db.friends[targetEmail] = { requests: [], list: [] };
  if (!db.friends[senderEmail]) db.friends[senderEmail] = { requests: [], list: [] };

  db.friends[targetEmail].requests = db.friends[targetEmail].requests.filter(n => n !== senderNickname);
  if (!db.friends[targetEmail].list.includes(senderNickname)) db.friends[targetEmail].list.push(senderNickname);
  if (!db.friends[senderEmail].list.includes(targetUser.nickname)) db.friends[senderEmail].list.push(targetUser.nickname);

  writeDB(db);
  ApiResponse.success(res, {}, 'Pertemanan diterima');
});

app.get('/api/admin/users', (req, res) => {
  const db = readDB();
  const list = db.users.map(u => ({ email: u.email, nickname: u.nickname, level: u.email === ADMIN_EMAIL ? 999 : (u.level || 1), role: u.role }));
  ApiResponse.success(res, list, 'Daftar user');
});

// --- SOCKET.IO GLOBAL CHAT (DENGAN FILTER MAKSIMAL 30 HARI) & NOBAR ---
io.on('connection', (socket) => {
  socket.on('load_public_chat', () => {
    const db = readDB();
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    // Filter pesan yang usianya di bawah 30 hari
    db.publicChat = db.publicChat.filter(m => new Date(m.timestamp || Date.now()).getTime() > thirtyDaysAgo);
    writeDB(db);
    socket.emit('public_chat_history', db.publicChat);
  });

  socket.on('send_public_message', (msg) => {
    const db = readDB();
    let user = db.users.find(u => u.email === msg.email);
    let nickname = user ? user.nickname : (msg.email ? msg.email.split('@')[0] : 'Anonim');
    let level = msg.email === ADMIN_EMAIL ? 999 : (user ? (user.level || 1) : 1);

    if (user && msg.email !== ADMIN_EMAIL) {
      user.xp = (user.xp || 0) + 15;
      if (user.xp >= level * 100) user.level = (user.level || 1) + 1;
      level = user.level;
      writeDB(db);
    }

    let badge = level === 999 ? '👑 ADMIN Lv.999' : `Lv.${level}`;
    const chatItem = { 
      nickname, 
      badge, 
      text: msg.text, 
      time: new Date().toLocaleTimeString(),
      timestamp: Date.now()
    };

    db.publicChat.push(chatItem);
    if (db.publicChat.length > 200) db.publicChat.shift();
    writeDB(db);
    io.emit('new_public_message', chatItem);
  });

  socket.on('join_nobar_room', ({ roomCode, email, animeTitle, episode }) => {
    const room = io.sockets.adapter.rooms.get(roomCode);
    const count = room ? room.size : 0;
    if (count >= 5) {
      socket.emit('nobar_error', 'Room Nobar sudah penuh! Maksimal 5 orang.');
      return;
    }
    socket.join(roomCode);
    socket.emit('nobar_joined', { roomCode, animeTitle, episode });
  });
});

const PORT = config.port;
server.listen(PORT, () => { console.log(`Naonime Platform running on port ${PORT}`); });