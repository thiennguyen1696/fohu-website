// Firebase Admin (quyền máy chủ): dùng cho webhook thanh toán và tác vụ định kỳ.
// Cần biến môi trường FIREBASE_SERVICE_ACCOUNT = nội dung JSON khóa dịch vụ (Firebase → Project settings → Service accounts).
const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
module.exports = { admin, db: admin.firestore() };
