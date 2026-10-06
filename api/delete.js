// Xóa file trên R2 khi người dùng xóa bài (chỉ xóa được file của chính mình)
const { DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { s3, verify } = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    const a = await verify(req);
    if (!a) return res.status(401).json({ error: 'auth' });
    const keys = (req.body?.keys || []).filter(k => typeof k === 'string' && !k.includes('..')
      && (k.startsWith(`images/${a.uid}/`) || k.startsWith(`videos/${a.uid}/`) || k.startsWith(`daily/${a.uid}/`))).slice(0, 6);
    if (!keys.length) return res.status(200).json({ deleted: 0 });
    await s3.send(new DeleteObjectsCommand({ Bucket: process.env.R2_BUCKET, Delete: { Objects: keys.map(Key => ({ Key })) } }));
    res.status(200).json({ deleted: keys.length });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
};
