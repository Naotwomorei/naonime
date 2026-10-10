const express = require('express');
const router = express.Router();
const https = require('https');
const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://otakudesu.blog';

class RequestHandler {
  constructor() {
    this.uaIndex = 0;
  }
  delay(min = 300, max = 800) {
    return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
  }
  getHeaders(ref = BASE_URL) {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
      'Referer': ref || BASE_URL,
      'Connection': 'keep-alive'
    };
  }
  async request(method, url, data = null, headers = {}, retries = 5) {
    let lastError = null;
    for (let i = 0; i < retries; i++) {
      try {
        await this.delay();
        const response = await axios({
          method, url, headers, data,
          timeout: 30000,
          httpsAgent: new https.Agent({ rejectUnauthorized: false, keepAlive: true }),
          maxRedirects: 5,
          validateStatus: status => status >= 200 && status < 400
        });
        return response;
      } catch (error) {
        lastError = error;
        if (i < retries - 1) await this.delay(1500, 4000);
      }
    }
    throw lastError;
  }
  async fetchHTML(url, retries = 5) {
    const response = await this.request('GET', url, null, this.getHeaders(url), retries);
    return response.data;
  }
  async postAjax(payload, retries = 5) {
    const params = new URLSearchParams(payload);
    const url = `${BASE_URL}/wp-admin/admin-ajax.php`;
    const headers = {
      ...this.getHeaders(BASE_URL),
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    const response = await this.request('POST', url, params.toString(), headers, retries);
    return response.data;
  }
}

class OtakudesuScraper {
  constructor() {
    this.base = BASE_URL;
    this.requestHandler = new RequestHandler();
  }
  parseCardDetpost($, element) {
    const $el =$(element);
    const link = $el.find('.thumb a').attr('href');
    const title = $el.find('.jdlflm').text().trim();
    if (!link || !title) return null;
    return {
      title,
      url: link.startsWith('http') ? link : this.base + link,
      poster: $el.find('.thumbz img').attr('src') || null,
      episode: $el.find('.epz').text().trim() || null,
      status: $el.find('.epztipe').text().trim() || null,
      source: 'otakudesu'
    };
  }
  parseEpisodeList($) {
    const episodes = [];
    $('.episodelist ul li').each((i, el) => {
      const $a =$(el).find('a');
      const title = $a.text().trim();
      const href = $a.attr('href');
      if (href && title) {
        episodes.push({ title, url: href.startsWith('http') ? href : this.base + href });
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
      const $a =$(a);
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
  async detail(slug) {
    const $ = cheerio.load(await this.requestHandler.fetchHTML(`${this.base}/anime/${slug}/`));
    return {
      title: $('.jdlrx h1').text().trim() || $('title').text().trim(),
      poster: $('.fotoanime img').attr('src') || null,
      sinopsis: $('.sinopc p').text().trim() || null,
      episodes: this.parseEpisodeList($),
      source: 'otakudesu'
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

router.get('/home', async (req, res) => {
  try { res.json({ success: true, data: await scraper.home() }); } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/detail/:slug', async (req, res) => {
  try { res.json({ success: true, data: await scraper.detail(req.params.slug) }); } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/episode/:slug', async (req, res) => {
  try { res.json({ success: true, data: await scraper.episode(req.params.slug) }); } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;