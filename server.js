const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// SQLite3 데이터베이스 연결 및 초기화
const db = new sqlite3.Database(path.join(__dirname, 'silverlab.db'), (err) => {
  if (err) {
    console.error('DB 연결 실패:', err.message);
  } else {
    console.log('SQLite3 데이터베이스(silverlab.db) 연결 성공');
  }
});

// 데이터베이스 테이블 생성
db.serialize(() => {
  // Users 테이블 (인증 베테랑 isVeteran 필드 포함)
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    pw TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    role TEXT NOT NULL,
    approved INTEGER DEFAULT 0,
    points INTEGER DEFAULT 0,
    isSubscribed INTEGER DEFAULT 0,
    subRequested INTEGER DEFAULT 0,
    hasSurvey INTEGER DEFAULT 0,
    isVeteran INTEGER DEFAULT 0
  )`);

  // Jobs 테이블 (업종 6종 및 상세 위치/설명 정보)
  db.run(`CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    employerId TEXT NOT NULL,
    storeName TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    pay INTEGER NOT NULL,
    isPeak INTEGER DEFAULT 0,
    regionMain TEXT,
    regionSub TEXT,
    address TEXT,
    description TEXT,
    status TEXT DEFAULT '구직자 모집중'
  )`);

  // Job Candidates 테이블 (지정 순위 1~3순위 지원자 관리)
  db.run(`CREATE TABLE IF NOT EXISTS job_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jobId TEXT NOT NULL,
    seniorId TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    status TEXT DEFAULT '지원 완료 (사장님 검토 중)',
    rank TEXT,
    FOREIGN KEY(jobId) REFERENCES jobs(id) ON DELETE CASCADE
  )`);

  // Invoices 테이블 (수수료 명세서 시스템 & 취소 요청 지원)
  db.run(`CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    employerId TEXT NOT NULL,
    jobId TEXT,
    jobTitle TEXT NOT NULL,
    storeName TEXT NOT NULL,
    seniorId TEXT,
    workDate TEXT,
    basePay INTEGER NOT NULL,
    feeRate REAL NOT NULL,
    feeAmount INTEGER NOT NULL,
    vat INTEGER NOT NULL,
    totalAmount INTEGER NOT NULL,
    date TEXT NOT NULL,
    status TEXT DEFAULT 'ISSUED',
    isFullyConfirmed INTEGER DEFAULT 0,
    cancelRequested INTEGER DEFAULT 0
  )`);

  // Surveys 테이블
  db.run(`CREATE TABLE IF NOT EXISTS surveys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seniorId TEXT NOT NULL,
    q1 TEXT, q2 TEXT, q3 TEXT,
    date TEXT NOT NULL
  )`);

  // Settlements 테이블 (10개 시중 은행 출금 지원)
  db.run(`CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    userName TEXT NOT NULL,
    bank TEXT NOT NULL,
    account TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT DEFAULT 'PENDING',
    date TEXT NOT NULL
  )`);

  // Notifications 테이블 (1:1 핀포인트 알림 연동)
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    targetUserId TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    date TEXT NOT NULL,
    isRead INTEGER DEFAULT 0
  )`);

  // Live Activity Logs (실시간 라이브 활동 피드 기록)
  db.run(`CREATE TABLE IF NOT EXISTS live_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL
  )`);

  // 1:1 Live Chat Inquiries (실시간 통합 상담 메시지)
  db.run(`CREATE TABLE IF NOT EXISTS chat_inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    userName TEXT NOT NULL,
    sender TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    isRead INTEGER DEFAULT 0
  )`);

  // 통합 최고 관리자 계정 (silverworks / silverworks1@) 및 기존 계정 자동 생성
  db.get("SELECT * FROM users WHERE id = 'silverworks'", (err, row) => {
    if (!row) {
      db.run(`INSERT INTO users (id, pw, name, phone, role, approved, points, isSubscribed, hasSurvey, isVeteran) 
              VALUES ('silverworks', 'silverworks1@', '최고관리자', '010-0000-0000', 'admin', 1, 0, 1, 1, 1)`);
    }
  });

  db.get("SELECT * FROM users WHERE id = 'admin'", (err, row) => {
    if (!row) {
      db.run(`INSERT INTO users (id, pw, name, phone, role, approved, points, isSubscribed, hasSurvey, isVeteran) 
              VALUES ('admin', '1234', '최고관리자(구)', '010-0000-0000', 'admin', 1, 0, 1, 1, 1)`);
    }
  });
});

// Helper: 라이브 활동 피드 로그 등록 함수
function addLiveLog(type, message) {
  const timestamp = new Date().toLocaleString('ko-KR');
  db.run(`INSERT INTO live_logs (type, message, timestamp) VALUES (?, ?, ?)`, [type, message, timestamp]);
}

// ----------------------------------------------------
// Auth & Users API
// ----------------------------------------------------
app.post('/api/signup', (req, res) => {
  const { id, pw, name, phone, role } = req.body;

  if (!id || !pw || !name || !role) {
    return res.status(400).json({ success: false, message: '필수 회원가입 정보가 누락되었습니다.' });
  }

  // 비밀번호 8자리 이상 유효성 검사
  if (pw.length < 8) {
    return res.status(400).json({ success: false, message: '비밀번호는 최소 8자리 이상이어야 합니다.' });
  }

  db.get("SELECT id FROM users WHERE id = ?", [id], (err, user) => {
    if (err) return res.status(500).json({ success: false, message: 'DB 오류가 발생했습니다.' });
    if (user) return res.status(400).json({ success: false, message: '이미 존재하는 아이디입니다.' });

    const newUser = {
      id, pw, name, phone: phone || '', role, approved: 0, points: 0, isSubscribed: 0, subRequested: 0, hasSurvey: 0, isVeteran: 0
    };

    db.run(
      `INSERT INTO users (id, pw, name, phone, role, approved, points, isSubscribed, subRequested, hasSurvey, isVeteran)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0)`,
      [newUser.id, newUser.pw, newUser.name, newUser.phone, newUser.role],
      function (err2) {
        if (err2) return res.status(500).json({ success: false, message: '회원가입 처리 실패' });

        const notiId = 'noti-' + Date.now();
        const dateStr = new Date().toLocaleString('ko-KR');
        db.run(
          `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
          [notiId, id, '[회원가입 축하]', `${name}님, silverworks 회원가입을 진심으로 축하합니다!`, dateStr]
        );

        addLiveLog('SIGNUP', `[신규가입] ${name}(${role === 'senior' ? '시니어' : '사장님'}) 님이 회원가입을 신청했습니다.`);
        res.json({ success: true, user: newUser });
      }
    );
  });
});

app.post('/api/login', (req, res) => {
  const { id, pw, role } = req.body;

  // 관리자 마스터 계정 처리
  if ((id === 'silverworks' && pw === 'silverworks1@') || (id === 'admin' && pw === '1234')) {
    db.get("SELECT * FROM users WHERE id = ?", [id], (err, user) => {
      if (user) {
        return res.json({ success: true, user });
      } else {
        const adminUser = { id, pw, name: '최고관리자', role: 'admin', approved: 1, points: 0, isSubscribed: 1, hasSurvey: 1, isVeteran: 1 };
        return res.json({ success: true, user: adminUser });
      }
    });
    return;
  }

  db.get("SELECT * FROM users WHERE id = ? AND role = ?", [id, role], (err, user) => {
    if (err || !user) return res.status(400).json({ success: false, message: '등록되지 않았거나 회원 유형이 일치하지 않습니다.' });
    if (user.pw !== pw) return res.status(400).json({ success: false, message: '비밀번호가 일치하지 않습니다.' });
    if (!user.approved) return res.status(400).json({ success: false, message: '관리자의 가입 승인 대기 중입니다.' });

    addLiveLog('LOGIN', `[로그인] ${user.name}(${user.id}) 님이 시스템에 접속했습니다.`);
    res.json({ success: true, user });
  });
});

app.get('/api/users', (req, res) => {
  db.all("SELECT id, pw, name, phone, role, approved, points, isSubscribed, subRequested, hasSurvey, isVeteran FROM users", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'DB 오류' });
    res.json({ success: true, users: rows });
  });
});

app.post('/api/users/:id/approve', (req, res) => {
  db.run("UPDATE users SET approved = 1 WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ success: false });
    addLiveLog('APPROVE', `[가입승인] 관리자가 회원(${req.params.id})의 가입을 승인했습니다.`);
    res.json({ success: true });
  });
});

app.post('/api/users/:id/update-points', (req, res) => {
  const { points } = req.body;
  db.run("UPDATE users SET points = ? WHERE id = ?", [parseInt(points, 10) || 0, req.params.id], function (err) {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true });
  });
});

// 시니어 '인증 베테랑' 배지 부여/해제 API
app.post('/api/users/:id/toggle-veteran', (req, res) => {
  const { isVeteran } = req.body;
  db.run("UPDATE users SET isVeteran = ? WHERE id = ?", [isVeteran ? 1 : 0, req.params.id], function (err) {
    if (err) return res.status(500).json({ success: false });
    addLiveLog('VETERAN', `[인증 베테랑] 시니어(${req.params.id}) 인증 상태가 ${isVeteran ? '부여' : '해제'}되었습니다.`);
    res.json({ success: true });
  });
});

app.post('/api/users/:id/subscribe-request', (req, res) => {
  db.run("UPDATE users SET subRequested = 1 WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ success: false });
    addLiveLog('SUB_REQ', `[구독신청] 사장님(${req.params.id})이 월 20,000원 정기 구독권 승인을 요청했습니다.`);
    res.json({ success: true });
  });
});

app.post('/api/users/:id/approve-subscription', (req, res) => {
  db.run("UPDATE users SET isSubscribed = 1, subRequested = 0 WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ success: false });

    const notiId = 'noti-' + Date.now();
    const dateStr = new Date().toLocaleString('ko-KR');
    db.run(
      `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
      [notiId, req.params.id, '[구독 승인 완료]', '사장님, 월 20,000원 정기 구독이 승인되어 공고 상단 고정 및 수수료 절반(5%) 혜택이 적용됩니다.', dateStr]
    );

    addLiveLog('SUB_OK', `[구독승인] 사장님(${req.params.id})의 구독 승인이 완료되었습니다.`);
    res.json({ success: true });
  });
});

app.post('/api/users/:id/cancel-subscription', (req, res) => {
  db.run("UPDATE users SET isSubscribed = 0, subRequested = 0 WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ success: false });

    const notiId = 'noti-' + Date.now();
    const dateStr = new Date().toLocaleString('ko-KR');
    db.run(
      `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
      [notiId, req.params.id, '[구독 해지 완료]', '구독권이 성공적으로 해지되었습니다.', dateStr]
    );

    res.json({ success: true });
  });
});

app.post('/api/users/:id/warn', (req, res) => {
  const { step } = req.body;
  const notiId = 'noti-' + Date.now();
  const dateStr = new Date().toLocaleString('ko-KR');

  db.run(
    `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
    [notiId, req.params.id, `[긴급] 미납 수수료 납부 독촉 (${step}차 경고)`, `사장님, 실버웍스 수수료 미납건과 관련하여 ${step}차 경고 조치 되었습니다. 조속한 처리를 부탁드립니다.`, dateStr],
    function (err) {
      if (err) return res.status(500).json({ success: false });
      addLiveLog('WARN', `[경고발송] 사장님(${req.params.id})에게 ${step}차 미납 경고를 발송했습니다.`);
      res.json({ success: true });
    }
  );
});

// 1:1 핀포인트 알림 발송 API
app.post('/api/notifications/send-direct', (req, res) => {
  const { targetUserId, title, content } = req.body;
  if (!targetUserId || !title || !content) return res.status(400).json({ success: false, message: '모든 항목을 입력해 주세요.' });

  const notiId = 'noti-' + Date.now();
  const dateStr = new Date().toLocaleString('ko-KR');

  db.run(
    `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
    [notiId, targetUserId, title, content, dateStr],
    function (err) {
      if (err) return res.status(500).json({ success: false, message: '알림 발송 실패' });
      addLiveLog('DIRECT_NOTI', `[1:1 알림] (${targetUserId}) 회원에게 핀포인트 메시지를 전송했습니다.`);
      res.json({ success: true });
    }
  );
});

app.delete('/api/users/:id', (req, res) => {
  db.run("DELETE FROM users WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ success: false });
    addLiveLog('DELETE_USER', `[강제탈퇴] 관리자가 회원 ID (${req.params.id}) 계정을 삭제했습니다.`);
    res.json({ success: true });
  });
});

// ----------------------------------------------------
// Live Log & 1:1 Live Chat API
// ----------------------------------------------------
app.get('/api/live-logs', (req, res) => {
  db.all("SELECT * FROM live_logs ORDER BY id DESC LIMIT 50", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true, logs: rows });
  });
});

app.get('/api/chat-inquiries', (req, res) => {
  db.all("SELECT * FROM chat_inquiries ORDER BY id ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true, chats: rows });
  });
});

app.post('/api/chat-inquiries', (req, res) => {
  const { userId, userName, sender, message } = req.body;
  const timestamp = new Date().toLocaleString('ko-KR');

  db.run(
    `INSERT INTO chat_inquiries (userId, userName, sender, message, timestamp, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
    [userId, userName, sender, message, timestamp],
    function (err) {
      if (err) return res.status(500).json({ success: false });
      addLiveLog('CHAT', `[1:1 문의] ${userName}(${userId})님의 문의: "${message}"`);
      res.json({ success: true });
    }
  );
});

// ----------------------------------------------------
// Invoices (수수료 명세서) API
// ----------------------------------------------------
app.get('/api/invoices', (req, res) => {
  db.all("SELECT * FROM invoices ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true, invoices: rows });
  });
});

app.get('/api/invoices/:employerId', (req, res) => {
  db.all("SELECT * FROM invoices WHERE employerId = ? AND isFullyConfirmed = 0", [req.params.employerId], (err, rows) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true, invoices: rows });
  });
});

app.post('/api/invoices/request-confirm', (req, res) => {
  const { invoiceId } = req.body;
  db.run("UPDATE invoices SET status = 'PENDING_ADMIN' WHERE id = ?", [invoiceId], function (err) {
    if (err) return res.status(500).json({ success: false });
    addLiveLog('INVOICE_REQ', `[명세서 입금확인] 사장님이 명세서(${invoiceId}) 입금 확인을 요청했습니다.`);
    res.json({ success: true });
  });
});

// 명세서 취소 신청 API
app.post('/api/invoices/request-cancel', (req, res) => {
  const { invoiceId } = req.body;
  db.run("UPDATE invoices SET cancelRequested = 1 WHERE id = ?", [invoiceId], function (err) {
    if (err) return res.status(500).json({ success: false });
    addLiveLog('INVOICE_CANCEL_REQ', `[명세서 취소요청] 사장님이 명세서(${invoiceId}) 취소 승인을 요청했습니다.`);
    res.json({ success: true });
  });
});

app.post('/api/invoices/admin-confirm', (req, res) => {
  const { invoiceId } = req.body;
  db.get("SELECT * FROM invoices WHERE id = ?", [invoiceId], (err, inv) => {
    if (!inv) return res.status(404).json({ success: false, message: '명세서를 찾을 수 없습니다.' });

    db.run("UPDATE invoices SET isFullyConfirmed = 1 WHERE id = ?", [invoiceId], function (err2) {
      if (err2) return res.status(500).json({ success: false });

      const notiId = 'noti-' + Date.now();
      const dateStr = new Date().toLocaleString('ko-KR');
      db.run(
        `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
        [notiId, inv.employerId, '[명세서 처리 완료]', `'${inv.jobTitle}' 건에 대한 수수료 납부 명세서 정산 처리가 완료되었습니다.`, dateStr]
      );

      addLiveLog('INVOICE_OK', `[명세서 완료] 관리자가 명세서(${invoiceId}) 처리를 완료했습니다.`);
      res.json({ success: true });
    });
  });
});

// 명세서 취소 승인 API
app.post('/api/invoices/admin-approve-cancel', (req, res) => {
  const { invoiceId } = req.body;
  db.run("DELETE FROM invoices WHERE id = ?", [invoiceId], function (err) {
    if (err) return res.status(500).json({ success: false });
    addLiveLog('INVOICE_CANCELED', `[명세서 취소승인] 관리자가 명세서(${invoiceId})를 취소 처리했습니다.`);
    res.json({ success: true });
  });
});

// ----------------------------------------------------
// Jobs API (업종 6종 확장 및 공고/지원자 통제)
// ----------------------------------------------------
app.get('/api/jobs', (req, res) => {
  db.all("SELECT * FROM jobs ORDER BY isPeak DESC, id DESC", [], (err, jobs) => {
    if (err) return res.status(500).json({ success: false });

    db.all("SELECT * FROM job_candidates", [], (err2, cands) => {
      if (err2) return res.status(500).json({ success: false });

      const jobMap = jobs.map(j => {
        j.candidates = cands.filter(c => c.jobId === j.id);
        return j;
      });
      res.json({ success: true, jobs: jobMap });
    });
  });
});

app.post('/api/jobs', (req, res) => {
  const { employerId, storeName, title, category, date, time, pay, isPeak, regionMain, regionSub, address, description } = req.body;

  db.get("SELECT * FROM users WHERE id = ?", [employerId], (err, employer) => {
    if (isPeak && (!employer || !employer.isSubscribed)) {
      return res.status(403).json({ success: false, message: '상단 고정 공고는 구독 회원 사장님만 이용 가능합니다.' });
    }

    const jobId = 'job-' + Date.now();
    const finalTitle = isPeak ? `[상단 고정] ${title}` : title;

    db.run(
      `INSERT INTO jobs (id, employerId, storeName, title, category, date, time, pay, isPeak, regionMain, regionSub, address, description, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '구직자 모집중')`,
      [jobId, employerId, storeName, finalTitle, category || '음식', date, time, parseInt(pay, 10), isPeak ? 1 : 0, regionMain || '서울특별시', regionSub || '전체', address || '', description || ''],
      function (err2) {
        if (err2) return res.status(500).json({ success: false, message: '공고 등록 실패' });

        addLiveLog('JOB_CREATE', `[공고등록] ${storeName}에서 '${finalTitle}' 구인 공고를 등록했습니다.`);
        res.json({ success: true, jobId });
      }
    );
  });
});

app.put('/api/jobs/:id', (req, res) => {
  const { title, pay, date, time, address, description, category } = req.body;
  db.run(
    `UPDATE jobs SET title = ?, pay = ?, date = ?, time = ?, address = ?, description = ?, category = ? WHERE id = ?`,
    [title, parseInt(pay, 10), date, time, address, description, category, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ success: false });
      addLiveLog('JOB_UPDATE', `[공고수정] 공고 ID(${req.params.id})가 수정되었습니다.`);
      res.json({ success: true });
    }
  );
});

// 공고 삭제 (지원 시니어 전원에게 자동 알림 발송)
app.delete('/api/jobs/:id', (req, res) => {
  db.all("SELECT seniorId FROM job_candidates WHERE jobId = ?", [req.params.id], (err, cands) => {
    if (cands && cands.length > 0) {
      const dateStr = new Date().toLocaleString('ko-KR');
      cands.forEach(c => {
        const notiId = 'noti-' + Date.now() + '-' + Math.random();
        db.run(
          `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
          [notiId, c.seniorId, '[공고 삭제 알림]', `지원하신 공고가 사장님 또는 관리자에 의해 삭제되어 내역이 정리되었습니다.`, dateStr]
        );
      });
    }

    db.run("DELETE FROM job_candidates WHERE jobId = ?", [req.params.id], () => {
      db.run("DELETE FROM jobs WHERE id = ?", [req.params.id], function (err2) {
        if (err2) return res.status(500).json({ success: false });
        addLiveLog('JOB_DELETE', `[공고삭제] 공고 ID(${req.params.id})가 삭제 처리되었습니다.`);
        res.json({ success: true });
      });
    });
  });
});

app.post('/api/jobs/:id/apply', (req, res) => {
  const { seniorId, name, phone } = req.body;
  const jobId = req.params.id;

  db.get("SELECT * FROM job_candidates WHERE jobId = ? AND seniorId = ?", [jobId, seniorId], (err, cand) => {
    if (cand) return res.status(400).json({ success: false, message: '이미 지원한 공고입니다.' });

    db.run(
      `INSERT INTO job_candidates (jobId, seniorId, name, phone, status, rank) VALUES (?, ?, ?, ?, '지원 완료 (사장님 검토 중)', NULL)`,
      [jobId, seniorId, name, phone || ''],
      function (err2) {
        if (err2) return res.status(500).json({ success: false });

        addLiveLog('APPLY', `[공고지원] 시니어 ${name}(${seniorId})님이 공고(${jobId})에 지원했습니다.`);
        res.json({ success: true });
      }
    );
  });
});

// 순위(1~3순위) 지정 고정 API
app.post('/api/jobs/:id/rank', (req, res) => {
  const { seniorId, rank } = req.body;
  const jobId = req.params.id;

  db.run(
    `UPDATE job_candidates SET rank = ?, status = ? WHERE jobId = ? AND seniorId = ?`,
    [rank, `${rank} 지정 완료`, jobId, seniorId],
    function (err) {
      if (err) return res.status(500).json({ success: false });

      const dateStr = new Date().toLocaleString('ko-KR');
      const notiId = 'noti-' + Date.now();
      db.run(
        `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
        [notiId, seniorId, '[순위 지정 알림]', `지적하신 공고에서 ${rank}로 지정되었습니다.`, dateStr]
      );

      res.json({ success: true });
    }
  );
});

app.post('/api/jobs/:id/hire', (req, res) => {
  const { seniorId } = req.body;
  const jobId = req.params.id;

  db.run(
    `UPDATE job_candidates SET status = '채용 확정' WHERE jobId = ? AND seniorId = ?`,
    [jobId, seniorId],
    function (err) {
      if (err) return res.status(500).json({ success: false });

      db.get("SELECT title FROM jobs WHERE id = ?", [jobId], (err2, job) => {
        const titleStr = job ? job.title : '공고';
        const dateStr = new Date().toLocaleString('ko-KR');
        const notiId = 'noti-' + Date.now();

        db.run(
          `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
          [notiId, seniorId, '[채용 확정 알림]', `'${titleStr}' 공고에 최종 채용되었습니다! 출근 준비를 시작해 주세요.`, dateStr]
        );

        addLiveLog('HIRE', `[채용확정] 시니어(${seniorId})님이 '${titleStr}' 공고에 최종 채용되었습니다.`);
        res.json({ success: true });
      });
    }
  );
});

// 시급 가산 문구가 전면 제거된 승계 채용 로직
app.post('/api/jobs/:id/cancel-hire', (req, res) => {
  const { seniorId } = req.body;
  const jobId = req.params.id;

  db.run(`UPDATE job_candidates SET status = '채용 취소됨' WHERE jobId = ? AND seniorId = ?`, [jobId, seniorId], function (err) {
    if (err) return res.status(500).json({ success: false });

    db.get("SELECT * FROM jobs WHERE id = ?", [jobId], (err2, job) => {
      const dateStr = new Date().toLocaleString('ko-KR');

      // 취소된 대상에게 알림
      const notiId1 = 'noti-' + Date.now();
      db.run(
        `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
        [notiId1, seniorId, '[채용 취소 알림]', `'${job.title}' 공고의 채용이 취소되었습니다.`, dateStr]
      );

      // 다음 2순위 / 3순위 순차 승계 채용
      db.all("SELECT * FROM job_candidates WHERE jobId = ? AND status != '채용 취소됨' ORDER BY CASE WHEN rank = '2순위' THEN 1 WHEN rank = '3순위' THEN 2 ELSE 3 END LIMIT 1", [jobId], (err3, nextCands) => {
        if (nextCands && nextCands.length > 0) {
          const promoted = nextCands[0];
          db.run(`UPDATE job_candidates SET status = '${promoted.rank} 승계 채용 확정' WHERE id = ?`, [promoted.id], () => {
            const notiId2 = 'noti-' + Date.now() + '-1';
            db.run(
              `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
              [notiId2, promoted.seniorId, '[자동 승계 채용 알림]', `'${job.title}' 공고에 이전 채용자의 사정으로 인해 ${promoted.rank} 승계 채용되었습니다!`, dateStr]
            );

            const notiId3 = 'noti-' + Date.now() + '-2';
            db.run(
              `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
              [notiId3, job.employerId, '[승계 채용 처리 알림]', `'${job.title}' 공고의 1순위 취소로 인해 ${promoted.name}님(${promoted.rank})이 자동 승계 채용되었습니다.`, dateStr]
            );
          });
        }
        res.json({ success: true });
      });
    });
  });
});

// 포인트 지급 및 투명한 수수료 명세서 생성
app.post('/api/jobs/:id/pay-points', (req, res) => {
  const { seniorId, basePay } = req.body;
  const jobId = req.params.id;

  db.get("SELECT * FROM jobs WHERE id = ?", [jobId], (err, job) => {
    if (!job) return res.status(404).json({ success: false, message: '공고를 찾을 수 없습니다.' });

    db.get("SELECT * FROM users WHERE id = ?", [job.employerId], (err2, employer) => {
      const payAmount = parseInt(basePay, 10);

      // 시니어 포인트 지급
      db.run("UPDATE users SET points = points + ? WHERE id = ?", [payAmount, seniorId], function () {
        // 수수료 산정 (구독 5%, 일반 10%)
        const feeRate = employer && employer.isSubscribed ? 0.05 : 0.10;
        const feeAmount = Math.round(payAmount * feeRate);
        const vat = Math.round(feeAmount * 0.10);
        const totalAmount = feeAmount + vat;

        const invId = 'inv-' + Date.now();
        const dateStr = new Date().toLocaleString('ko-KR');

        db.run(
          `INSERT INTO invoices (id, employerId, jobId, jobTitle, storeName, seniorId, workDate, basePay, feeRate, feeAmount, vat, totalAmount, date, status, isFullyConfirmed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', 0)`,
          [invId, job.employerId, jobId, job.title, job.storeName, seniorId, job.date, payAmount, feeRate, feeAmount, vat, totalAmount, dateStr],
          function () {
            // 시니어 지급 알림
            db.run(
              `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
              ['noti-' + Date.now() + '-1', seniorId, '[포인트 지급 완료]', `'${job.title}' 근무 대가로 ${payAmount.toLocaleString()}P가 지급되었습니다.`, dateStr]
            );

            // 사장님 수수료 명세서 발급 알림 (안전정산 문구 명시)
            db.run(
              `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
              ['noti-' + Date.now() + '-2', job.employerId, '[수수료 명세서 발행]', `'${job.title}' 채용에 따른 수수료 명세서(청구액 ${totalAmount.toLocaleString()}원)가 발행되었습니다. (사장님이 시니어에게 직접 현금을 지급하지 않아도 플랫폼을 통해 안전 정산됩니다)`, dateStr]
            );

            addLiveLog('PAY_POINTS', `[포인트지급] ${job.storeName}에서 시니어(${seniorId})에게 ${payAmount.toLocaleString()}P 지급 및 명세서 발행 완료.`);
            res.json({ success: true });
          }
        );
      });
    });
  });
});

// ----------------------------------------------------
// Surveys & Settlements API (10개 시중 은행)
// ----------------------------------------------------
app.get('/api/surveys', (req, res) => {
  db.all("SELECT * FROM surveys ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true, surveys: rows });
  });
});

app.post('/api/surveys', (req, res) => {
  const { seniorId, q1, q2, q3 } = req.body;
  const dateStr = new Date().toLocaleString('ko-KR');

  db.run(
    `INSERT INTO surveys (seniorId, q1, q2, q3, date) VALUES (?, ?, ?, ?, ?)`,
    [seniorId, q1 || '', q2 || '', q3 || '', dateStr],
    function (err) {
      if (err) return res.status(500).json({ success: false });
      db.run("UPDATE users SET hasSurvey = 1 WHERE id = ?", [seniorId]);
      res.json({ success: true });
    }
  );
});

app.get('/api/settlements', (req, res) => {
  db.all("SELECT * FROM settlements ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true, settlements: rows });
  });
});

app.post('/api/settlements', (req, res) => {
  const { userId, userName, bank, account, amount } = req.body;

  db.get("SELECT points FROM users WHERE id = ?", [userId], (err, user) => {
    if (!user || user.points < amount) {
      return res.status(400).json({ success: false, message: '보유 포인트가 부족합니다.' });
    }

    const settleId = 'settle-' + Date.now();
    const dateStr = new Date().toLocaleString('ko-KR');

    db.run(
      `INSERT INTO settlements (id, userId, userName, bank, account, amount, status, date) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
      [settleId, userId, userName, bank, account, parseInt(amount, 10), dateStr],
      function (err2) {
        if (err2) return res.status(500).json({ success: false });

        addLiveLog('SETTLE_REQ', `[정산요청] 시니어 ${userName}(${userId})님이 ${parseInt(amount).toLocaleString()}P 출금 정산을 요청했습니다.`);
        res.json({ success: true, settleId });
      }
    );
  });
});

app.post('/api/settlements/:id/complete', (req, res) => {
  db.get("SELECT * FROM settlements WHERE id = ?", [req.params.id], (err, settle) => {
    if (settle && settle.status === 'PENDING') {
      db.run("UPDATE settlements SET status = 'COMPLETED' WHERE id = ?", [req.params.id], () => {
        db.run("UPDATE users SET points = MAX(0, points - ?) WHERE id = ?", [settle.amount, settle.userId], () => {
          const dateStr = new Date().toLocaleString('ko-KR');
          const notiId = 'noti-' + Date.now();

          db.run(
            `INSERT INTO notifications (id, targetUserId, title, content, date, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
            [notiId, settle.userId, '[정산 완료 알림]', `요청하신 정산 금액 ${settle.amount.toLocaleString()}원(${settle.bank}) 입금 처리가 완료되었습니다.`, dateStr]
          );

          addLiveLog('SETTLE_OK', `[정산완료] 관리자가 시니어(${settle.userId})의 ${settle.amount.toLocaleString()}P 정산을 완료했습니다.`);
          res.json({ success: true });
        });
      });
    } else {
      res.json({ success: false, message: '이미 정산되었거나 존재하지 않는 내역입니다.' });
    }
  });
});

// ----------------------------------------------------
// Notifications API
// ----------------------------------------------------
app.get('/api/notifications/:userId', (req, res) => {
  db.all("SELECT * FROM notifications WHERE targetUserId = ? ORDER BY id DESC", [req.params.userId], (err, rows) => {
    if (err) return res.status(500).json({ success: false });
    const hasUnread = rows.some(n => n.isRead === 0);
    res.json({ success: true, notifications: rows, hasUnread });
  });
});

app.post('/api/notifications/:userId/read', (req, res) => {
  db.run("UPDATE notifications SET isRead = 1 WHERE targetUserId = ?", [req.params.userId], function (err) {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true });
  });
});

app.delete('/api/notifications/item/:id', (req, res) => {
  db.run("DELETE FROM notifications WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true });
  });
});

// ----------------------------------------------------
// 페이지 라우팅 & 서버 실행
// ----------------------------------------------------
const pages = ['index', 'jobs', 'job-detail', 'senior-apply', 'employer', 'admin', 'notifications', 'login', 'profile'];
pages.forEach(page => app.get(`/${page}`, (req, res) => res.sendFile(path.join(__dirname, 'public', `${page}.html`))));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`silverworks 서버가 포트 ${PORT}에서 작동 중입니다.`));