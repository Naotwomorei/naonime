const express = require('express');
const router = express.Router();
const axios = require('axios');

const API_BASE = 'https://mangamint.kaedenoki.net/api';

// 1. MANGA TERBARU / HOME
router.get('/home', async (req, res) => {
  try {
    const response = await axios.get(`${API_BASE}/manga/page/1`);
    res.json({ success: true, data: response.data });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal memuat manga terbaru' });
  }
});

// 2. PENCARIAN MANGA
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ success: true, data: { items: [] } });

    const response = await axios.get(`${API_BASE}/search/${encodeURIComponent(q)}`);
    const results = response.data.manga_list || [];
    
    const items = results.map(item => ({
      title: item.title,
      url: item.endpoint,
      poster: item.thumb,
      episode: item.chapter || item.type || 'Update',
      source: 'mangaku'
    }));

    res.json({ success: true, data: { items } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal mencari manga' });
  }
});

// 3. DETAIL MANGA
router.get('/detail', async (req, res) => {
  try {
    let mangaEndpoint = req.query.url;
    if (!mangaEndpoint) return res.status(400).json({ success: false, message: 'URL tidak valid' });

    if (mangaEndpoint.includes('/manga/')) {
      mangaEndpoint = mangaEndpoint.split('/manga/').pop().replace(/\/$/, '');
    }

    const response = await axios.get(`${API_BASE}/manga/detail/${mangaEndpoint}`);
    const data = response.data;

    const chapters = (data.chapter || []).map(ch => ({
      title: ch.chapter_title || ch.title,
      url: ch.chapter_endpoint || ch.endpoint
    }));

    res.json({
      success: true,
      data: {
        title: data.title,
        poster: data.thumb,
        sinopsis: data.synopsis || 'Tidak ada sinopsis.',
        episodes: chapters,
        source: 'mangaku'
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal memuat detail manga' });
  }
});

module.exports = router;