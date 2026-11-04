// Trang quản trị: duyệt hồ sơ xác minh đối tác (xem ảnh CCCD, duyệt/từ chối).
// Chỉ các email trong biến môi trường ADMIN_EMAILS (cách nhau bằng dấu phẩy) mới dùng được.
const { init } = require('./_admin');
const { verify, s3 } = require('./_lib');
const { PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const { activate } = require('./_pay');

const isAdmin = (a) => {
  const list = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  return !!a && !!a.email && a.emailVerified && list.includes(a.email.toLowerCase());
};
const ID = /^[A-Za-z0-9_-]{6,128}$/;

// ===== Bảng điều khiển: số liệu tổng quan =====
const DAY = 864e5, VN = 7 * 3600e3;
const vnDay = (ms) => new Date(ms + VN).toISOString().slice(0, 10);
const cnt = async (q) => { try { return (await q.count().get()).data().count; } catch (e) { return null; } };
const msOf = (v) => (v && v.toMillis ? v.toMillis() : 0);

async function buildStats(db, admin) {
  const now = Date.now(), days = [];
  for (let i = 29; i >= 0; i--) days.push(vnDay(now - i * DAY));
  const idx = Object.fromEntries(days.map((d, i) => [d, i])), zero = () => days.map(() => 0);
  const TS = (ms) => admin.firestore.Timestamp.fromMillis(ms), col = (n) => db.collection(n);

  // Người dùng: lấy từ Firebase Authentication (chính xác hơn hồ sơ Firestore vì có cả tài khoản cũ)
  const signups = zero(); let users = 0, new7 = 0, new30 = 0, active7 = 0, active30 = 0;
  try {
    let tok, pages = 0;
    do {
      const r = await admin.auth().listUsers(1000, tok);
      for (const u of r.users) {
        users++;
        const c = Date.parse(u.metadata.creationTime || ''), l = Date.parse(u.metadata.lastRefreshTime || u.metadata.lastSignInTime || '');
        if (c >= now - 30 * DAY) { new30++; if (c >= now - 7 * DAY) new7++; const i = idx[vnDay(c)]; if (i !== undefined) signups[i]++; }
        if (l >= now - 30 * DAY) { active30++; if (l >= now - 7 * DAY) active7++; }
      }
      tok = r.pageToken;
    } while (tok && ++pages < 10);
  } catch (e) { users = null; }

  // Bài đăng theo ngày
  const posts = zero();
  try {
    const ps = await col('posts').where('at', '>=', TS(now - 30 * DAY)).select('at').limit(5000).get();
    ps.docs.forEach((d) => { const i = idx[vnDay(msOf(d.get('at')))]; if (i !== undefined) posts[i]++; });
  } catch (e) { /* bỏ qua */ }

  // Doanh thu từ các phiếu đã thanh toán
  const rev = zero(); let total = 0, month = 0, paidCount = 0;
  try {
    const m = vnDay(now).slice(0, 7);
    const pq = await col('payments').where('paidAt', '>=', TS(0)).select('amountPaid', 'paidAt').limit(5000).get();
    pq.docs.forEach((d) => {
      const amt = Number(d.get('amountPaid') || 0), t = msOf(d.get('paidAt')), day = vnDay(t);
      paidCount++; total += amt;
      if (day.slice(0, 7) === m) month += amt;
      if (t >= now - 30 * DAY) { const i = idx[day]; if (i !== undefined) rev[i] += amt; }
    });
  } catch (e) { /* bỏ qua */ }

  // Lưu lượng truy cập (do /api/track ghi theo ngày)
  const views = zero(), vis = zero();
  const agg = () => ({ views: 0, visitors: 0, newVisitors: 0, dev: {}, ref: {}, path: {}, auth: {} });
  const r7 = agg(), r30 = agg();
  const add = (A, x) => {
    A.views += x.views || 0; A.visitors += x.uv || 0; A.newVisitors += x.nv || 0;
    for (const k of ['dev', 'ref', 'path', 'auth']) for (const [n, v] of Object.entries(x[k] || {})) A[k][n] = (A[k][n] || 0) + v;
  };
  try {
    const sd = await db.getAll(...days.map((d) => db.doc(`stats/${d}`)));
    sd.forEach((s, i) => { const x = s.exists ? s.data() : {}; views[i] = x.views || 0; vis[i] = x.uv || 0; add(r30, x); if (i >= days.length - 7) add(r7, x); });
  } catch (e) { /* bỏ qua */ }

  const [postsN, comments, dailies, orders, oOpen, oFilled, oClosed, reviews, follows, kyc, tix, payPending, prem, std] = await Promise.all([
    cnt(col('posts')), cnt(db.collectionGroup('comments')), cnt(col('dailies').where('at', '>=', TS(now - DAY))),
    cnt(col('orders')), cnt(col('orders').where('status', '==', 'open')), cnt(col('orders').where('status', '==', 'filled')), cnt(col('orders').where('status', '==', 'closed')),
    cnt(col('reviews')), cnt(col('follows')), cnt(col('partnerRequests').where('status', '==', 'pending')),
    cnt(col('supportTickets').where('status', '==', 'new')), cnt(col('payments').where('status', '==', 'pending')),
    cnt(col('users').where('plan', '==', 'premium')), cnt(col('users').where('plan', '==', 'standard')),
  ]);
  const free = users == null ? null : Math.max(0, users - (prem || 0) - (std || 0));
  return {
    generatedAt: now,
    totals: { users, posts: postsN, comments, dailies, orders, ordersOpen: oOpen, ordersFilled: oFilled, ordersClosed: oClosed, reviews, follows,
      kycPending: kyc, ticketsNew: tix, paymentsPending: payPending, plans: { free, standard: std, premium: prem } },
    growth: { new7, new30, active7, active30 },
    series: { days, signups, posts, views, visitors: vis, revenue: rev },
    revenue: { month, total, paidCount },
    traffic: { r7, r30, today: { views: views[views.length - 1], visitors: vis[vis.length - 1] } },
  };
}

// Dung lượng R2 theo thư mục (đếm tối đa 20.000 tệp mỗi thư mục; vượt quá thì đánh dấu ước tính)
async function storageStats() {
  const out = {}; let truncated = false;
  for (const pre of ['images/', 'videos/', 'daily/']) {
    let tok, n = 0, bytes = 0, pages = 0;
    do {
      const r = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, Prefix: pre, ContinuationToken: tok }));
      (r.Contents || []).forEach((o) => { n++; bytes += o.Size || 0; });
      tok = r.IsTruncated ? r.NextContinuationToken : undefined;
      if (tok && ++pages >= 20) { truncated = true; break; }
    } while (tok);
    out[pre.slice(0, -1)] = { n, bytes };
  }
  const total = out.images.bytes + out.videos.bytes + out.daily.bytes;
  return { ...out, total, truncated, estUsd: Math.max(0, total / 1e9 - 10) * 0.015 };
}

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

    if (action === 'payments') { // 40 phiếu thanh toán gần nhất (để đối soát)
      const snap = await db.collection('payments').orderBy('at', 'desc').limit(40).get();
      const us = snap.empty ? [] : await db.getAll(...snap.docs.map((d) => db.doc(`users/${d.data().uid}`)));
      const items = snap.docs.map((d, i) => { const x = d.data(), u = us[i].data() || {};
        return { id: d.id, plan: x.plan, amount: x.amount, status: x.status, at: x.at && x.at.toMillis ? x.at.toMillis() : 0,
          txId: x.txId || '', note: x.note || '', amountPaid: x.amountPaid || 0,
          user: { name: u.name, email: u.email, plan: u.plan } }; });
      return res.status(200).json({ items });
    }
    if (action === 'activate') { // kích hoạt tay khi đã thấy tiền về tài khoản nhưng webhook chưa chạy
      const code = String(req.body.code || '').toUpperCase();
      if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return res.status(400).json({ error: 'code' });
      return res.status(200).json({ result: await activate(db, admin, code, { force: true }) });
    }

    if (action === 'migrate') { // chuyển ảnh base64 cũ trong Firestore sang R2, mỗi lần 6 mục
      const kind = req.body.kind === 'users' ? 'users' : 'posts', after = req.body.after;
      let q = db.collection(kind).orderBy(admin.firestore.FieldPath.documentId()).limit(6);
      if (after) q = q.startAfter(String(after));
      const snap = await q.get();
      const up = async (val, uid, tag) => {
        const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(val || '');
        if (!m) return null;
        const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
        const key = `images/${uid}/mig-${tag}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
        await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: Buffer.from(m[2], 'base64'), ContentType: m[1], CacheControl: 'public, max-age=31536000, immutable' }));
        return `${process.env.R2_PUBLIC_URL}/${key}`;
      };
      const del = admin.firestore.FieldValue.delete();
      const uc = {};
      const userOf = async (id) => uc[id] || (uc[id] = ((await db.doc(`users/${id}`).get()).data() || {}));
      let moved = 0;
      for (const d of snap.docs) {
        const x = d.data(), upd = {};
        if (kind === 'posts') {
          const u = await up(x.img, x.uid || d.id, 'p');
          if (u) { upd.img = u; if (!x.thumb || String(x.thumb).startsWith('data:')) upd.thumb = u; }
          if (!('an' in x) && x.uid) { // ảnh chụp tên/ảnh tác giả để khách chưa đăng nhập vẫn thấy được
            const au = await userOf(x.uid);
            upd.an = au.name || '';
            if (/^https?:/.test(au.av || '')) upd.aa = au.av;
            if (au.username) upd.aun = au.username;
          }
        } else {
          // Ưu tiên trường mới (av/cover); chỉ dùng trường cũ (avatar/coverUrl) khi chưa có trường mới. Trường cũ luôn được dọn.
          const av = x.av ? await up(x.av, d.id, 'av') : await up(x.avatar, d.id, 'av');
          if (av) upd.av = av;
          if (x.avatar && (upd.av || x.av)) upd.avatar = del;
          const cv = x.cover ? await up(x.cover, d.id, 'cv') : await up(x.coverUrl, d.id, 'cv');
          if (cv) upd.cover = cv;
          if (x.coverUrl && (upd.cover || x.cover)) upd.coverUrl = del;
        }
        if (Object.keys(upd).length) { await d.ref.update(upd); moved++; }
      }
      return res.status(200).json({ scanned: snap.size, moved, next: snap.size < 6 ? null : snap.docs[snap.size - 1].id });
    }
    if (action === 'stats') return res.status(200).json(await buildStats(db, admin));
    if (action === 'storage') return res.status(200).json(await storageStats());
    if (action === 'tickets') { // 50 yêu cầu hỗ trợ gần nhất
      const snap = await db.collection('supportTickets').orderBy('at', 'desc').limit(50).get();
      return res.status(200).json({ items: snap.docs.map((d) => { const t = d.data();
        return { id: d.id, name: t.name, email: t.email, subject: t.subject, message: t.message, status: t.status, at: t.at && t.at.toMillis ? t.at.toMillis() : 0 }; }) });
    }

    if (!ID.test(String(id || ''))) return res.status(400).json({ error: 'id' });

    if (action === 'ticketDone') {
      const ref = db.doc(`supportTickets/${id}`);
      if (!(await ref.get()).exists) return res.status(404).json({ error: 'notfound' });
      await ref.update({ status: 'done', doneBy: a.email });
      return res.status(200).json({ ok: true });
    }

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
