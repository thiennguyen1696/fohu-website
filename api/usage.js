// Trả về số ảnh/video người dùng đã đăng (để hiện "Đã đăng: x/y" và kiểm tra trước khi tải lên).
// Tính ở máy chủ nên không cần tạo chỉ mục Firestore.
const { verify, plan, countPosts } = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    const a = await verify(req);
    if (!a) return res.status(401).json({ error: 'auth' });
    const p = await plan(a), ym = new Date().toISOString().slice(0, 7);
    const v = await countPosts(a, true);
    const out = { videos: v.n, photos: null, monthPhotos: null }; // Premium: ảnh không giới hạn nên không cần đếm
    if (p === 'free') { const all = await countPosts(a, false); out.photos = all.n - v.n + all.x; }
    else if (p === 'standard') {
      const [m, mv] = await Promise.all([countPosts(a, false, ym), countPosts(a, true, ym)]);
      out.monthPhotos = m.n - mv.n + m.x;
    }
    res.status(200).json(out);
  } catch (e) {
    console.error('usage', e);
    res.status(500).json({ error: 'server' });
  }
};
