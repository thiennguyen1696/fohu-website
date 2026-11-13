// Gợi ý địa điểm từ Google Maps (Places API mới) cho tính năng check-in.
// Khóa Google nằm trong biến môi trường GOOGLE_MAPS_API_KEY trên Vercel, không bao giờ gửi xuống trình duyệt.
const { verify } = require('./_lib');

const AUTOCOMPLETE = 'https://places.googleapis.com/v1/places:autocomplete';
const MASK = 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat';
const LIMIT = { n: 40, ms: 10 * 60 * 1000 };   // mỗi người tối đa 40 lượt tìm / 10 phút (tính theo từng phiên bản máy chủ)
const hits = new Map();

async function suggest(key, q) {
  const r = await fetch(AUTOCOMPLETE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': MASK },
    body: JSON.stringify({ input: q, languageCode: 'vi', regionCode: 'VN', includedRegionCodes: ['vn'] }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

module.exports = async (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  // Chẩn đoán nhanh: chỉ cho biết đã khai báo khóa hay chưa (không gọi Google, không lộ khóa)
  if (req.method === 'GET' && req.query && req.query.check === '1') return res.status(200).json({ keyConfigured: !!key });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    const a = await verify(req);
    if (!a) return res.status(401).json({ error: 'auth' });
    if (!key) return res.status(200).json({ error: 'no-key' });
    const q = String((req.body || {}).q || '').trim().slice(0, 100);
    if (q.length < 2) return res.status(200).json({ items: [] });

    const now = Date.now(), arr = (hits.get(a.uid) || []).filter((t) => now - t < LIMIT.ms);
    if (arr.length >= LIMIT.n) return res.status(429).json({ error: 'rate' });
    arr.push(now); hits.set(a.uid, arr);
    if (hits.size > 5000) hits.clear();

    const r = await suggest(key, q);
    if (!r.ok) return res.status(200).json({ error: 'google-' + r.status, detail: String((r.j.error && r.j.error.message) || '').slice(0, 160) });
    const items = (r.j.suggestions || []).map((x) => x.placePrediction).filter(Boolean).slice(0, 8).map((p) => ({
      id: p.placeId,
      name: (p.structuredFormat && p.structuredFormat.mainText && p.structuredFormat.mainText.text) || (p.text && p.text.text) || '',
      addr: (p.structuredFormat && p.structuredFormat.secondaryText && p.structuredFormat.secondaryText.text) || '',
    }));
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(200).json({ error: 'server' });
  }
};
