const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// 1. 미들웨어 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. public 폴더 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));

// === [In-Memory Mock Database] ===
let jobsData = [
  {
    id: 'job-1',
    storeName: '대박식당',
    title: '[대박식당] 주말 점심 피크타임 홀 서빙 긴급 구인',
    category: '식당·서빙',
    badgeReq: '체력 베테랑 우대',
    date: '2026-07-28',
    time: '11:30~14:30 (3시간)',
    pay: 35000,
    feeRate: 0.05,
    status: '모집중',
    candidates: [
      { id: 'u-1', name: '김철수', phone: '010-1234-5678', badge: '체력 베테랑 (국민체력 100 1등급)', rank: 1, status: '출근확정' },
      { id: 'u-2', name: '박영희', phone: '010-9876-5432', badge: '보건증 보유', rank: 2, status: '2순위 대기중 (+5,000원 가산 대상)' }
    ]
  },
  {
    id: 'job-2',
    storeName: '즐거운카페',
    title: '[즐거운카페] 오후 음료 제조 및 식기 세척 피크 알바',
    category: '카페·음료',
    badgeReq: '보건증 필수',
    date: '2026-07-28',
    time: '14:00~17:00 (3시간)',
    pay: 32000,
    feeRate: 0.10,
    status: '모집중',
    candidates: [
      { id: 'u-3', name: '이민수', phone: '010-5555-7777', badge: '자가 문진표 작성', rank: 1, status: '출근확정' }
    ]
  }
];

let verificationsData = [
  { id: 'ver-1', seniorName: '김철수 (68세)', type: '국민체력 100', detail: '성남 체력인증센터 1등급', date: '2026-07-26 10:15', status: '심사대기' },
  { id: 'ver-2', seniorName: '박영희 (66세)', type: '보건증', detail: '중원구 보건소 (유효기간 ~2027)', date: '2026-07-26 11:00', status: '심사대기' }
];

let subscriptionsData = [
  { id: 'sub-1', storeName: '대박식당', employerName: '김대박', amount: 120000, depositor: '김대박', date: '2026-07-26 09:30', status: '입금대기' },
  { id: 'sub-2', storeName: '즐거운카페', employerName: '이즐거운', amount: 120000, depositor: '이즐거운', date: '2026-07-25 14:10', status: '승인완료' }
];

let notificationsData = [
  {
    id: 'noti-1',
    type: 'match',
    title: '[대박식당] 피크타임 근무 2순위 승계 출근 확정!',
    content: '1순위 지원자의 노쇼 발생으로 대기자(2순위) 지원님의 출근이 승계 확정되었습니다. 대기 가산금 +5,000원이 추가 합산됩니다.',
    time: '10분 전',
    read: false
  }
];

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
    storeName: storeName || '대박식당',
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
  const newApplicant = { id: 'u-' + Date.now(), name: applicantName || '김 시니어', phone, badge, rank, status: statusText };
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
    seniorName: seniorName || '시니어 회원',
    type: type || '국민체력 100',
    detail: detail || '체력인증센터 검증',
    date: new Date().toISOString().replace('T', ' ').substring(0, 16),
    status: '심사대기'
  };
  verificationsData.unshift(newVer);
  res.status(201).json({ success: true, verification: newVer });
});

app.put('/api/verifications/:id/approve', (req, res) => {
  const item = verificationsData.find(v => v.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, message: '항목을 찾을 수 없습니다.' });
  item.status = '승인완료';
  res.json({ success: true, message: '검증 승인 완료' });
});

app.post('/api/subscriptions', (req, res) => {
  const { storeName, employerName, depositor } = req.body;
  const newSub = {
    id: 'sub-' + Date.now(),
    storeName: storeName || '대박식당',
    employerName,
    amount: 120000,
    depositor: depositor || employerName,
    date: new Date().toISOString().replace('T', ' ').substring(0, 16),
    status: '입금대기'
  };
  subscriptionsData.unshift(newSub);
  res.status(201).json({ success: true, subscription: newSub });
});

app.put('/api/subscriptions/:id/approve', (req, res) => {
  const item = subscriptionsData.find(s => s.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, message: '항목을 찾을 수 없습니다.' });
  item.status = '승인완료';
  jobsData.forEach(j => { if (j.storeName === item.storeName) j.feeRate = 0.05; });
  res.json({ success: true, message: '구독 승인 완료' });
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