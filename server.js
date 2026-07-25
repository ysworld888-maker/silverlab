const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// === [Server In-Memory DB for Multi-Device Real-time Sync] ===
let usersData = [
  { id: 'admin', pw: '1234', name: '최고관리자', role: 'admin', approved: true, points: 0, isSubscribed: true, hasSurvey: true }
];
let jobsData = [];
let surveysData = [];
let settlementsData = [];
let notificationsData = [];

// === [REST API Routes] ===

// 1. Auth & Users API
app.post('/api/signup', (req, res) => {
  const { id, pw, name, phone, role } = req.body;
  const existing = usersData.find(u => u.id === id);
  if (existing) {
    return res.status(400).json({ success: false, message: '이미 존재하는 아이디입니다.' });
  }
  const newUser = { id, pw, name, phone, role, approved: false, points: 0, isSubscribed: false, subRequested: false, hasSurvey: false };
  usersData.push(newUser);

  // Auto Welcome Notification
  notificationsData.unshift({
    id: 'noti-' + Date.now(),
    targetUserId: id,
    title: '[회원가입 축하]',
    content: `${name}님, silverworks 회원가입을 진심으로 축하합니다! 세상을 은빛 지혜로 채우는 여정에 함께해주셔서 감사합니다.`,
    date: new Date().toLocaleString(),
    isRead: false
  });

  res.json({ success: true, user: newUser });
});

app.post('/api/login', (req, res) => {
  const { id, pw, role } = req.body;
  const user = usersData.find(u => u.id === id && u.role === role);
  
  if (!user) {
    return res.status(400).json({ success: false, message: '등록되지 않았거나 회원 유형이 일치하지 않습니다.' });
  }
  if (user.pw !== pw) {
    return res.status(400).json({ success: false, message: '비밀번호가 일치하지 않습니다.' });
  }
  if (!user.approved) {
    return res.status(400).json({ success: false, message: '관리자의 가입 승인 대기 중입니다.' });
  }
  res.json({ success: true, user });
});

app.get('/api/users', (req, res) => {
  res.json({ success: true, users: usersData });
});

app.post('/api/users/:id/approve', (req, res) => {
  const user = usersData.find(u => u.id === req.params.id);
  if (user) user.approved = true;
  res.json({ success: true });
});

app.post('/api/users/:id/subscribe-request', (req, res) => {
  const user = usersData.find(u => u.id === req.params.id);
  if (user) user.subRequested = true;
  res.json({ success: true });
});

app.post('/api/users/:id/approve-subscription', (req, res) => {
  const user = usersData.find(u => u.id === req.params.id);
  if (user) {
    user.isSubscribed = true;
    user.subRequested = false;
    
    notificationsData.unshift({
      id: 'noti-' + Date.now(),
      targetUserId: user.id,
      title: '[구독 승인 완료]',
      content: '사장님, 1년 정기 구독이 승인되어 [구독 회원] 배지 부여 및 피크 상단 고정 공고 작성 권한이 활성화되었습니다.',
      date: new Date().toLocaleString(),
      isRead: false
    });
  }
  res.json({ success: true });
});

// 2. Jobs API
app.get('/api/jobs', (req, res) => {
  res.json({ success: true, jobs: jobsData });
});

app.post('/api/jobs', (req, res) => {
  const { employerId, storeName, title, category, date, time, pay, isPeak } = req.body;
  const employer = usersData.find(u => u.id === employerId);

  // Peak Job Subscription Restriction
  if (isPeak && (!employer || !employer.isSubscribed)) {
    return res.status(403).json({ success: false, message: '피크 상단 고정 공고는 구독 회원 사장님만 이용 가능합니다.' });
  }

  const newJob = {
    id: 'job-' + Date.now(),
    employerId,
    storeName,
    title: isPeak ? `[피크 상단고정] ${title}` : title,
    category,
    date,
    time,
    pay: parseInt(pay, 10),
    isPeak: !!isPeak,
    status: '구직자 모집중',
    candidates: []
  };
  jobsData.unshift(newJob);
  res.json({ success: true, job: newJob });
});

app.put('/api/jobs/:id', (req, res) => {
  const job = jobsData.find(j => j.id === req.params.id);
  if (job) {
    Object.assign(job, req.body);
  }
  res.json({ success: true });
});

app.delete('/api/jobs/:id', (req, res) => {
  const jobIdx = jobsData.findIndex(j => j.id === req.params.id);
  if (jobIdx !== -1) {
    const job = jobsData[jobIdx];
    if (job.candidates) {
      job.candidates.forEach(c => {
        notificationsData.unshift({
          id: 'noti-' + Date.now(),
          targetUserId: c.seniorId,
          title: '[공고 삭제 알림]',
          content: `지원하신 '${job.title}' 공고가 삭제되어 내역이 정리되었습니다.`,
          date: new Date().toLocaleString(),
          isRead: false
        });
      });
    }
    jobsData.splice(jobIdx, 1);
  }
  res.json({ success: true });
});

app.post('/api/jobs/:id/apply', (req, res) => {
  const { seniorId, name, phone } = req.body;
  const job = jobsData.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ success: false, message: '공고를 찾을 수 없습니다.' });
  
  if (!job.candidates) job.candidates = [];
  const already = job.candidates.find(c => c.seniorId === seniorId);
  if (already) return res.status(400).json({ success: false, message: '이미 지원한 공고입니다.' });

  job.candidates.push({ seniorId, name, phone, status: '지원 완료 (사장님 검토 중)', rank: null, bonusPayPerHour: 0 });
  res.json({ success: true });
});

app.post('/api/jobs/:id/rank', (req, res) => {
  const { seniorId, rank } = req.body;
  const job = jobsData.find(j => j.id === req.params.id);
  if (job) {
    const cand = job.candidates.find(c => c.seniorId === seniorId);
    if (cand) {
      cand.rank = rank;
      cand.status = `${rank} 지정 완료`;
    }

    notificationsData.unshift({
      id: 'noti-' + Date.now(),
      targetUserId: seniorId,
      title: '[순위 지정 알림]',
      content: `'${job.title}' 공고에서 ${rank}로 지정되었습니다.`,
      date: new Date().toLocaleString(),
      isRead: false
    });
  }
  res.json({ success: true });
});

app.post('/api/jobs/:id/hire', (req, res) => {
  const { seniorId } = req.body;
  const job = jobsData.find(j => j.id === req.params.id);
  if (job) {
    const cand = job.candidates.find(c => c.seniorId === seniorId);
    if (cand) cand.status = '채용 확정';

    notificationsData.unshift({
      id: 'noti-' + Date.now(),
      targetUserId: seniorId,
      title: '[채용 확정 알림]',
      content: `'${job.title}' 공고에 최종 채용되었습니다! 출근 준비를 시작해 주세요.`,
      date: new Date().toLocaleString(),
      isRead: false
    });
  }
  res.json({ success: true });
});

// Cancel Hire & Auto Promotion with Bonus Pay Logic
app.post('/api/jobs/:id/cancel-hire', (req, res) => {
  const { seniorId } = req.body;
  const job = jobsData.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ success: false, message: '공고를 찾을 수 없습니다.' });

  const cancelledCand = job.candidates.find(c => c.seniorId === seniorId);
  if (cancelledCand) {
    cancelledCand.status = '채용 취소됨';
    
    // Notify Cancelled Senior
    notificationsData.unshift({
      id: 'noti-' + Date.now(),
      targetUserId: seniorId,
      title: '[채용 취소 알림]',
      content: `'${job.title}' 공고의 채용이 취소되었습니다.`,
      date: new Date().toLocaleString(),
      isRead: false
    });
  }

  // Find next candidate in order (2nd rank -> 3rd rank)
  const candidate2 = job.candidates.find(c => c.rank === '2순위' && c.status !== '채용 취소됨');
  const candidate3 = job.candidates.find(c => c.rank === '3순위' && c.status !== '채용 취소됨');

  let promotedCand = candidate2 || candidate3;

  if (promotedCand) {
    const isSecond = promotedCand.rank === '2순위';
    const bonusPerHour = isSecond ? 1000 : 2000;
    promotedCand.status = `${promotedCand.rank} 승계 채용 확정 (시급 +${bonusPerHour.toLocaleString()}원 가산)`;
    promotedCand.bonusPayPerHour = bonusPerHour;

    // Notifications
    notificationsData.unshift({
      id: 'noti-' + Date.now(),
      targetUserId: promotedCand.seniorId,
      title: '[자동 승계 채용 알림]',
      content: `'${job.title}' 공고에 1순위 취소로 인해 ${promotedCand.rank} 승계 채용되었습니다! (시급 당 +${bonusPerHour.toLocaleString()}원 추가 가산)`,
      date: new Date().toLocaleString(),
      isRead: false
    });

    notificationsData.unshift({
      id: 'noti-' + Date.now(),
      targetUserId: job.employerId,
      title: '[승계 채용 처리 알림]',
      content: `'${job.title}' 공고의 1순위 채용 취소로 인해 ${promotedCand.name}님(${promotedCand.rank})이 자동 승계 채용되었습니다.`,
      date: new Date().toLocaleString(),
      isRead: false
    });
  }

  res.json({ success: true, promoted: promotedCand ? promotedCand.name : null });
});

// Pay Points to Senior with Hourly Bonus Calculation
app.post('/api/jobs/:id/pay-points', (req, res) => {
  const { seniorId, basePay } = req.body;
  const job = jobsData.find(j => j.id === req.params.id);
  const senior = usersData.find(u => u.id === seniorId);

  if (job && senior) {
    const cand = job.candidates.find(c => c.seniorId === seniorId);
    let bonusTotal = 0;

    // Calculate 2~3 hours bonus if applicable
    if (cand && cand.bonusPayPerHour > 0) {
      const hours = 3; // Standard 3 hour shift calculation
      bonusTotal = cand.bonusPayPerHour * hours;
    }

    const totalPay = parseInt(basePay, 10) + bonusTotal;
    senior.points = (senior.points || 0) + totalPay;

    notificationsData.unshift({
      id: 'noti-' + Date.now(),
      targetUserId: seniorId,
      title: '[포인트 지급 완료]',
      content: `'${job.title}' 근무 대가로 ${totalPay.toLocaleString()}P (가산금 ${bonusTotal.toLocaleString()}P 포함)가 지급되었습니다.`,
      date: new Date().toLocaleString(),
      isRead: false
    });
  }
  res.json({ success: true });
});

// 3. Surveys API
app.get('/api/surveys', (req, res) => {
  res.json({ success: true, surveys: surveysData });
});

app.post('/api/surveys', (req, res) => {
  const survey = req.body;
  surveysData.unshift(survey);
  
  const user = usersData.find(u => u.id === survey.seniorId);
  if (user) user.hasSurvey = true;

  res.json({ success: true });
});

// 4. Settlements API
app.get('/api/settlements', (req, res) => {
  res.json({ success: true, settlements: settlementsData });
});

app.post('/api/settlements', (req, res) => {
  const { userId, userName, bank, account, amount } = req.body;
  const user = usersData.find(u => u.id === userId);
  
  if (!user || user.points < amount) {
    return res.status(400).json({ success: false, message: '보유 포인트가 부족합니다.' });
  }

  const newSettle = { id: 'settle-' + Date.now(), userId, userName, bank, account, amount: parseInt(amount, 10), status: 'PENDING', date: new Date().toLocaleString() };
  settlementsData.unshift(newSettle);
  res.json({ success: true, settlement: newSettle });
});

app.post('/api/settlements/:id/complete', (req, res) => {
  const settle = settlementsData.find(s => s.id === req.params.id);
  if (settle && settle.status === 'PENDING') {
    settle.status = 'COMPLETED';
    const user = usersData.find(u => u.id === settle.userId);
    if (user) {
      user.points = Math.max(0, user.points - settle.amount);
    }
  }
  res.json({ success: true });
});

// 5. Notifications API
app.get('/api/notifications/:userId', (req, res) => {
  const userNotis = notificationsData.filter(n => n.targetUserId === req.params.userId);
  const hasUnread = userNotis.some(n => !n.isRead);
  res.json({ success: true, notifications: userNotis, hasUnread });
});

app.post('/api/notifications/:userId/read', (req, res) => {
  notificationsData.forEach(n => {
    if (n.targetUserId === req.params.userId) n.isRead = true;
  });
  res.json({ success: true });
});

app.delete('/api/notifications/item/:id', (req, res) => {
  const idx = notificationsData.findIndex(n => n.id === req.params.id);
  if (idx !== -1) notificationsData.splice(idx, 1);
  res.json({ success: true });
});

// Explicit Page Routing
const pages = ['index', 'jobs', 'job-detail', 'senior-apply', 'employer', 'admin', 'notifications', 'login', 'profile'];
pages.forEach(page => {
  app.get(`/${page}`, (req, res) => res.sendFile(path.join(__dirname, 'public', `${page}.html`)));
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`silverworks 서버가 포트 ${PORT}에서 작동 중입니다.`));