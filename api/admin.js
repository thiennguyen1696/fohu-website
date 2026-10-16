// Trang quản trị: duyệt hồ sơ xác minh đối tác (xem ảnh CCCD, duyệt/từ chối).
// Chỉ các email trong biến môi trường ADMIN_EMAILS (cách nhau bằng dấu phẩy) mới dùng được.
const { init } = require('./_admin');
const { verify } = require('./_lib');

const isAdmin = (a) => {
  const list = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  return !!a && !!a.email && a.emailVerified && list.includes(a.email.toLowerCase());
};
const ID = /^[A-Za-z0-9_-]{6,128}$/;

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    const a = await verify(req);
    if (!a) return res.status(401).json({ error: 'auth' });
    const { action, id, status, decision, reason } = req.body || {};
    if (action === 'me') return res.status(200).json({ admin: isAdmin(a) });
    if (!isAdmin(a)) return res.status(403).json({ error: 'forbidden' });

    const { db, admin } = init();
    const brief = (x, u) => ({ plan: x.plan, phone: x.phone, addr: x.addr, status: x.status, reason: x.reason || '',
      at: x.at && x.at.toMillis ? x.at.toMillis() : 0,
      user: { name: u.name, email: u.email, username: u.username, plan: u.plan, kyc: !!u.kyc } });

    if (action === 'list') {
      const st = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
      const snap = await db.collection('partnerRequests').where('status', '==', st).limit(50).get();
      const us = snap.empty ? [] : await db.getAll(...snap.docs.map((d) => db.doc(`users/${d.id}`)));
      const items = snap.docs.map((d, i) => ({ id: d.id, ...brief(d.data(), us[i].data() || {}) })).sort((p, q) => q.at - p.at);
      return res.status(200).json({ items });
    }

    if (!ID.test(String(id || ''))) return res.status(400).json({ error: 'id' });

    if (action === 'get') {
      const d = await db.doc(`partnerRequests/${id}`).get();
      if (!d.exists) return res.status(404).json({ error: 'notfound' });
      const x = d.data(), u = (await db.doc(`users/${id}`).get()).data() || {};
      return res.status(200).json({ id, ...brief(x, u), front: x.front || '', back: x.back || '' });
    }

    if (action === 'review') {
      if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'decision' });
      const why = String(reason || '').trim().slice(0, 200);
      if (decision === 'reject' && !why) return res.status(400).json({ error: 'reason' });
      const ref = db.doc(`partnerRequests/${id}`), snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'notfound' });
      if (snap.data().status !== 'pending') return res.status(409).json({ error: 'conflict' });
      const ts = admin.firestore.FieldValue.serverTimestamp(), del = admin.firestore.FieldValue.delete();
      const b = db.batch();
      // Xóa ảnh CCCD ngay sau khi xử lý (giảm rủi ro lộ dữ liệu nhạy cảm)
      b.update(ref, { status: decision === 'approve' ? 'approved' : 'rejected', reason: decision === 'reject' ? why : '', reviewedBy: a.email, reviewedAt: ts, front: del, back: del });
      if (decision === 'approve') b.update(db.doc(`users/${id}`), { kyc: true });
      b.set(db.collection(`users/${id}/notifs`).doc(), { type: 'kyc', ok: decision === 'approve', text: decision === 'reject' ? why.slice(0, 100) : '', read: false, at: ts });
      await b.commit();
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'action' });
  } catch (e) {
    console.error('admin', e);
    return res.status(500).json({ error: 'server' });
  }
};
