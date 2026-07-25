const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// 1. 미들웨어 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. public 폴더 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));

// === [In-Memory Database - 실제 운영용 초기 상태] ===
let jobsData = [];
let verificationsData = [];
let subscriptionsData = [];
let notificationsData = [];

// === [REST API Routes] ===
app.get('/api/jobs', (req, res) => {
  const { category, search } = req.query;
  let filtered = [...jobsData];
  if (category && category !== '전체') {
    filtered = filtered.filter(j => j.category === category);
  }
  if (search) {
    filtered = filtered.filter(j => j.title.includes(search) || j.storeName.includes(search));
  }
  res.json({ success: true, count: filtered.length, jobs: filtered });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobsData.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ success: false, message: '공고를 찾을 수 없습니다.' });
  res.json({ success: true, job });
});

app.post('/api/jobs', (req, res) => {
  const { storeName, title, category, badgeReq, date, time, pay, isSubscribed } = req.body;
  const newJob = {
    id: 'job-' + Date.now(),
    storeName,
    title,
    category: category || '식당·서빙',
    badgeReq: badgeReq || '체력검증 우대',
    date,
    time,
    pay: parseInt(pay, 10),
    feeRate: isSubscribed ? 0.05 : 0.10,
    status: '모집중',
    candidates: []
  };
  jobsData.unshift(newJob);
  res.status(201).json({ success: true, job: newJob });
});

app.post('/api/jobs/:id/apply', (req, res) => {
  const { applicantName, phone, badge } = req.body;
  const job = jobsData.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ success: false, message: '공고가 없습니다.' });
  const rank = job.candidates.length + 1;
  if (rank > 3) return res.status(400).json({ success: false, message: '대기열이 가득 찼습니다.' });
  let statusText = `${rank}순위 출근확정`;
  if (rank === 2) statusText = '2순위 대기중 (+5,000원 가산 대상)';
  if (rank === 3) statusText = '3순위 예비대기';
  const newApplicant = { id: 'u-' + Date.now(), name: applicantName, phone, badge, rank, status: statusText };
  job.candidates.push(newApplicant);
  res.json({ success: true, rank, applicant: newApplicant });
});

app.post('/api/jobs/:id/noshow', (req, res) => {
  const job = jobsData.find(j => j.id === req.params.id);
  if (!job || job.candidates.length < 2) {
    return res.status(400).json({ success: false, message: '승계할 2순위 대기자가 없습니다.' });
  }
  job.candidates.shift(); // 1순위 제거
  job.candidates.forEach((c, idx) => {
    c.rank = idx + 1;
    c.status = c.rank === 1 ? '2순위 승계 출근확정 (+5,000원 반영)' : `${c.rank}순위 대기`;
  });
  job.status = '2순위 승계 완료';
  res.json({ success: true, promotedCandidate: job.candidates[0] });
});

app.post('/api/verifications', (req, res) => {
  const { seniorName, type, detail } = req.body;
  const newVer = {
    id: 'ver-' + Date.now(),
    seniorName,
    type,
    detail,
    date: new Date().toISOString().replace('T', ' ').substring(0, 16),
    status: '심사대기'
  };
  verificationsData.unshift(newVer);
  res.status(201).json({ success: true, verification: newVer });
});

app.get('/api/notifications', (req, res) => {
  res.json({ success: true, notifications: notificationsData });
});

// === [HTML Pages Explicit Routing] ===
const pages = [
  'index',
  'jobs',
  'job-detail',
  'senior-apply',
  'employer',
  'admin',
  'notifications',
  'login'
];

pages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fallback Route
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`silverworks 서버가 포트 ${PORT}에서 정상 가동 중입니다.`);
});