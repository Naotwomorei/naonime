const express = require('express');
const router = express.Router();
const axios = require('axios');

const PYTHON_URL = 'http://127.0.0.1:5000';

router.get('/home', async (req, res) => {
  try {
    const response = await axios.get(`${PYTHON_URL}/`);
    let rawItems = [];
    const resData = response.data;
    
    if (resData.results && Array.isArray(resData.results)) {
      resData.results.forEach(sec => {
        if (sec.cards && Array.isArray(sec.cards)) rawItems.push(...sec.cards);
      });
    } else if (Array.isArray(resData)) {
      rawItems = resData;
    } else if (resData.data && Array.isArray(resData.data)) {
      rawItems = resData.data;
    }

    const items = rawItems.map(item => {
      let posterUrl = item.thumbnail || item.poster || item.image || item.img || item.thumb || item.cover || '';
      if (posterUrl && posterUrl.startsWith('/')) posterUrl = `https://anichin.moe${posterUrl}`;
      return {
        title: item.title || item.judul,
        url: item.url || item.link,
        poster: posterUrl,
        episode: item.eps ? `Ep ${item.eps}` : (item.episode || item.ep || 'Donghua'),
        source: 'anichin'
      };
    });

    res.json({ success: true, data: { items } });
  } catch (e) {
    res.json({ success: true, data: { items: [] }, message: 'Server Python Anichin belum aktif' });
  }
});

router.get('/detail', async (req, res) => {
  try {
    let cleanUrl = req.query.url.trim().replace(/\/+$/, '');
    const parts = cleanUrl.split('/').filter(Boolean);
    let slug = parts[parts.length - 1] || cleanUrl;

    const aniRes = await axios.get(`${PYTHON_URL}/${slug}`);
    const raw = aniRes.data.result || aniRes.data.data || aniRes.data;
    
    let sinopsisText = '';
    if (raw.sinopsis) {
      sinopsisText = typeof raw.sinopsis === 'string' ? raw.sinopsis : (raw.sinopsis.paragraphs ? raw.sinopsis.paragraphs.join('\n') : '');
    } else if (raw.synopsis) {
      sinopsisText = raw.synopsis;
    }

    let posterUrl = raw.thumbnail || raw.poster || raw.image || raw.thumb || raw.cover || '';
    if (posterUrl && posterUrl.startsWith('/')) posterUrl = `https://anichin.moe${posterUrl}`;

    res.json({
      success: true,
      data: {
        title: raw.name || raw.title || raw.judul,
        poster: posterUrl,
        sinopsis: sinopsisText,
        episodes: (raw.episode || raw.episodes || []).map(ep => ({
          title: ep.subtitle || ep.title || ep.judul || `Episode ${ep.episode}`,
          url: ep.slug ? `https://anichin.moe/${ep.slug}/` : (ep.url || req.query.url)
        })),
        source: 'anichin'
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal memuat detail donghua' });
  }
});

router.get('/episode', async (req, res) => {
  try {
    let cleanUrl = req.query.url.trim().replace(/\/+$/, '');
    const parts = cleanUrl.split('/').filter(Boolean);
    let slug = parts[parts.length - 1] || cleanUrl;
    
    const aniRes = await axios.get(`${PYTHON_URL}/episode/${slug}`);
    const raw = aniRes.data.result || aniRes.data.data || aniRes.data || {};
    
    let streams = {};
    if (raw.players && Array.isArray(raw.players)) {
      raw.players.forEach(p => { streams[p.name || 'Default'] = p.url; });
    } else if (raw.downloads && Array.isArray(raw.downloads)) {
      raw.downloads.forEach(d => { streams[d.resolution || 'Default'] = d.url; });
    } else {
      streams['Default Stream'] = req.query.url;
    }

    let posterUrl = raw.thumbnail || raw.poster || raw.image || raw.thumb || raw.cover || '';
    if (posterUrl && posterUrl.startsWith('/')) posterUrl = `https://anichin.moe${posterUrl}`;

    res.json({
      success: true,
      data: {
        title: raw.name || raw.title || raw.judul || 'Streaming Donghua',
        poster: posterUrl,
        sinopsis: raw.sinopsis || raw.synopsis || 'Tidak ada sinopsis.',
        streams
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal memuat episode donghua' });
  }
});

module.exports = router;