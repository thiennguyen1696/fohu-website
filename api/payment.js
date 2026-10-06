// Webhook nhận biến động số dư từ SePay (https://sepay.vn). Khi có tiền vào đúng mã "FOHU <MÃ>" và đủ số tiền
// thì tự kích hoạt gói trong 30 ngày. Bảo vệ bằng API Key (header Authorization: Apikey <SEPAY_API_KEY>).
const { db, admin } = require('./_admin');

const PRICE = { standard: 99000, premium: 149000 }; // phải khớp với trang Đối tác và firestore.rules
const DAYS = 30;

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ success: false });
    const key = process.env.SEPAY_API_KEY;
    if (!key || (req.headers.authorization || '') !== `Apikey ${key}`) return res.status(401).json({ success: false, message: 'unauthorized' });

    const b = req.body || {};
    if (b.transferType !== 'in') return res.status(200).json({ success: true, ignored: 'not-incoming' });

    // Mã gồm 8 ký tự (A-H, J-N, P-Z, 2-9). Ngân hàng có thể bỏ dấu cách / đổi chữ thường nên khớp linh hoạt.
    const text = String(b.content || b.description || '').toUpperCase();
    const m = text.match(/FOHU\s*([A-HJ-NP-Z2-9]{8})/);
    if (!m) return res.status(200).json({ success: true, ignored: 'no-code' });

    const code = m[1], txId = String(b.id ?? b.referenceCode ?? ''), amount = Number(b.transferAmount || 0);
    const pref = db.doc(`payments/${code}`);
    let result = 'ok';

    await db.runTransaction(async (t) => {
      const ps = await t.get(pref);
      if (!ps.exists) { result = 'unknown-code'; return; }
      const p = ps.data();
      if (p.status === 'paid') { result = 'duplicate'; return; } // SePay có thể gọi lại: không cộng ngày hai lần
      if (!PRICE[p.plan] || amount < PRICE[p.plan]) {
        t.update(pref, { lastTx: txId, note: 'underpaid', amountPaid: amount });
        result = 'underpaid'; return;
      }
      const uref = db.doc(`users/${p.uid}`);
      const us = await t.get(uref);
      if (!us.exists) { result = 'no-user'; return; }
      const u = us.data(), now = Date.now();
      // Gia hạn cùng gói: cộng tiếp từ ngày hết hạn; đổi gói hoặc đã hết hạn: tính từ bây giờ
      const base = (u.plan === p.plan && u.planUntil && u.planUntil.toMillis() > now) ? u.planUntil.toMillis() : now;
      t.update(uref, { plan: p.plan, planUntil: admin.firestore.Timestamp.fromMillis(base + DAYS * 864e5) });
      t.update(pref, { status: 'paid', txId, amountPaid: amount, paidAt: admin.firestore.FieldValue.serverTimestamp() });
      t.set(db.collection(`users/${p.uid}/notifs`).doc(), { type: 'plan', plan: p.plan, read: false, at: admin.firestore.FieldValue.serverTimestamp() });
    });

    return res.status(200).json({ success: true, result });
  } catch (e) {
    console.error('payment webhook', e);
    return res.status(500).json({ success: false }); // SePay sẽ thử lại
  }
};
