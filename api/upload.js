// Cấp link tải ảnh/video (kèm ảnh thu nhỏ) lên Cloudflare R2. Giới hạn video theo gói.
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const { s3, verify, plan, countPosts, countDailies } = require('./_lib');

// Giới hạn tổng số ảnh / video đang lưu theo gói
const LIMIT = { free: { photo: 5, video: 0 }, standard: { photo: 10, video: 3, monthly: true }, premium: { photo: Infinity, video: 9 } };
const VEXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const MAX_VIDEO = 100 * 1024 * 1024, MAX_IMAGE = 8 * 1024 * 1024, MAX_THUMB = 1024 * 1024;
const sign = (Key, ContentType, ContentLength) => getSignedUrl(s3,
  new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key, ContentType, ContentLength }), { expiresIn: 300 });

module.exports = async (req, res) => {
  let step = 'start'; // bước đang chạy, trả về khi lỗi để biết chính xác hỏng ở đâu
  try {
    if (req.method === 'GET' && req.query && req.query.check) {
      // Kiểm tra cấu hình R2 (không lộ giá trị bí mật): mở https://<tên miền>/api/upload?check=1
      const out = {};
      ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL', 'FIREBASE_API_KEY'].forEach((k) => { out[k] = !!process.env[k]; });
      out.publicUrlFormat = /^https:\/\/[^/]+$/.test(process.env.R2_PUBLIC_URL || '') ? 'ok' : 'sai (phải dạng https://ten-mien, không có / ở cuối)';
      try { await sign('check/test.mp4', 'video/mp4', 1000); out.sign = 'ok'; } catch (e) { out.sign = String(e.message).slice(0, 100); }
      try { // thử ghi và xóa một tệp nhỏ để xác nhận khóa R2 có quyền Read & Write
        await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: 'check/ping.txt', Body: 'ok', ContentType: 'text/plain' }));
        await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: 'check/ping.txt' }));
        out.r2Write = 'ok';
      } catch (e) { out.r2Write = String(e.name + ': ' + e.message).slice(0, 140); }
      return res.status(200).json(out);
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    step = 'verify';
    const a = await verify(req);
    if (!a) return res.status(401).json({ error: 'auth' });

    const { type, size, thumbSize = 0, count = 1, kind } = req.body || {};
    const daily = kind === 'daily'; // ảnh/video Daily (24 giờ): không tính vào hạn mức bài đăng
    const cnt = Math.min(Math.max(parseInt(count) || 1, 1), 10); // số ảnh trong bài đăng này
    const isVid = !!VEXT[type], isImg = type === 'image/jpeg';
    if (!isVid && !isImg) return res.status(400).json({ error: 'type' });
    if (!Number.isInteger(size) || size <= 0 || size > (isVid ? MAX_VIDEO : MAX_IMAGE)) return res.status(400).json({ error: 'size' });
    if (!Number.isInteger(thumbSize) || thumbSize < 0 || thumbSize > MAX_THUMB) return res.status(400).json({ error: 'thumb' });

    step = 'plan';
    const L = LIMIT[await plan(a)] || LIMIT.free;
    step = 'count';
    if (daily) {
      if ((await countDailies(a)) >= 10) return res.status(403).json({ error: 'daily-limit' });
    } else if (isVid) {
      if (L.video === 0) return res.status(403).json({ error: 'plan-free' });
      if ((await countPosts(a, true)).n >= L.video) return res.status(403).json({ error: 'limit' });
    } else if (L.photo !== Infinity) {
      const ym = L.monthly ? new Date().toISOString().slice(0, 7) : undefined; // Standard: tính theo tháng (UTC)
      const [all, vid] = await Promise.all([countPosts(a, false, ym), countPosts(a, true, ym)]);
      const photos = all.n - vid.n + all.x; // mỗi ảnh trong bài nhiều ảnh tính 1
      if (photos + cnt > L.photo) return res.status(403).json({ error: L.monthly ? 'photo-limit-month' : 'photo-limit' });
    }

    step = 'sign';
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const key = daily ? `daily/${a.uid}/${id}.${isVid ? VEXT[type] : 'jpg'}`
      : isVid ? `videos/${a.uid}/${id}.${VEXT[type]}` : `images/${a.uid}/${id}.jpg`;
    const out = { url: await sign(key, type, size), publicUrl: `${process.env.R2_PUBLIC_URL}/${key}` };
    if (thumbSize > 0) {
      const tk = `images/${a.uid}/${id}_t.jpg`;
      out.thumbUrl = await sign(tk, 'image/jpeg', thumbSize);
      out.thumbPublicUrl = `${process.env.R2_PUBLIC_URL}/${tk}`;
    }
    res.status(200).json(out);
  } catch (e) {
    console.error('upload', step, e);
    res.status(500).json({ error: 'server', step, detail: String((e && e.message) || e).slice(0, 140) });
  }
};
