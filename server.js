const express = require('express');
const path = require('path');
const { Pool } = require('pg'); // <-- 1. pg 모듈 불러오기 추가

const app = express();
const PORT = process.env.PORT || 3000;

// <-- 2. Render PostgreSQL DB 연결 설정 추가
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Data Storage
let usersData = [
  { id: 'silverworks', pw: 'silverworks1@', name: '최고관리자', role: 'admin', approved: true, points: 0, isSubscribed: true, hasSurvey: true, isVeteran: true },
  { id: 'admin', pw: '12345678', name: '최고관리자(구)', role: 'admin', approved: true, points: 0, isSubscribed: true, hasSurvey: true, isVeteran: true }
];
let jobsData = [];
let surveysData = [];
let settlementsData = [];
let notificationsData = [];
let invoicesData = [];
let liveLogsData = [];
let chatInquiriesData = [];

function addLiveLog(type, message) {
  const timestamp = new Date().toLocaleString('ko-KR');
  liveLogsData.unshift({ id: 'log-' + Date.now(), type, message, timestamp });
  if (liveLogsData.length > 50) liveLogsData.pop();
}

addLiveLog('SYSTEM', '실버웍스 플랫폼 서버가 정상 가동되었습니다.');

// Auth & Users API
app.post('/api/signup', (req, res) => {
  const { id, pw, name, phone, role } = req.body;
  if (!id || !pw || !name || !role) return res.status(400).json({ success: false, message: '필수 회원가입 정보가 누락되었습니다.' });
  if (pw.length < 8) return res.status(400).json({ success: false, message: '비밀번호는 최소 8자리 이상이어야 합니다.' });
  if (usersData.find(u => u.id === id)) return res.status(400).json({ success: false, message: '이미 존재하는 아이디입니다.' });

  const newUser = { id, pw, name, phone: phone || '', role, approved: false, points: 0, isSubscribed: false, subRequested: false, hasSurvey: false, isVeteran: false };
  usersData.push(newUser);

  notificationsData.unshift({
    id: 'noti-' + Date.now(),
    targetUserId: id,
    title: '[회원가입 축하]',
    content: `${name}님, silverworks 회원가입을 진심으로 축하합니다!`,
    date: new Date().toLocaleString('ko-KR'),
    isRead: false
  });

  addLiveLog('SIGNUP', `[신규가입] ${name}(${role === 'senior' ? '시니어' : '사장님'}) 님이 가입 신청했습니다.`);
  res.json({ success: true, user: newUser });
});

app.post('/api/login', (req, res) => {
  const { id, pw, role } = req.body;
  if ((id === 'silverworks' && pw === 'silverworks1@') || (id === 'admin' && pw === '1234')) {
    const adminUser = usersData.find(u => u.id === id) || { id, pw, name: '최고관리자', role: 'admin', approved: true, points: 0, isSubscribed: true, hasSurvey: true, isVeteran: true };
    return res.json({ success: true, user: adminUser });
  }

  const user = usersData.find(u => u.id === id && u.role === role);
  if (!user) return res.status(400).json({ success: false, message: '등록되지 않았거나 회원 유형이 일치하지 않습니다.' });
  if (user.pw !== pw) return res.status(400).json({ success: false, message: '비밀번호가 일치하지 않습니다.' });
  if (!user.approved) return res.status(400).json({ success: false, message: '관리자의 가입 승인 대기 중입니다.' });

  addLiveLog('LOGIN', `[로그인] ${user.name}(${user.id}) 님이 접속했습니다.`);
  res.json({ success: true, user });
});

app.get('/api/users', (req, res) => res.json({ success: true, users: usersData }));

app.post('/api/users/:id/approve', (req, res) => {
  const user = usersData.find(u => u.id === req.params.id);
  if (user) {
    user.approved = true;
    addLiveLog('APPROVE', `[가입승인] 관리자가 회원(${req.params.id}) 가입을 승인했습니다.`);
  }
  res.json({ success: true });
});

app.post('/api/users/:id/update-points', (req, res) => {
  const { points } = req.body;
  const user = usersData.find(u => u.id === req.params.id);
  if (user) user.points = parseInt(points, 10) || 0;
  res.json({ success: true });
});

app.post('/api/users/:id/toggle-veteran', (req, res) => {
  const { isVeteran } = req.body;
  const user = usersData.find(u => u.id === req.params.id);
  if (user) {
    user.isVeteran = !!isVeteran;
    addLiveLog('VETERAN', `[인증 베테랑] 시니어(${req.params.id}) 인증 상태가 ${user.isVeteran ? '부여' : '해제'}되었습니다.`);
  }
  res.json({ success: true });
});

app.post('/api/users/:id/subscribe-request', (req, res) => {
  const user = usersData.find(u => u.id === req.params.id);
  if (user) {
    user.subRequested = true;
    addLiveLog('SUB_REQ', `[구독신청] 사장님(${req.params.id})이 월 20,000원 정기 구독권 승인을 요청했습니다.`);
  }
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
      content: '사장님, 월 20,000원 정기 구독이 승인되어 공고 상단 고정 및 수수료 절반(5%) 혜택이 적용됩니다.',
      date: new Date().toLocaleString('ko-KR'),
      isRead: false
    });
    addLiveLog('SUB_OK', `[구독승인] 사장님(${req.params.id})의 구독 승인이 완료되었습니다.`);
  }
  res.json({ success: true });
});

app.post('/api/users/:id/cancel-subscription', (req, res) => {
  const user = usersData.find(u => u.id === req.params.id);
  if (user) {
    user.isSubscribed = false;
    user.subRequested = false;
  }
  res.json({ success: true });
});

app.post('/api/users/:id/warn', (req, res) => {
  const { step } = req.body;
  const user = usersData.find(u => u.id === req.params.id);
  if (user) {
    notificationsData.unshift({
      id: 'noti-' + Date.now(),
      targetUserId: user.id,
      title: `[긴급] 미납 수수료 납부 독촉 (${step}차 경고)`,
      content: `사장님, 실버웍스 수수료 미납건과 관련하여 ${step}차 경고 조치 되었습니다. 조속한 처리를 부탁드립니다.`,
      date: new Date().toLocaleString('ko-KR'),
      isRead: false
    });
    addLiveLog('WARN', `[경고발송] 사장님(${req.params.id})에게 ${step}차 미납 경고를 발송했습니다.`);
  }
  res.json({ success: true });
});

app.post('/api/notifications/send-direct', (req, res) => {
  const { targetUserId, title, content } = req.body;
  if (!targetUserId || !title || !content) return res.status(400).json({ success: false, message: '모든 항목을 입력해 주세요.' });

  notificationsData.unshift({
    id: 'noti-' + Date.now(),
    targetUserId,
    title,
    content,
    date: new Date().toLocaleString('ko-KR'),
    isRead: false
  });
  addLiveLog('DIRECT_NOTI', `[1:1 알림] (${targetUserId}) 회원에게 핀포인트 메시지를 전송했습니다.`);
  res.json({ success: true });
});

app.delete('/api/users/:id', (req, res) => {
  const idx = usersData.findIndex(u => u.id === req.params.id);
  if (idx !== -1) {
    usersData.splice(idx, 1);
    addLiveLog('DELETE_USER', `[강제탈퇴] 관리자가 회원 ID (${req.params.id}) 계정을 삭제했습니다.`);
  }
  res.json({ success: true });
});

app.get('/api/live-logs', (req, res) => res.json({ success: true, logs: liveLogsData }));
app.get('/api/chat-inquiries', (req, res) => res.json({ success: true, chats: chatInquiriesData }));
app.post('/api/chat-inquiries', (req, res) => {
  const { userId, userName, sender, message } = req.body;
  const timestamp = new Date().toLocaleString('ko-KR');

  chatInquiriesData.push({ id: Date.now(), userId, userName, sender, message, timestamp, isRead: false });
  addLiveLog('CHAT', `[1:1 문의] ${userName}(${userId})님의 메시지: "${message}"`);
  res.json({ success: true });
});

app.get('/api/invoices', (req, res) => res.json({ success: true, invoices: invoicesData }));
app.get('/api/invoices/:employerId', (req, res) => {
  const list = invoicesData.filter(i => i.employerId === req.params.employerId && !i.isFullyConfirmed);
  res.json({ success: true, invoices: list });
});

app.post('/api/invoices/request-confirm', (req, res) => {
  const { invoiceId } = req.body;
  const inv = invoicesData.find(i => i.id === invoiceId);
  if (inv) {
    inv.status = 'PENDING_ADMIN';
    addLiveLog('INVOICE_REQ', `[명세서 입금확인] 사장님이 명세서(${invoiceId}) 입금 확인을 요청했습니다.`);
  }
  res.json({ success: true });
});

app.post('/api/invoices/request-cancel', (req, res) => {
  const { invoiceId } = req.body;
  const inv = invoicesData.find(i => i.id === invoiceId);
  if (inv) {
    inv.cancelRequested = true;
    addLiveLog('INVOICE_CANCEL_REQ', `[명세서 취소요청] 사장님이 명세서(${invoiceId}) 취소 승인을 요청했습니다.`);
  }
  res.json({ success: true });
});

app.post('/api/invoices/admin-confirm', (req, res) => {
  const { invoiceId } = req.body;
  const inv = invoicesData.find(i => i.id === invoiceId);
  if (inv) {
    inv.isFullyConfirmed = true;
    notificationsData.unshift({
      id: 'noti-' + Date.now(),
      targetUserId: inv.employerId,
      title: '[명세서 처리 완료]',
      content: `'${inv.jobTitle}' 건에 대한 수수료 납부 명세서 정산 처리가 완료되었습니다.`,
      date: new Date().toLocaleString('ko-KR'),
      isRead: false
    });
    addLiveLog('INVOICE_OK', `[명세서 완료] 관리자가 명세서(${invoiceId}) 처리를 완료했습니다.`);
  }
  res.json({ success: true });
});

app.post('/api/invoices/admin-approve-cancel', (req, res) => {
  const { invoiceId } = req.body;
  const idx = invoicesData.findIndex(i => i.id === invoiceId);
  if (idx !== -1) {
    invoicesData.splice(idx, 1);
    addLiveLog('INVOICE_CANCELED', `[명세서 취소승인] 관리자가 명세서(${invoiceId})를 취소 처리했습니다.`);
  }
  res.json({ success: true });
});

app.get('/api/jobs', (req, res) => res.json({ success: true, jobs: jobsData }));

app.post('/api/jobs', (req, res) => {
  const { employerId, storeName, title, category, date, time, pay, isPeak, regionMain, regionSub, address, description } = req.body;
  const employer = usersData.find(u => u.id === employerId);
  if (isPeak && (!employer || !employer.isSubscribed)) {
    return res.status(403).json({ success: false, message: '상단 고정 공고는 구독 회원 사장님만 이용 가능합니다.' });
  }

  const newJob = {
    id: 'job-' + Date.now(),
    employerId,
    storeName,
    title: isPeak ? `[상단 고정] ${title}` : title,
    category: category || '음식',
    date,
    time,
    pay: parseInt(pay, 10),
    isPeak: !!isPeak,
    regionMain: regionMain || '서울특별시',
    regionSub: regionSub || '전체',
    address: address || '',
    description: description || '',
    status: '구직자 모집중',
    candidates: []
  };

  jobsData.unshift(newJob);
  addLiveLog('JOB_CREATE', `[공고등록] ${storeName}에서 '${newJob.title}' 구인 공고를 등록했습니다.`);
  res.json({ success: true, jobId: newJob.id });
});

app.delete('/api/jobs/:id', (req, res) => {
  const jobIdx = jobsData.findIndex(j => j.id === req.params.id);
  if (jobIdx !== -1) {
    const job = jobsData[jobIdx];
    if (job.candidates && job.candidates.length > 0) {
      job.candidates.forEach(c => {
        notificationsData.unshift({
          id: 'noti-' + Date.now() + '-' + Math.random(),
          targetUserId: c.seniorId,
          title: '[공고 삭제 알림]',
          content: `지원하신 '${job.title}' 공고가 사장님 또는 관리자에 의해 삭제되었습니다.`,
          date: new Date().toLocaleString('ko-KR'),
          isRead: false
        });
      });
    }
    jobsData.splice(jobIdx, 1);
    addLiveLog('JOB_DELETE', `[공고삭제] 공고 ID(${req.params.id})가 삭제 처리되었습니다.`);
  }
  res.json({ success: true });
});

app.post('/api/jobs/:id/apply', (req, res) => {
  const { seniorId, name, phone } = req.body;
  const job = jobsData.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ success: false, message: '공고를 찾을 수 없습니다.' });

  if (!job.candidates) job.candidates = [];
  if (job.candidates.find(c => c.seniorId === seniorId)) return res.status(400).json({ success: false, message: '이미 지원한 공고입니다.' });

  job.candidates.push({ seniorId, name, phone, status: '지원 완료 (사장님 검토 중)', rank: null });
  addLiveLog('APPLY', `[공고지원] 시니어 ${name}(${seniorId})님이 공고에 지원했습니다.`);
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
      date: new Date().toLocaleString('ko-KR'),
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
      date: new Date().toLocaleString('ko-KR'),
      isRead: false
    });
    addLiveLog('HIRE', `[채용확정] 시니어(${seniorId})님이 '${job.title}' 공고에 최종 채용되었습니다.`);
  }
  res.json({ success: true });
});

app.post('/api/jobs/:id/cancel-hire', (req, res) => {
  const { seniorId } = req.body;
  const job = jobsData.find(j => j.id === req.params.id);
  if (job) {
    const cand = job.candidates.find(c => c.seniorId === seniorId);
    if (cand) cand.status = '채용 취소됨';

    notificationsData.unshift({
      id: 'noti-' + Date.now(),
      targetUserId: seniorId,
      title: '[채용 취소 알림]',
      content: `'${job.title}' 공고의 채용이 취소되었습니다.`,
      date: new Date().toLocaleString('ko-KR'),
      isRead: false
    });

    const nextCand = job.candidates.find(c => (c.rank === '2순위' || c.rank === '3순위') && c.status !== '채용 취소됨');
    if (nextCand) {
      nextCand.status = `${nextCand.rank} 승계 채용 확정`;
      notificationsData.unshift({
        id: 'noti-' + Date.now() + '-1',
        targetUserId: nextCand.seniorId,
        title: '[자동 승계 채용 알림]',
        content: `'${job.title}' 공고에 이전 채용자의 사정으로 인해 ${nextCand.rank} 승계 채용되었습니다!`,
        date: new Date().toLocaleString('ko-KR'),
        isRead: false
      });
    }
  }
  res.json({ success: true });
});

// 명세서 금액 계산 공식 전면 수정: 기본일당 + 수수료 + 부가가치세 = 최종 청구액
app.post('/api/jobs/:id/pay-points', (req, res) => {
  const { seniorId, basePay } = req.body;
  const job = jobsData.find(j => j.id === req.params.id);
  const senior = usersData.find(u => u.id === seniorId);
  const employer = usersData.find(u => u.id === job?.employerId);

  if (job && senior) {
    const payAmount = parseInt(basePay, 10);
    senior.points = (senior.points || 0) + payAmount;

    const feeRate = employer && employer.isSubscribed ? 0.05 : 0.10;
    const feeAmount = Math.round(payAmount * feeRate);
    const vat = Math.round(feeAmount * 0.10);
    // 수정: 기본일당 + 수수료 + VAT = 최종 청구액
    const totalAmount = payAmount + feeAmount + vat;

    invoicesData.unshift({
      id: 'inv-' + Date.now(),
      employerId: job.employerId,
      jobId: job.id,
      jobTitle: job.title,
      storeName: job.storeName,
      seniorId,
      workDate: job.date,
      basePay: payAmount,
      feeRate,
      feeAmount,
      vat,
      totalAmount,
      date: new Date().toLocaleString('ko-KR'),
      status: 'ISSUED',
      isFullyConfirmed: false
    });

    notificationsData.unshift({
      id: 'noti-' + Date.now() + '-1',
      targetUserId: seniorId,
      title: '[포인트 지급 완료]',
      content: `'${job.title}' 근무 대가로 ${payAmount.toLocaleString()}P가 지급되었습니다.`,
      date: new Date().toLocaleString('ko-KR'),
      isRead: false
    });

    notificationsData.unshift({
      id: 'noti-' + Date.now() + '-2',
      targetUserId: job.employerId,
      title: '[수수료 명세서 발행]',
      content: `'${job.title}' 채용에 따른 수수료 명세서(최종 청구액 ${totalAmount.toLocaleString()}원)가 발행되었습니다. (사장님이 시니어에게 직접 현금을 지급하지 않아도 플랫폼을 통해 안전 정산됩니다)`,
      date: new Date().toLocaleString('ko-KR'),
      isRead: false
    });

    addLiveLog('PAY_POINTS', `[포인트지급] ${job.storeName}에서 시니어(${seniorId})에게 ${payAmount.toLocaleString()}P 지급 및 명세서 발행 완료.`);
  }
  res.json({ success: true });
});

app.get('/api/surveys', (req, res) => res.json({ success: true, surveys: surveysData }));
app.post('/api/surveys', (req, res) => {
  const { seniorId, q1, q2, q3 } = req.body;
  surveysData.unshift({ seniorId, q1, q2, q3, date: new Date().toLocaleString('ko-KR') });
  const user = usersData.find(u => u.id === seniorId);
  if (user) user.hasSurvey = true;
  res.json({ success: true });
});

app.get('/api/settlements', (req, res) => res.json({ success: true, settlements: settlementsData }));
app.post('/api/settlements', (req, res) => {
  const { userId, userName, bank, account, amount } = req.body;
  const user = usersData.find(u => u.id === userId);
  if (!user || user.points < amount) return res.status(400).json({ success: false, message: '보유 포인트가 부족합니다.' });

  const newSettle = { id: 'settle-' + Date.now(), userId, userName, bank, account, amount: parseInt(amount, 10), status: 'PENDING', date: new Date().toLocaleString('ko-KR') };
  settlementsData.unshift(newSettle);
  addLiveLog('SETTLE_REQ', `[정산요청] 시니어 ${userName}(${userId})님이 ${parseInt(amount).toLocaleString()}P 출금 정산을 요청했습니다.`);
  res.json({ success: true, settlement: newSettle });
});

app.post('/api/settlements/:id/complete', (req, res) => {
  const settle = settlementsData.find(s => s.id === req.params.id);
  if (settle && settle.status === 'PENDING') {
    settle.status = 'COMPLETED';
    const user = usersData.find(u => u.id === settle.userId);
    if (user) {
      user.points = Math.max(0, user.points - settle.amount);
      notificationsData.unshift({
        id: 'noti-' + Date.now(),
        targetUserId: user.id,
        title: '[정산 완료 알림]',
        content: `요청하신 정산 금액 ${settle.amount.toLocaleString()}원(${settle.bank}) 입금 처리가 완료되었습니다.`,
        date: new Date().toLocaleString('ko-KR'),
        isRead: false
      });
      addLiveLog('SETTLE_OK', `[정산완료] 관리자가 시니어(${settle.userId})의 ${settle.amount.toLocaleString()}P 정산을 완료했습니다.`);
    }
  }
  res.json({ success: true });
});

app.get('/api/notifications/:userId', (req, res) => {
  const userNotis = notificationsData.filter(n => n.targetUserId === req.params.userId);
  const hasUnread = userNotis.some(n => !n.isRead);
  res.json({ success: true, notifications: userNotis, hasUnread });
});

app.post('/api/notifications/:userId/read', (req, res) => {
  notificationsData.forEach(n => { if (n.targetUserId === req.params.userId) n.isRead = true; });
  res.json({ success: true });
});

app.delete('/api/notifications/item/:id', (req, res) => {
  const idx = notificationsData.findIndex(n => n.id === req.params.id);
  if (idx !== -1) notificationsData.splice(idx, 1);
  res.json({ success: true });
});

const pages = ['index', 'jobs', 'job-detail', 'senior-apply', 'employer', 'admin', 'notifications', 'login', 'profile'];
pages.forEach(page => app.get(`/${page}`, (req, res) => res.sendFile(path.join(__dirname, 'public', `${page}.html`))));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`silverworks 서버가 포트 ${PORT}에서 무오류 작동 중입니다.`));