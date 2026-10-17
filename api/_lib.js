// Tiện ích dùng chung cho các hàm /api (tên bắt đầu bằng _ nên Vercel không mở thành endpoint)
const { S3Client } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED',
});
const PROJECT = process.env.FIREBASE_PROJECT_ID || 'fohu-platform';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// Xác thực Firebase ID token -> { uid, tok }
async function verify(req) {
  const tok = (req.headers.authorization || '').replace('Bearer ', '');
  if (!tok) return null;
  const v = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: tok }),
  });
  const u = v.ok ? (await v.json()).users?.[0] : null;
  return u ? { uid: u.localId, tok, email: u.email, emailVerified: !!u.emailVerified } : null;
}

// Đọc gói của người dùng (đọc bằng chính token của họ, tuân theo Security Rules)
async function plan(a) {
  const r = await fetch(`${FS}/users/${a.uid}`, { headers: { Authorization: 'Bearer ' + a.tok } });
  if (!r.ok) return 'free';
  return (await r.json()).fields?.plan?.stringValue || 'free';
}

// Đếm bài của người dùng: n = số bài, x = tổng số ảnh phụ (bài nhiều ảnh). Số ảnh = (bài không phải video) + x.
// Dùng truy vấn thường (chỉ tải trường 'extra') thay cho sum(): sum() đòi tạo chỉ mục tổ hợp riêng cho từng bộ lọc nên rất dễ lỗi.
async function countPosts(a, onlyVideo, ym) {
  const eq = (f, value) => ({ fieldFilter: { field: { fieldPath: f }, op: 'EQUAL', value } });
  const filters = [eq('uid', { stringValue: a.uid })];
  if (onlyVideo) filters.push(eq('hasVideo', { booleanValue: true }));
  if (ym) filters.push(eq('ym', { stringValue: ym }));
  const r = await fetch(`${FS}:runQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.tok },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'posts' }],
      where: filters.length > 1 ? { compositeFilter: { op: 'AND', filters } } : filters[0],
      select: { fields: [{ fieldPath: 'extra' }] }, limit: 1000 } }),
  });
  if (!r.ok) throw new Error('count-failed');
  const docs = (await r.json()).filter((d) => d.document);
  const x = docs.reduce((s, d) => { const v = d.document.fields && d.document.fields.extra; return s + Number((v && (v.integerValue ?? v.doubleValue)) || 0); }, 0);
  return { n: docs.length, x };
}

// Đếm số daily của người dùng chưa bị dọn (giới hạn chống lạm dụng lưu trữ)
async function countDailies(a) {
  const r = await fetch(`${FS}:runAggregationQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.tok },
    body: JSON.stringify({ structuredAggregationQuery: { aggregations: [{ alias: 'n', count: {} }], structuredQuery: {
      from: [{ collectionId: 'dailies' }],
      where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: a.uid } } } } } }),
  });
  if (!r.ok) throw new Error('count-failed');
  const j = await r.json();
  return Number(j[0]?.result?.aggregateFields?.n?.integerValue || 0);
}

module.exports = { s3, verify, plan, countPosts, countDailies };
