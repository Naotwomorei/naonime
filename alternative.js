const express = require('express');
const router = express.Router();
const https = require('https');
const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://samehadaku.vip'; // Atau situs alternatif yang stabil
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchHTML(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 30000,
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
  });
  return res.data;
}

// 1. HOME ALTERNATIF
router.get('/home', async (req, res) => {
  try {
    const $ = cheerio.load(await fetchHTML(BASE_URL));
    const items = [];
    $('.post-show, .animpost').each((i, el) => {
      const $el =$(el);
      const link = $el.find('a').attr('href');
      const title = $el.find('h2, .title').text().trim();
      const poster = $el.find('img').attr('src') || $el.find('img').attr('data-src');
      const episode = $el.find('.episode, .tute').text().trim();
      
      if (link && title) {
        items.push({
          title,
          url: link,
          poster: poster || null,
          episode: episode || 'Update',
          source: 'alternative'
        });
      }
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal memuat alternatif' });
  }
});

// 2. DETAIL ALTERNATIF
router.get('/detail', async (req, res) => {
  try {
    const $ = cheerio.load(await fetchHTML(req.query.url));
    const episodes = [];
    
    $('.lister-episod li, .episodelist ul li').each((i, el) => {
      const $a =$(el).find('a');
      const title = $a.text().trim();
      const href = $a.attr('href');
      if (href && title) episodes.push({ title, url: href });
    });

    res.json({
      success: true,
      data: {
        title: $('.entry-title, .info-content h1').text().trim() || 'Detail Anime',
        poster: $('.fotoanime img, .thumb img').attr('src') || null,
        sinopsis: $('.entry-content p, .desc').text().trim() || 'Tidak ada sinopsis.',
        episodes,
        source: 'alternative'
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal memuat detail alternatif' });
  }
});

// 3. STREAMING EPISODE ALTERNATIF (Langsung ke Link Valid)
router.get('/episode', async (req, res) => {
  try {
    const html = await fetchHTML(req.query.url);
    const $ = cheerio.load(html);
    const streams = {};

    // Ambil link streaming / download yang langsung mengarah ke server luar (Mega/Zippy/StreamSB/dll)
    $('a.download-link, .player-option, .server-dropdown a, iframe').each((i, el) => {
      const $el =$(el);
      let name = $el.text().trim() || `Server ${i + 1}`;
      let href = $el.attr('href') || $el.attr('src') || $el.attr('data-video');
      
      if (href && href.startsWith('http')) {
        streams[name] = href;
      }
    });

    res.json({
      success: true,
      data: {
        title: $('h1.entry-title, .post-title').text().trim() || 'Streaming',
        streams: Object.keys(streams).length > 0 ? streams : { 'Buka Sumber Asli': req.query.url }
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal memuat streaming alternatif' });
  }
});

module.exports = router;