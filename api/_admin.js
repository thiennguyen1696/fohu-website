// Firebase Admin (quyền máy chủ) cho webhook thanh toán và tác vụ định kỳ.
// Khởi tạo "lười" (chỉ khi cần) để lỗi cấu hình trả về thông báo rõ ràng thay vì làm sập cả hàm.
// Biến môi trường: FIREBASE_SERVICE_ACCOUNT = nội dung JSON khóa dịch vụ (hoặc dạng base64 của JSON đó).
let cached;
function init() {
  if (cached) return cached;
  const admin = require('firebase-admin');
  let raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) throw new Error('missing-FIREBASE_SERVICE_ACCOUNT');
  if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
  let cred;
  try { cred = JSON.parse(raw); } catch (e) { throw new Error('bad-json-FIREBASE_SERVICE_ACCOUNT'); }
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(cred) });
  cached = { admin, db: admin.firestore() };
  return cached;
}
module.exports = { init };
