// Firebase Admin (quyền máy chủ) cho webhook thanh toán và tác vụ định kỳ.
// Khởi tạo "lười" (chỉ khi cần) để lỗi cấu hình trả về thông báo rõ ràng thay vì làm sập cả hàm.
// Cách 1: FIREBASE_SERVICE_ACCOUNT = nội dung JSON khóa dịch vụ (hoặc dạng base64 của JSON đó).
// Cách 2 (dự phòng): FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY (3 giá trị trong file JSON).
let cached;

function parseAccount(input) {
  let raw = String(input || '').replace(/^\uFEFF/, '').trim();
  if (raw.length > 1 && raw[0] === '"' && raw[raw.length - 1] === '"') raw = raw.slice(1, -1).trim(); // lỡ dán kèm dấu nháy
  if (!raw.startsWith('{')) { // dạng base64 (chịu được xuống dòng/khoảng trắng và base64 URL-safe)
    const b = raw.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    raw = Buffer.from(b, 'base64').toString('utf8').replace(/^\uFEFF/, '').trim();
  }
  try { return JSON.parse(raw); } catch (e) { /* thử cách trích trường bên dưới */ }
  // Dự phòng: trích 3 trường cần thiết (chịu được xuống dòng thật nằm trong private_key)
  const g = (k) => { const m = raw.match(new RegExp('"' + k + '"\\s*:\\s*"([\\s\\S]*?)"\\s*[,}]')); return m && m[1]; };
  const pk = g('private_key'), ce = g('client_email'), pi = g('project_id');
  if (pk && ce && pi) return { project_id: pi, client_email: ce, private_key: pk };
  throw new Error('bad-json-FIREBASE_SERVICE_ACCOUNT');
}

function loadCredential(env) {
  let cred;
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    try { cred = parseAccount(env.FIREBASE_SERVICE_ACCOUNT); }
    catch (e) { if (!(env.FIREBASE_PRIVATE_KEY && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PROJECT_ID)) throw e; }
  }
  if (!cred) {
    if (env.FIREBASE_PRIVATE_KEY && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PROJECT_ID)
      cred = { project_id: env.FIREBASE_PROJECT_ID, client_email: env.FIREBASE_CLIENT_EMAIL, private_key: env.FIREBASE_PRIVATE_KEY };
    else throw new Error('missing-FIREBASE_SERVICE_ACCOUNT');
  }
  cred.private_key = String(cred.private_key || '').replace(/\\n/g, '\n');
  if (!/BEGIN PRIVATE KEY/.test(cred.private_key)) throw new Error('bad-private-key');
  return cred;
}

// Mô tả cấu hình KHÔNG lộ giá trị bí mật (dùng cho /api/payment?check=1)
function describe() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  return {
    len: raw.length,
    starts: raw[0] === '{' ? 'json' : /^[A-Za-z0-9+/=_-]/.test(raw[0] || '') ? 'base64-like' : raw ? 'other' : 'empty',
    endsWithBrace: raw.endsWith('}'),
    hasNewline: /\n/.test(raw),
    split3: !!(process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PROJECT_ID),
  };
}

function init() {
  if (cached) return cached;
  const admin = require('firebase-admin');
  const cred = loadCredential(process.env);
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(cred) });
  cached = { admin, db: admin.firestore() };
  return cached;
}
module.exports = { init, parseAccount, loadCredential, describe };
