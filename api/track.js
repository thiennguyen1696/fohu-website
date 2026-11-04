// Ghi nhận lượt xem trang ẩn danh để thống kê (hiện trong Quản trị → Tổng quan).
// Không lưu IP, tên, email. Chỉ đếm theo ngày: lượt xem, khách truy cập, thiết bị, nguồn, trang.
const { init } = require('./_admin');

const ROUTES = new Set(['home', 'about', 'privacy', 'terms', 'support', 'partner', 'orders', 'inbox', 'settings', 'me', 'profile']);
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|lighthouse|headless|curl|wget|python-requests|httpclient/i;
const vnDay = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);

const device = (ua) => (/iPad|Tablet|PlayStation/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) ? 'tablet' : (/Mobi|Android|iPhone|iPod/i.test(ua) ? 'mobile' : 'desktop');
const source = (host) => {
  const h = String(host || '').toLowerCase();
  if (!h || /(^|\.)fohu\.asia$/.test(h)) return 'direct';
  if (/google\./.test(h)) return 'google';
  if (/facebook\.|fb\.com|fb\.me|l\.messenger/.test(h)) return 'facebook';
  if (/zalo\./.test(h)) return 'zalo';
  if (/tiktok\./.test(h)) return 'tiktok';
  if (/youtube\.|youtu\.be/.test(h)) return 'youtube';
  if (/instagram\./.test(h)) return 'instagram';
  if (/bing\./.test(h)) return 'bing';
  if (/coccoc\./.test(h)) return 'coccoc';
  return 'other';
};

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    const ua = String(req.headers['user-agent'] || '');
    if (BOT.test(ua)) return res.status(204).end();
    const b = req.body || {};
    const p = String(b.p || ''), v = String(b.v || '');
    if (!ROUTES.has(p) || !/^[A-Za-z0-9]{8,32}$/.test(v)) return res.status(204).end();

    const { db, admin } = init();
    const inc = admin.firestore.FieldValue.increment, day = vnDay(Date.now());
    let first = true; // khách này lần đầu xuất hiện trong ngày?
    try { await db.doc(`vis/${day}_${v}`).create({ t: admin.firestore.Timestamp.now() }); } catch (e) { first = false; }

    await db.doc(`stats/${day}`).set({
      views: inc(1),
      uv: inc(first ? 1 : 0),
      nv: inc(first && b.n ? 1 : 0),
      dev: { [device(ua)]: inc(1) },
      ref: b.r ? { [source(b.r)]: inc(1) } : {},
      path: { [p]: inc(1) },
      auth: { [b.a ? 'in' : 'out']: inc(1) },
    }, { merge: true });
    return res.status(204).end();
  } catch (e) {
    return res.status(204).end(); // thống kê lỗi không được ảnh hưởng người dùng
  }
};
