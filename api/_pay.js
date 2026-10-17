// Kích hoạt gói cho một phiếu thanh toán (dùng chung cho webhook SePay và nút "Kích hoạt tay" của quản trị).
const PRICE = { standard: 99000, premium: 149000 }; // phải khớp trang Đối tác và firestore.rules
const DAYS = 30;

async function activate(db, admin, code, { amount, txId, force } = {}) {
  const pref = db.doc(`payments/${code}`);
  let result = 'ok';
  await db.runTransaction(async (t) => {
    const ps = await t.get(pref);
    if (!ps.exists) { result = 'unknown-code'; return; }
    const p = ps.data();
    if (p.status === 'paid') { result = 'duplicate'; return; } // gọi lại nhiều lần không cộng ngày hai lần
    if (!PRICE[p.plan]) { result = 'bad-plan'; return; }
    if (!force && !(amount >= PRICE[p.plan])) {
      t.update(pref, { lastTx: txId || '', note: 'underpaid', amountPaid: amount || 0 });
      result = 'underpaid'; return;
    }
    const uref = db.doc(`users/${p.uid}`);
    const us = await t.get(uref);
    if (!us.exists) { result = 'no-user'; return; }
    const u = us.data(), now = Date.now();
    // Gia hạn cùng gói: cộng tiếp từ ngày hết hạn; đổi gói hoặc đã hết hạn: tính từ bây giờ
    const base = (u.plan === p.plan && u.planUntil && u.planUntil.toMillis() > now) ? u.planUntil.toMillis() : now;
    const ts = admin.firestore.FieldValue.serverTimestamp();
    t.update(uref, { plan: p.plan, planUntil: admin.firestore.Timestamp.fromMillis(base + DAYS * 864e5) });
    t.update(pref, { status: 'paid', txId: force ? 'manual' : (txId || ''), amountPaid: force ? PRICE[p.plan] : amount, paidAt: ts });
    t.set(db.collection(`users/${p.uid}/notifs`).doc(), { type: 'plan', plan: p.plan, read: false, at: ts });
  });
  return result;
}
module.exports = { activate, PRICE, DAYS };
