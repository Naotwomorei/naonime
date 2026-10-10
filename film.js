const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://tv9.gf21.fun';

// 1. HOME / FILM TERBARU
router.get('/home', async (req, res) => {
  try {
    const response = await axios.get(BASE_URL, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': BASE_URL
      }
    });
    const $ = cheerio.load(response.data);
    const items = [];

    $('.item.movies, article.item, article').each((i, el) => {
      const $el = $(el);
      const title = $el.find('h3.title, h2, .title, .judul').text().trim();
      const url = $el.find('a').attr('href');
      const $img = $el.find('img');
      
      // Menangkap link gambar dari berbagai macam atribut lazy-load yang sering dipakai situs film
      let poster = $img.attr('data-lazy-loaded') || 
                   $img.attr('data-src') || 
                   $img.attr('data-original') || 
                   $img.attr('src');

      // Jika masih berupa placeholder base64, coba cari dari atribut lain atau srcset
      if (poster && (poster.startsWith('data:image') || poster.includes('pixel'))) {
        poster = $img.attr('data-lazy-loaded') || $img.attr('data-src') || $img.attr('data-original');
      }

      const quality = $el.find('.quality, .resin, .hd').text().trim() || 'HD';

      if (title && url) {
        items.push({
          title,
          url: url.startsWith('http') ? url : BASE_URL + url,
          poster: poster || '',
          episode: quality,
          source: 'film'
        });
      }
    });

    res.json({ success: true, data: { items } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal memuat data film' });
  }
});

module.exports = router;