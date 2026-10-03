// Vercel serverless: cấp link tải video lên Cloudflare R2 (chỉ cho người đã đăng nhập Firebase)
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED',
});
const EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const MAX = 100 * 1024 * 1024; // 100MB

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const tok = (req.headers.authorization || '').replace('Bearer ', '');
  if (!tok) return res.status(401).json({ error: 'no-token' });

  // Xác thực Firebase ID token
  const v = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: tok }),
  });
  const uid = v.ok ? (await v.json()).users?.[0]?.localId : null;
  if (!uid) return res.status(401).json({ error: 'bad-token' });

  const { type, size } = req.body || {};
  if (!EXT[type]) return res.status(400).json({ error: 'type' });
  if (!Number.isInteger(size) || size <= 0 || size > MAX) return res.status(400).json({ error: 'size' });

  const key = `videos/${uid}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${EXT[type]}`;
  const url = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: process.env.R2_BUCKET, Key: key, ContentType: type, ContentLength: size,
  }), { expiresIn: 300 });
  res.status(200).json({ url, publicUrl: `${process.env.R2_PUBLIC_URL}/${key}` });
};
