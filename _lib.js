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
  const uid = v.ok ? (await v.json()).users?.[0]?.localId : null;
  return uid ? { uid, tok } : null;
}

// Đọc gói của người dùng (đọc bằng chính token của họ, tuân theo Security Rules)
async function plan(a) {
  const r = await fetch(`${FS}/users/${a.uid}`, { headers: { Authorization: 'Bearer ' + a.tok } });
  if (!r.ok) return 'free';
  return (await r.json()).fields?.plan?.stringValue || 'free';
}

// Đếm bài của người dùng: tất cả bài, hoặc chỉ các bài video (hasVideo = true). Số ảnh = tất cả - video.
async function countPosts(a, onlyVideo) {
  const eq = (f, value) => ({ fieldFilter: { field: { fieldPath: f }, op: 'EQUAL', value } });
  const r = await fetch(`${FS}:runAggregationQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a.tok },
    body: JSON.stringify({ structuredAggregationQuery: { aggregations: [{ alias: 'n', count: {} }], structuredQuery: {
      from: [{ collectionId: 'posts' }],
      where: { compositeFilter: { op: 'AND', filters: [eq('uid', { stringValue: a.uid }), ...(onlyVideo ? [eq('hasVideo', { booleanValue: true })] : [])] } } } } }),
  });
  if (!r.ok) throw new Error('count-failed');
  const j = await r.json();
  return Number(j[0]?.result?.aggregateFields?.n?.integerValue || 0);
}

module.exports = { s3, verify, plan, countPosts };
