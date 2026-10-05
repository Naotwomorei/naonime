/**
 * ==========================================
 * KURNANIME FULL PLATFORM SERVER (v2.0)
 * Auth (Gmail), Profiles, Public Chat, Nobar, Friends, Scraping
 * ==========================================
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const DB_FILE = path.join(__dirname, 'database.json');
function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ 
      users: [], 
      data: {}, 
      profiles: {}, 
      friends: {}, // email -> { requests: [], list: [] }
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
  port: process.env.PORT || 3000,
  baseUrl: process.env.BASE_URL || 'https://otakudesu.blog',
  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
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
  static paginated(res, items, pagination, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({ success: true, status: statusCode, message, data: { items, pagination }, timestamp: new Date().toISOString() });
  }
}

class CookieJar {
  constructor() { this.cookies = {}; }
  update(headers) {
    const setCookie = headers['set-cookie'];
    if (!setCookie) return;
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const cookieStr of cookies) {
      const parts = cookieStr.split(';')[0].split('=');
      if (parts.length >= 2) {
        this.cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
      }
    }
  }
  getString() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

class RequestHandler {
  constructor() {
    this.uaIndex = 0;
    this.cookieJar = new CookieJar();
  }
  delay(min = config.delayMin, max = config.delayMax) {
    return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
  }
  getHeaders(ref = config.baseUrl, cookie = '') {
    const ua = config.userAgents[this.uaIndex++ % config.userAgents.length];
    const headers = {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
      'Referer': ref || config.baseUrl,
      'Connection': 'keep-alive'
    };
    if (cookie) headers['Cookie'] = cookie;
    return headers;
  }
  async request(method, url, data = null, headers = {}, retries = config.retries) {
    let lastError = null;
    for (let i = 0; i < retries; i++) {
      try {
        await this.delay();
        const response = await axios({
          method, url, headers, data,
          timeout: config.timeout,
          httpsAgent: new https.Agent({ rejectUnauthorized: false, keepAlive: true }),
          maxRedirects: 5,
          validateStatus: status => status >= 200 && status < 400
        });
        this.cookieJar.update(response.headers);
        return response;
      } catch (error) {
        lastError = error;
        if (i < retries - 1) await this.delay(1500, 4000);
      }
    }
    throw lastError;
  }
  async fetchHTML(url, retries = config.retries) {
    const headers = this.getHeaders(url, this.cookieJar.getString());
    const response = await this.request('GET', url, null, headers, retries);
    return response.data;
  }
  async postAjax(payload, retries = config.retries) {
    const params = new URLSearchParams(payload);
    const url = `${config.baseUrl}/wp-admin/admin-ajax.php`;
    const headers = {
      ...this.getHeaders(config.baseUrl, this.cookieJar.getString()),
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    const response = await this.request('POST', url, params.toString(), headers, retries);
    return response.data;
  }
}

class OtakudesuScraper {
  constructor() {
    this.base = config.baseUrl;
    this.requestHandler = new RequestHandler();
  }

  parsePagination($) {
    const result = { current: 1, next: null, hasNext: false, total: null };
    const pageLinks = [];
    $('.pagination a, .pagination span, .page-numbers, .pagenavix a, .pagenavix span').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href) pageLinks.push({ text, href });
    });
    const numbers = pageLinks.filter(l => /^\d+$/.test(l.text)).map(l => parseInt(l.text));
    if (numbers.length) result.total = Math.max(...numbers);
    const current = $('.pagination .page-numbers.current, .pagenavix .page-numbers.current').first();
    if (current.length && /^\d+$/.test(current.text().trim())) {
      result.current = parseInt(current.text().trim());
    }
    if (result.total && result.current < result.total) {
      result.hasNext = true;
      const nextLink = pageLinks.find(l => l.text === 'Next' || l.text === '»');
      if (nextLink && nextLink.href) {
        result.next = nextLink.href.startsWith('http') ? nextLink.href : this.base + nextLink.href;
      }
    }
    return result;
  }

  parseCardDetpost($, element) {
    const $el = $(element);
    const link = $el.find('.thumb a').attr('href');
    const title = $el.find('.jdlflm').text().trim();
    if (!link || !title) return null;
    return {
      title,
      url: link.startsWith('http') ? link : this.base + link,
      poster: $el.find('.thumbz img').attr('src') || null,
      episode: $el.find('.epz').text().trim() || null,
      day: $el.find('.epztipe').text().trim() || null,
      date: $el.find('.newnime').text().trim() || null
    };
  }

  parseEpisodeList($) {
    const episodes = [];
    $('.episodelist ul li').each((i, el) => {
      const $a = $(el).find('a');
      const title = $a.text().trim();
      const href = $a.attr('href');
      if (href && title) {
        const match = href.match(/\/episode\/([^\/]+)\/?$/);
        episodes.push({
          title,
          episodeId: match ? match[1] : null,
          url: href.startsWith('http') ? href : this.base + href,
          releaseDate: $(el).find('.zeebr').text().trim() || null
        });
      }
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
      const res = await this.requestHandler.postAjax({
        action: '2a3505c93b0035d3f455df82bf976b84',
        id: postId, i: index, q: quality, nonce
      });
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
      const $a = $(a);
      const dataContent = $a.attr('data-content');
      if (dataContent) {
        try {
          const parsed = JSON.parse(Buffer.from(dataContent, 'base64').toString('utf-8'));
          if (parsed.id === postId) {
            streams[`${parsed.q}_${$a.text().trim()}`] = { postId, i: parsed.i, q: parsed.q, nonce };
          }
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
      const $el = $(el);
      const link = $el.find('h2 a').attr('href');
      const title = $el.find('h2 a').text().trim();
      if (link && title) {
        items.push({
          title,
          url: link.startsWith('http') ? link : this.base + link,
          poster: $el.find('img').attr('src') || null,
          genres: $el.find('.set:first-child a').map((_, a) => $(a).text()).get() || [],
          status: $el.find('.set:nth-child(2)').text().replace('Status :', '').trim() || null
        });
      }
    });
    return { query, items };
  }

  async detail(slug) {
    const $ = cheerio.load(await this.requestHandler.fetchHTML(`${this.base}/anime/${slug}/`));
    return {
      title: $('.jdlrx h1').text().trim() || $('title').text().trim(),
      poster: $('.fotoanime img').attr('src') || null,
      sinopsis: $('.sinopc p').text().trim() || null,
      episodes: this.parseEpisodeList($)
    };
  }

  async episode(slug) {
    const html = await this.requestHandler.fetchHTML(`${this.base}/episode/${slug}/`);
    const $ = cheerio.load(html);
    return {
      title: $('h1.posttl').text().trim() || $('title').text().trim(),
      streams: await this.extractStreams(html)
    };
  }
}

const scraper = new OtakudesuScraper();

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" }, contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- API AUTH ---
app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || !email.endsWith('@gmail.com')) {
    return ApiResponse.error(res, 'Gunakan alamat Gmail yang valid (@gmail.com)', 400);
  }
  const db = readDB();
  if (db.users.some(u => u.email === email)) {
    return ApiResponse.error(res, 'Gmail sudah terdaftar', 400);
  }
  const role = (email === ADMIN_EMAIL) ? 'admin' : 'user';
  db.users.push({ email, password, role, createdAt: new Date().toISOString() });
  db.data[email] = { favorites: [], history: [] };
  db.profiles[email] = {
    avatar: 'https://via.placeholder.com/150?text=Avatar',
    banner: 'https://via.placeholder.com/600x200?text=Banner',
    bio: 'Penggemar anime setia Kumanime.'
  };
  db.friends[email] = { requests: [], list: [] };
  writeDB(db);
  ApiResponse.success(res, { email, role }, 'Registrasi berhasil');
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return ApiResponse.error(res, 'Gmail dan password wajib diisi', 400);
  const db = readDB();
  let user = db.users.find(u => u.email === email && u.password === password);
  
  if (!user && email === ADMIN_EMAIL) {
    user = { email, password, role: 'admin', createdAt: new Date().toISOString() };
    db.users.push(user);
    if (!db.data[email]) db.data[email] = { favorites: [], history: [] };
    if (!db.profiles[email]) db.profiles[email] = { avatar: '', banner: '', bio: 'Admin Kumanime' };
    if (!db.friends[email]) db.friends[email] = { requests: [], list: [] };
    writeDB(db);
  }

  if (!user) return ApiResponse.error(res, 'Gmail atau password salah', 401);
  const role = (email === ADMIN_EMAIL) ? 'admin' : (user.role || 'user');
  ApiResponse.success(res, { email, role }, 'Login berhasil');
});

// --- API USER DATA & PROFILE ---
app.get('/api/user/:email/data', (req, res) => {
  const { email } = req.params;
  const db = readDB();
  if (!db.data[email]) db.data[email] = { favorites: [], history: [] };
  if (!db.profiles[email]) db.profiles[email] = { avatar: '', banner: '', bio: '' };
  if (!db.friends[email]) db.friends[email] = { requests: [], list: [] };
  const role = (email === ADMIN_EMAIL) ? 'admin' : 'user';
  ApiResponse.success(res, { 
    ...db.data[email], 
    profile: db.profiles[email],
    friends: db.friends[email],
    role 
  }, 'Data user dimuat');
});

app.post('/api/user/:email/data', (req, res) => {
  const { email } = req.params;
  const { favorites, history, profile } = req.body;
  const db = readDB();
  if (favorites) db.data[email].favorites = favorites;
  if (history) db.data[email].history = history;
  if (profile) db.profiles[email] = profile;
  writeDB(db);
  ApiResponse.success(res, db.data[email], 'Data berhasil disimpan');
});

// --- API FRIENDS SYSTEM ---
app.post('/api/friends/request', (req, res) => {
  const { sender, receiver } = req.body;
  const db = readDB();
  if (!db.users.some(u => u.email === receiver)) {
    return ApiResponse.error(res, 'Email teman tidak ditemukan', 404);
  }
  if (sender === receiver) return ApiResponse.error(res, 'Tidak bisa menambah diri sendiri', 400);
  
  if (!db.friends[receiver]) db.friends[receiver] = { requests: [], list: [] };
  if (db.friends[receiver].list.includes(sender)) return ApiResponse.error(res, 'Sudah berteman', 400);
  if (db.friends[receiver].requests.includes(sender)) return ApiResponse.error(res, 'Permintaan sudah dikirim sebelumnya', 400);

  db.friends[receiver].requests.push(sender);
  writeDB(db);
  ApiResponse.success(res, {}, 'Permintaan pertemanan terkirim');
});

app.post('/api/friends/accept', (req, res) => {
  const { user, friend } = req.body;
  const db = readDB();
  if (!db.friends[user]) db.friends[user] = { requests: [], list: [] };
  if (!db.friends[friend]) db.friends[friend] = { requests: [], list: [] };

  db.friends[user].requests = db.friends[user].requests.filter(e => e !== friend);
  if (!db.friends[user].list.includes(friend)) db.friends[user].list.push(friend);
  if (!db.friends[friend].list.includes(user)) db.friends[friend].list.push(user);

  writeDB(db);
  ApiResponse.success(res, {}, 'Pertemanan diterima');
});

app.get('/api/users/all', (req, res) => {
  const db = readDB();
  const list = db.users.map(u => ({
    email: u.email,
    profile: db.profiles[u.email] || {}
  }));
  ApiResponse.success(res, list, 'Semua user');
});

// --- API ADMIN ---
app.get('/api/admin/users', (req, res) => {
  const db = readDB();
  ApiResponse.success(res, db.users.map(u => ({ email: u.email, role: u.role, createdAt: u.createdAt })), 'Daftar user');
});

// --- API ANIME ---
app.get('/api/home', async (req, res, next) => {
  try { ApiResponse.success(res, await scraper.home(), 'Home fetched'); } catch (e) { next(e); }
});
app.get('/api/search', async (req, res, next) => {
  try { ApiResponse.success(res, await scraper.search(req.query.q), 'Search fetched'); } catch (e) { next(e); }
});
app.get('/api/anime/:slug', async (req, res, next) => {
  try { ApiResponse.success(res, await scraper.detail(req.params.slug), 'Detail fetched'); } catch (e) { next(e); }
});
app.get('/api/episode/:slug', async (req, res, next) => {
  try { ApiResponse.success(res, await scraper.episode(req.params.slug), 'Episode fetched'); } catch (e) { next(e); }
});

// --- SOCKET.IO (PUBLIC CHAT & NOBAR ROOMS - MAX 5 USERS) ---
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Public Chat
  socket.on('load_public_chat', () => {
    const db = readDB();
    socket.emit('public_chat_history', db.publicChat);
  });

  socket.on('send_public_message', (msg) => {
    const db = readDB();
    const chatItem = { email: msg.email, text: msg.text, time: new Date().toLocaleTimeString() };
    db.publicChat.push(chatItem);
    if (db.publicChat.length > 100) db.publicChat.shift();
    writeDB(db);
    io.emit('new_public_message', chatItem);
  });

  // Nobar Watch Party (Max 5 users per room)
  socket.on('join_nobar_room', ({ roomCode, email }) => {
    const room = io.sockets.adapter.rooms.get(roomCode);
    const count = room ? room.size : 0;
    if (count >= 5) {
      socket.emit('nobar_error', 'Room Nobar sudah penuh! Maksimal 5 orang.');
      return;
    }
    socket.join(roomCode);
    socket.to(roomCode).emit('nobar_notification', `${email} bergabung ke room Nobar.`);
    socket.emit('nobar_joined', roomCode);
  });

  socket.on('nobar_action', ({ roomCode, action, data }) => {
    socket.to(roomCode).emit('nobar_sync', { action, data });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = config.port;
server.listen(PORT, () => {
  console.log(`Kumanime Platform running on http://localhost:${PORT}`);
});