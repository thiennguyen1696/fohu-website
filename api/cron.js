// Chạy mỗi ngày (vercel.json): (1) hạ gói đã hết hạn về Free, (2) xóa Daily quá 24 giờ cùng file trên R2.
const { DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { init } = require('./_admin');
const { s3 } = require('./_lib');

module.exports = async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'auth' });
  try {
    const { db, admin } = init();
    // 1) Gói hết hạn
    const ex = await db.collection('users').where('planUntil', '<', admin.firestore.Timestamp.now()).limit(400).get();
    const b1 = db.batch();
    ex.docs.forEach((d) => b1.update(d.ref, { plan: 'free', planUntil: admin.firestore.FieldValue.delete() }));
    if (!ex.empty) await b1.commit();

    // 2) Daily quá 24 giờ
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 3600 * 1000);
    const old = await db.collection('dailies').where('at', '<', cutoff).limit(400).get();
    const base = (process.env.R2_PUBLIC_URL || '') + '/';
    const keys = [];
    old.docs.forEach((d) => { const x = d.data(); [x.media, x.thumb].forEach((u) => { if (typeof u === 'string' && u.startsWith(base)) keys.push(u.slice(base.length)); }); });
    if (keys.length) await s3.send(new DeleteObjectsCommand({ Bucket: process.env.R2_BUCKET, Delete: { Objects: keys.slice(0, 1000).map((Key) => ({ Key })) } }));
    const b2 = db.batch();
    old.docs.forEach((d) => b2.delete(d.ref));
    if (!old.empty) await b2.commit();

    res.status(200).json({ expiredPlans: ex.size, deletedDailies: old.size });
  } catch (e) {
    console.error('cron', e);
    res.status(500).json({ error: 'server' });
  }
};
