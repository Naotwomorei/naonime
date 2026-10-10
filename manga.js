const express = require('express');
const router = express.Router();
const https = require('https');
const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://shinigami.id';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchHTML(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 30000,
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
  });
  return res.data;
}

router.get('/detail', async (req, res) => {
  try {
    const $ = cheerio.load(await fetchHTML(req.query.url));
    const chapters = [];
    $('.episil li, .cl-list li').each((i, el) => {
      const $a = $(el).find('a');
      const title = $a.text().trim();
      const href = $a.attr('href');
      if (href && title) chapters.push({ title, url: href });
    });
    res.json({
      success: true,
      data: {
        title: $('.infox h1, .entry-title').text().trim() || 'Komik Detail',
        poster: $('.thumb img').attr('src') || null,
        sinopsis: $('.entry-content p').text().trim() || null,
        episodes: chapters,
        source: 'shinigami'
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal memuat manga' });
  }
});

router.get('/chapter', async (req, res) => {
  try {
    const $ = cheerio.load(await fetchHTML(req.query.url));
    const images = [];
    $('.read-container img, .rd-container img').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src) images.push(src);
    });
    res.json({ success: true, data: { title: $('h1.entry-title').text().trim() || 'Reader', images } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal memuat chapter manga' });
  }
});

module.exports = router;