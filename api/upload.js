// Cấp link tải ảnh/video (kèm ảnh thu nhỏ) lên Cloudflare R2. Giới hạn video theo gói.
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const { s3, verify, plan, countPosts } = require('./_lib');

// Giới hạn tổng số ảnh / video đang lưu theo gói
const LIMIT = { free: { photo: 5, video: 0 }, standard: { photo: 10, video: 3, monthly: true }, premium: { photo: Infinity, video: 9 } };
const VEXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const MAX_VIDEO = 100 * 1024 * 1024, MAX_IMAGE = 8 * 1024 * 1024, MAX_THUMB = 1024 * 1024;
const sign = (Key, ContentType, ContentLength) => getSignedUrl(s3,
  new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key, ContentType, ContentLength }), { expiresIn: 300 });

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    const a = await verify(req);
    if (!a) return res.status(401).json({ error: 'auth' });

    const { type, size, thumbSize = 0, count = 1 } = req.body || {};
    const cnt = Math.min(Math.max(parseInt(count) || 1, 1), 10); // số ảnh trong bài đăng này
    const isVid = !!VEXT[type], isImg = type === 'image/jpeg';
    if (!isVid && !isImg) return res.status(400).json({ error: 'type' });
    if (!Number.isInteger(size) || size <= 0 || size > (isVid ? MAX_VIDEO : MAX_IMAGE)) return res.status(400).json({ error: 'size' });
    if (!Number.isInteger(thumbSize) || thumbSize < 0 || thumbSize > MAX_THUMB) return res.status(400).json({ error: 'thumb' });

    const L = LIMIT[await plan(a)] || LIMIT.free;
    if (isVid) {
      if (L.video === 0) return res.status(403).json({ error: 'plan-free' });
      if ((await countPosts(a, true)).n >= L.video) return res.status(403).json({ error: 'limit' });
    } else if (L.photo !== Infinity) {
      const ym = L.monthly ? new Date().toISOString().slice(0, 7) : undefined; // Standard: tính theo tháng (UTC)
      const [all, vid] = await Promise.all([countPosts(a, false, ym), countPosts(a, true, ym)]);
      const photos = all.n - vid.n + all.x; // mỗi ảnh trong bài nhiều ảnh tính 1
      if (photos + cnt > L.photo) return res.status(403).json({ error: L.monthly ? 'photo-limit-month' : 'photo-limit' });
    }

    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const key = isVid ? `videos/${a.uid}/${id}.${VEXT[type]}` : `images/${a.uid}/${id}.jpg`;
    const out = { url: await sign(key, type, size), publicUrl: `${process.env.R2_PUBLIC_URL}/${key}` };
    if (thumbSize > 0) {
      const tk = `images/${a.uid}/${id}_t.jpg`;
      out.thumbUrl = await sign(tk, 'image/jpeg', thumbSize);
      out.thumbPublicUrl = `${process.env.R2_PUBLIC_URL}/${tk}`;
    }
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
};
