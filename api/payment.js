// Webhook nhận biến động số dư từ SePay (https://sepay.vn). Khi có tiền vào đúng mã "FOHU <MÃ>" và đủ số tiền
// thì tự kích hoạt gói trong 30 ngày. Bảo vệ bằng API Key (header Authorization: Apikey <SEPAY_API_KEY>).
const { init, describe } = require('./_admin');
const { activate } = require('./_pay');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET' && req.query && req.query.check) {
      // Kiểm tra cấu hình (không lộ giá trị bí mật): mở https://<tên miền>/api/payment?check=1
      const out = { SEPAY_API_KEY: !!process.env.SEPAY_API_KEY, FIREBASE_SERVICE_ACCOUNT: !!process.env.FIREBASE_SERVICE_ACCOUNT };
      out.info = describe();
      try { init(); out.adminInit = 'ok'; } catch (e) { out.adminInit = String(e.message).slice(0, 100); }
      return res.status(200).json(out);
    }
    if (req.method !== 'POST') return res.status(405).json({ success: false });
    const key = process.env.SEPAY_API_KEY;
    if (!key || (req.headers.authorization || '') !== `Apikey ${key}`) return res.status(401).json({ success: false, message: 'unauthorized' });

    const { db, admin } = init();
    const b = req.body || {};
    if (b.transferType !== 'in') return res.status(200).json({ success: true, ignored: 'not-incoming' });

    // Mã gồm 8 ký tự (A-H, J-N, P-Z, 2-9). Ngân hàng có thể bỏ dấu cách / đổi chữ thường nên khớp linh hoạt.
    const text = String(b.content || b.description || '').toUpperCase();
    const m = text.match(/FOHU\s*([A-HJ-NP-Z2-9]{8})/);
    if (!m) return res.status(200).json({ success: true, ignored: 'no-code' });

    const result = await activate(db, admin, m[1], { amount: Number(b.transferAmount || 0), txId: String(b.id ?? b.referenceCode ?? '') });
    return res.status(200).json({ success: true, result });
  } catch (e) {
    console.error('payment webhook', e);
    return res.status(500).json({ success: false, message: String(e.message || e).slice(0, 120) }); // SePay sẽ thử lại
  }
};
