const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Render PostgreSQL DB 연결 설정
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 데이터베이스 테이블 및 초기 관리자 데이터 자동 생성 (서버 가동 시 1회 실행)
async function initDB() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL 환경 변수가 없습니다. 데이터베이스 연동을 건너뜁니다.');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        pw VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(255),
        role VARCHAR(50) NOT NULL,
        approved BOOLEAN DEFAULT FALSE,
        points INT DEFAULT 0,
        is_subscribed BOOLEAN DEFAULT FALSE,
        sub_requested BOOLEAN DEFAULT FALSE,
        has_survey BOOLEAN DEFAULT FALSE,
        is_veteran BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id VARCHAR(255) PRIMARY KEY,
        employer_id VARCHAR(255),
        store_name VARCHAR(255),
        title VARCHAR(255),
        category VARCHAR(100),
        date VARCHAR(100),
        time VARCHAR(100),
        pay INT,
        is_peak BOOLEAN DEFAULT FALSE,
        region_main VARCHAR(100),
        region_sub VARCHAR(100),
        address TEXT,
        description TEXT,
        status VARCHAR(100) DEFAULT '구직자 모집중',
        candidates JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS surveys (
        id SERIAL PRIMARY KEY,
        senior_id VARCHAR(255),
        q1 TEXT,
        q2 TEXT,
        q3 TEXT,
        date VARCHAR(255)
      );

      CREATE TABLE IF NOT EXISTS settlements (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255),
        user_name VARCHAR(255),
        bank VARCHAR(100),
        account VARCHAR(255),
        amount INT,
        status VARCHAR(50) DEFAULT 'PENDING',
        date VARCHAR(255)
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(255) PRIMARY KEY,
        target_user_id VARCHAR(255),
        title VARCHAR(255),
        content TEXT,
        date VARCHAR(255),
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id VARCHAR(255) PRIMARY KEY,
        employer_id VARCHAR(255),
        job_id VARCHAR(255),
        job_title VARCHAR(255),
        store_name VARCHAR(255),
        senior_id VARCHAR(255),
        work_date VARCHAR(100),
        base_pay INT,
        fee_rate NUMERIC,
        fee_amount INT,
        vat INT,
        total_amount INT,
        date VARCHAR(255),
        status VARCHAR(100) DEFAULT 'ISSUED',
        is_fully_confirmed BOOLEAN DEFAULT FALSE,
        cancel_requested BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS live_logs (
        id VARCHAR(255) PRIMARY KEY,
        type VARCHAR(100),
        message TEXT,
        timestamp VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chat_inquiries (
        id BIGINT PRIMARY KEY,
        user_id VARCHAR(255),
        user_name VARCHAR(255),
        sender VARCHAR(50),
        message TEXT,
        timestamp VARCHAR(255),
        is_read BOOLEAN DEFAULT FALSE
      );
    `);

    // 초기 관리자 계정 기본 등록
    await pool.query(`
      INSERT INTO users (id, pw, name, role, approved, points, is_subscribed, has_survey, is_veteran)
      VALUES 
        ('silverworks', 'silverworks1@', '최고관리자', 'admin', true, 0, true, true, true),
        ('admin', '12345678', '최고관리자(구)', 'admin', true, 0, true, true, true)
      ON CONFLICT (id) DO NOTHING;
    `);

    // 서버 가동 로그 추가
    const logId = 'log-' + Date.now();
    const timestamp = new Date().toLocaleString('ko-KR');
    await pool.query(`
      INSERT INTO live_logs (id, type, message, timestamp)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING;
    `, [logId, 'SYSTEM', '실버웍스 플랫폼 서버가 정상 가동되었습니다.', timestamp]);

    console.log('PostgreSQL 유료 데이터베이스 테이블 스키마 초기화 완료');
  } catch (err) {
    console.error('DB 초기화 에러:', err);
  }
}

initDB();

async function addLiveLog(type, message) {
  const timestamp = new Date().toLocaleString('ko-KR');
  const id = 'log-' + Date.now();
  try {
    await pool.query(`
      INSERT INTO live_logs (id, type, message, timestamp)
      VALUES ($1, $2, $3, $4);
    `, [id, type, message, timestamp]);

    // 최신 50개 유지
    await pool.query(`
      DELETE FROM live_logs 
      WHERE id NOT IN (
        SELECT id FROM live_logs ORDER BY created_at DESC LIMIT 50
      );
    `);
  } catch (err) {
    console.error('addLiveLog error:', err);
  }
}

// Auth & Users API
app.post('/api/signup', async (req, res) => {
  const { id, pw, name, phone, role } = req.body;
  if (!id || !pw || !name || !role) return res.status(400).json({ success: false, message: '필수 회원가입 정보가 누락되었습니다.' });
  if (pw.length < 8) return res.status(400).json({ success: false, message: '비밀번호는 최소 8자리 이상이어야 합니다.' });

  try {
    const checkUser = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (checkUser.rows.length > 0) return res.status(400).json({ success: false, message: '이미 존재하는 아이디입니다.' });

    const newUser = { id, pw, name, phone: phone || '', role, approved: false, points: 0, is_subscribed: false, sub_requested: false, has_survey: false, is_veteran: false };
    
    await pool.query(`
      INSERT INTO users (id, pw, name, phone, role, approved, points, is_subscribed, sub_requested, has_survey, is_veteran)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [id, pw, name, phone || '', role, false, 0, false, false, false, false]);

    const notiId = 'noti-' + Date.now();
    const dateStr = new Date().toLocaleString('ko-KR');
    await pool.query(`
      INSERT INTO notifications (id, target_user_id, title, content, date, is_read)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [notiId, id, '[회원가입 축하]', `${name}님, silverworks 회원가입을 진심으로 축하합니다!`, dateStr, false]);

    await addLiveLog('SIGNUP', `[신규가입] ${name}(${role === 'senior' ? '시니어' : '사장님'}) 님이 가입 신청했습니다.`);
    res.json({ success: true, user: newUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { id, pw, role } = req.body;
  if ((id === 'silverworks' && pw === 'silverworks1@') || (id === 'admin' && pw === '1234')) {
    const adminUser = { id, pw, name: '최고관리자', role: 'admin', approved: true, points: 0, isSubscribed: true, hasSurvey: true, isVeteran: true };
    return res.json({ success: true, user: adminUser });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1 AND role = $2', [id, role]);
    if (result.rows.length === 0) return res.status(400).json({ success: false, message: '등록되지 않았거나 회원 유형이 일치하지 않습니다.' });

    const row = result.rows[0];
    if (row.pw !== pw) return res.status(400).json({ success: false, message: '비밀번호가 일치하지 않습니다.' });
    if (!row.approved) return res.status(400).json({ success: false, message: '관리자의 가입 승인 대기 중입니다.' });

    const user = {
      id: row.id,
      pw: row.pw,
      name: row.name,
      phone: row.phone,
      role: row.role,
      approved: row.approved,
      points: row.points,
      isSubscribed: row.is_subscribed,
      subRequested: row.sub_requested,
      hasSurvey: row.has_survey,
      isVeteran: row.is_veteran
    };

    await addLiveLog('LOGIN', `[로그인] ${user.name}(${user.id}) 님이 접속했습니다.`);
    res.json({ success: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    const users = result.rows.map(row => ({
      id: row.id,
      pw: row.pw,
      name: row.name,
      phone: row.phone,
      role: row.role,
      approved: row.approved,
      points: row.points,
      isSubscribed: row.is_subscribed,
      subRequested: row.sub_requested,
      hasSurvey: row.has_survey,
      isVeteran: row.is_veteran
    }));
    res.json({ success: true, users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

app.post('/api/users/:id/approve', async (req, res) => {
  try {
    await pool.query('UPDATE users SET approved = true WHERE id = $1', [req.params.id]);
    await addLiveLog('APPROVE', `[가입승인] 관리자가 회원(${req.params.id}) 가입을 승인했습니다.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/users/:id/update-points', async (req, res) => {
  const { points } = req.body;
  try {
    await pool.query('UPDATE users SET points = $1 WHERE id = $2', [parseInt(points, 10) || 0, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/users/:id/toggle-veteran', async (req, res) => {
  const { isVeteran } = req.body;
  try {
    const val = !!isVeteran;
    await pool.query('UPDATE users SET is_veteran = $1 WHERE id = $2', [val, req.params.id]);
    await addLiveLog('VETERAN', `[인증 베테랑] 시니어(${req.params.id}) 인증 상태가 ${val ? '부여' : '해제'}되었습니다.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/users/:id/subscribe-request', async (req, res) => {
  try {
    await pool.query('UPDATE users SET sub_requested = true WHERE id = $1', [req.params.id]);
    await addLiveLog('SUB_REQ', `[구독신청] 사장님(${req.params.id})이 월 20,000원 정기 구독권 승인을 요청했습니다.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/users/:id/approve-subscription', async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_subscribed = true, sub_requested = false WHERE id = $1', [req.params.id]);
    
    const notiId = 'noti-' + Date.now();
    const dateStr = new Date().toLocaleString('ko-KR');
    await pool.query(`
      INSERT INTO notifications (id, target_user_id, title, content, date, is_read)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [notiId, req.params.id, '[구독 승인 완료]', '사장님, 월 20,000원 정기 구독이 승인되어 공고 상단 고정 및 수수료 절반(5%) 혜택이 적용됩니다.', dateStr, false]);

    await addLiveLog('SUB_OK', `[구독승인] 사장님(${req.params.id})의 구독 승인이 완료되었습니다.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/users/:id/cancel-subscription', async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_subscribed = false, sub_requested = false WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/users/:id/warn', async (req, res) => {
  const { step } = req.body;
  try {
    const notiId = 'noti-' + Date.now();
    const dateStr = new Date().toLocaleString('ko-KR');
    await pool.query(`
      INSERT INTO notifications (id, target_user_id, title, content, date, is_read)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [notiId, req.params.id, `[긴급] 미납 수수료 납부 독촉 (${step}차 경고)`, `사장님, 실버웍스 수수료 미납건과 관련하여 ${step}차 경고 조치 되었습니다. 조속한 처리를 부탁드립니다.`, dateStr, false]);

    await addLiveLog('WARN', `[경고발송] 사장님(${req.params.id})에게 ${step}차 미납 경고를 발송했습니다.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/notifications/send-direct', async (req, res) => {
  const { targetUserId, title, content } = req.body;
  if (!targetUserId || !title || !content) return res.status(400).json({ success: false, message: '모든 항목을 입력해 주세요.' });

  try {
    const notiId = 'noti-' + Date.now();
    const dateStr = new Date().toLocaleString('ko-KR');
    await pool.query(`
      INSERT INTO notifications (id, target_user_id, title, content, date, is_read)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [notiId, targetUserId, title, content, dateStr, false]);

    await addLiveLog('DIRECT_NOTI', `[1:1 알림] (${targetUserId}) 회원에게 핀포인트 메시지를 전송했습니다.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    await addLiveLog('DELETE_USER', `[강제탈퇴] 관리자가 회원 ID (${req.params.id}) 계정을 삭제했습니다.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.get('/api/live-logs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM live_logs ORDER BY created_at DESC LIMIT 50');
    res.json({ success: true, logs: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, logs: [] });
  }
});

app.get('/api/chat-inquiries', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM chat_inquiries ORDER BY id ASC');
    const chats = result.rows.map(row => ({
      id: Number(row.id),
      userId: row.user_id,
      userName: row.user_name,
      sender: row.sender,
      message: row.message,
      timestamp: row.timestamp,
      isRead: row.is_read
    }));
    res.json({ success: true, chats });
  } catch (err) {
    res.status(500).json({ success: false, chats: [] });
  }
});

app.post('/api/chat-inquiries', async (req, res) => {
  const { userId, userName, sender, message } = req.body;
  const timestamp = new Date().toLocaleString('ko-KR');
  const id = Date.now();

  try {
    await pool.query(`
      INSERT INTO chat_inquiries (id, user_id, user_name, sender, message, timestamp, is_read)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [id, userId, userName, sender, message, timestamp, false]);

    await addLiveLog('CHAT', `[1:1 문의] ${userName}(${userId})님의 메시지: "${message}"`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.get('/api/invoices', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM invoices');
    const invoices = result.rows.map(r => ({
      id: r.id,
      employerId: r.employer_id,
      jobId: r.job_id,
      jobTitle: r.job_title,
      storeName: r.store_name,
      seniorId: r.senior_id,
      workDate: r.work_date,
      basePay: r.base_pay,
      feeRate: parseFloat(r.fee_rate),
      feeAmount: r.fee_amount,
      vat: r.vat,
      totalAmount: r.total_amount,
      date: r.date,
      status: r.status,
      isFullyConfirmed: r.is_fully_confirmed,
      cancelRequested: r.cancel_requested
    }));
    res.json({ success: true, invoices });
  } catch (err) {
    res.status(500).json({ success: false, invoices: [] });
  }
});

app.get('/api/invoices/:employerId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM invoices WHERE employer_id = $1 AND is_fully_confirmed = false', [req.params.employerId]);
    const list = result.rows.map(r => ({
      id: r.id,
      employerId: r.employer_id,
      jobId: r.job_id,
      jobTitle: r.job_title,
      storeName: r.store_name,
      seniorId: r.senior_id,
      workDate: r.work_date,
      basePay: r.base_pay,
      feeRate: parseFloat(r.fee_rate),
      feeAmount: r.fee_amount,
      vat: r.vat,
      totalAmount: r.total_amount,
      date: r.date,
      status: r.status,
      isFullyConfirmed: r.is_fully_confirmed,
      cancelRequested: r.cancel_requested
    }));
    res.json({ success: true, invoices: list });
  } catch (err) {
    res.status(500).json({ success: false, invoices: [] });
  }
});

app.post('/api/invoices/request-confirm', async (req, res) => {
  const { invoiceId } = req.body;
  try {
    await pool.query("UPDATE invoices SET status = 'PENDING_ADMIN' WHERE id = $1", [invoiceId]);
    await addLiveLog('INVOICE_REQ', `[명세서 입금확인] 사장님이 명세서(${invoiceId}) 입금 확인을 요청했습니다.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/invoices/request-cancel', async (req, res) => {
  const { invoiceId } = req.body;
  try {
    await pool.query("UPDATE invoices SET cancel_requested = true WHERE id = $1", [invoiceId]);
    await addLiveLog('INVOICE_CANCEL_REQ', `[명세서 취소요청] 사장님이 명세서(${invoiceId}) 취소 승인을 요청했습니다.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/invoices/admin-confirm', async (req, res) => {
  const { invoiceId } = req.body;
  try {
    const invRes = await pool.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
    if (invRes.rows.length > 0) {
      const inv = invRes.rows[0];
      await pool.query("UPDATE invoices SET is_fully_confirmed = true WHERE id = $1", [invoiceId]);
      
      const notiId = 'noti-' + Date.now();
      const dateStr = new Date().toLocaleString('ko-KR');
      await pool.query(`
        INSERT INTO notifications (id, target_user_id, title, content, date, is_read)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [notiId, inv.employer_id, '[명세서 처리 완료]', `'${inv.job_title}' 건에 대한 수수료 납부 명세서 정산 처리가 완료되었습니다.`, dateStr, false]);

      await addLiveLog('INVOICE_OK', `[명세서 완료] 관리자가 명세서(${invoiceId}) 처리를 완료했습니다.`);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/invoices/admin-approve-cancel', async (req, res) => {
  const { invoiceId } = req.body;
  try {
    await pool.query("DELETE FROM invoices WHERE id = $1", [invoiceId]);
    await addLiveLog('INVOICE_CANCELED', `[명세서 취소승인] 관리자가 명세서(${invoiceId})를 취소 처리했습니다.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.get('/api/jobs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM jobs ORDER BY created_at DESC');
    const jobs = result.rows.map(r => ({
      id: r.id,
      employerId: r.employer_id,
      storeName: r.store_name,
      title: r.title,
      category: r.category,
      date: r.date,
      time: r.time,
      pay: r.pay,
      isPeak: r.is_peak,
      regionMain: r.region_main,
      regionSub: r.region_sub,
      address: r.address,
      description: r.description,
      status: r.status,
      candidates: r.candidates || []
    }));
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, jobs: [] });
  }
});

app.post('/api/jobs', async (req, res) => {
  const { employerId, storeName, title, category, date, time, pay, isPeak, regionMain, regionSub, address, description } = req.body;
  
  try {
    const empRes = await pool.query('SELECT * FROM users WHERE id = $1', [employerId]);
    const employer = empRes.rows[0];

    if (isPeak && (!employer || !employer.is_subscribed)) {
      return res.status(403).json({ success: false, message: '상단 고정 공고는 구독 회원 사장님만 이용 가능합니다.' });
    }

    const newJobId = 'job-' + Date.now();
    const finalTitle = isPeak ? `[상단 고정] ${title}` : title;

    await pool.query(`
      INSERT INTO jobs (id, employer_id, store_name, title, category, date, time, pay, is_peak, region_main, region_sub, address, description, status, candidates)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [newJobId, employerId, storeName, finalTitle, category || '음식', date, time, parseInt(pay, 10), !!isPeak, regionMain || '서울특별시', regionSub || '전체', address || '', description || '', '구직자 모집중', JSON.stringify([])]);

    await addLiveLog('JOB_CREATE', `[공고등록] ${storeName}에서 '${finalTitle}' 구인 공고를 등록했습니다.`);
    res.json({ success: true, jobId: newJobId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

app.delete('/api/jobs/:id', async (req, res) => {
  try {
    const jobRes = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (jobRes.rows.length > 0) {
      const job = jobRes.rows[0];
      const candidates = job.candidates || [];

      for (const c of candidates) {
        const notiId = 'noti-' + Date.now() + '-' + Math.random();
        const dateStr = new Date().toLocaleString('ko-KR');
        await pool.query(`
          INSERT INTO notifications (id, target_user_id, title, content, date, is_read)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [notiId, c.seniorId, '[공고 삭제 알림]', `지원하신 '${job.title}' 공고가 사장님 또는 관리자에 의해 삭제되었습니다.`, dateStr, false]);
      }

      await pool.query('DELETE FROM jobs WHERE id = $1', [req.params.id]);
      await addLiveLog('JOB_DELETE', `[공고삭제] 공고 ID(${req.params.id})가 삭제 처리되었습니다.`);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/jobs/:id/apply', async (req, res) => {
  const { seniorId, name, phone } = req.body;
  try {
    const jobRes = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (jobRes.rows.length === 0) return res.status(404).json({ success: false, message: '공고를 찾을 수 없습니다.' });

    const job = jobRes.rows[0];
    let candidates = job.candidates || [];

    if (candidates.find(c => c.seniorId === seniorId)) {
      return res.status(400).json({ success: false, message: '이미 지원한 공고입니다.' });
    }

    candidates.push({ seniorId, name, phone, status: '지원 완료 (사장님 검토 중)', rank: null });

    await pool.query('UPDATE jobs SET candidates = $1 WHERE id = $2', [JSON.stringify(candidates), req.params.id]);
    await addLiveLog('APPLY', `[공고지원] 시니어 ${name}(${seniorId})님이 공고에 지원했습니다.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/jobs/:id/rank', async (req, res) => {
  const { seniorId, rank } = req.body;
  try {
    const jobRes = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (jobRes.rows.length > 0) {
      const job = jobRes.rows[0];
      let candidates = job.candidates || [];
      const cand = candidates.find(c => c.seniorId === seniorId);
      if (cand) {
        cand.rank = rank;
        cand.status = `${rank} 지정 완료`;
      }

      await pool.query('UPDATE jobs SET candidates = $1 WHERE id = $2', [JSON.stringify(candidates), req.params.id]);

      const notiId = 'noti-' + Date.now();
      const dateStr = new Date().toLocaleString('ko-KR');
      await pool.query(`
        INSERT INTO notifications (id, target_user_id, title, content, date, is_read)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [notiId, seniorId, '[순위 지정 알림]', `'${job.title}' 공고에서 ${rank}로 지정되었습니다.`, dateStr, false]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/jobs/:id/hire', async (req, res) => {
  const { seniorId } = req.body;
  try {
    const jobRes = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (jobRes.rows.length > 0) {
      const job = jobRes.rows[0];
      let candidates = job.candidates || [];
      const cand = candidates.find(c => c.seniorId === seniorId);
      if (cand) cand.status = '채용 확정';

      await pool.query('UPDATE jobs SET candidates = $1 WHERE id = $2', [JSON.stringify(candidates), req.params.id]);

      const notiId = 'noti-' + Date.now();
      const dateStr = new Date().toLocaleString('ko-KR');
      await pool.query(`
        INSERT INTO notifications (id, target_user_id, title, content, date, is_read)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [notiId, seniorId, '[채용 확정 알림]', `'${job.title}' 공고에 최종 채용되었습니다! 출근 준비를 시작해 주세요.`, dateStr, false]);

      await addLiveLog('HIRE', `[채용확정] 시니어(${seniorId})님이 '${job.title}' 공고에 최종 채용되었습니다.`);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/jobs/:id/cancel-hire', async (req, res) => {
  const { seniorId } = req.body;
  try {
    const jobRes = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (jobRes.rows.length > 0) {
      const job = jobRes.rows[0];
      let candidates = job.candidates || [];
      const cand = candidates.find(c => c.seniorId === seniorId);
      if (cand) cand.status = '채용 취소됨';

      const dateStr = new Date().toLocaleString('ko-KR');

      const notiId1 = 'noti-' + Date.now();
      await pool.query(`
        INSERT INTO notifications (id, target_user_id, title, content, date, is_read)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [notiId1, seniorId, '[채용 취소 알림]', `'${job.title}' 공고의 채용이 취소되었습니다.`, dateStr, false]);

      const nextCand = candidates.find(c => (c.rank === '2순위' || c.rank === '3순위') && c.status !== '채용 취소됨');
      if (nextCand) {
        nextCand.status = `${nextCand.rank} 승계 채용 확정`;
        const notiId2 = 'noti-' + Date.now() + '-1';
        await pool.query(`
          INSERT INTO notifications (id, target_user_id, title, content, date, is_read)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [notiId2, nextCand.seniorId, '[자동 승계 채용 알림]', `'${job.title}' 공고에 이전 채용자의 사정으로 인해 ${nextCand.rank} 승계 채용되었습니다!`, dateStr, false]);
      }

      await pool.query('UPDATE jobs SET candidates = $1 WHERE id = $2', [JSON.stringify(candidates), req.params.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 명세서 금액 계산 공식: 기본일당 + 수수료 + 부가가치세 = 최종 청구액
app.post('/api/jobs/:id/pay-points', async (req, res) => {
  const { seniorId, basePay } = req.body;
  try {
    const jobRes = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    const seniorRes = await pool.query('SELECT * FROM users WHERE id = $1', [seniorId]);

    if (jobRes.rows.length > 0 && seniorRes.rows.length > 0) {
      const job = jobRes.rows[0];
      const senior = seniorRes.rows[0];

      const empRes = await pool.query('SELECT * FROM users WHERE id = $1', [job.employer_id]);
      const employer = empRes.rows[0];

      const payAmount = parseInt(basePay, 10);
      const newPoints = (senior.points || 0) + payAmount;

      await pool.query('UPDATE users SET points = $1 WHERE id = $2', [newPoints, seniorId]);

      const feeRate = employer && employer.is_subscribed ? 0.05 : 0.10;
      const feeAmount = Math.round(payAmount * feeRate);
      const vat = Math.round(feeAmount * 0.10);
      const totalAmount = payAmount + feeAmount + vat;

      const invId = 'inv-' + Date.now();
      const dateStr = new Date().toLocaleString('ko-KR');

      await pool.query(`
        INSERT INTO invoices (id, employer_id, job_id, job_title, store_name, senior_id, work_date, base_pay, fee_rate, fee_amount, vat, total_amount, date, status, is_fully_confirmed, cancel_requested)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `, [invId, job.employer_id, job.id, job.title, job.store_name, seniorId, job.date, payAmount, feeRate, feeAmount, vat, totalAmount, dateStr, 'ISSUED', false, false]);

      const notiId1 = 'noti-' + Date.now() + '-1';
      await pool.query(`
        INSERT INTO notifications (id, target_user_id, title, content, date, is_read)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [notiId1, seniorId, '[포인트 지급 완료]', `'${job.title}' 근무 대가로 ${payAmount.toLocaleString()}P가 지급되었습니다.`, dateStr, false]);

      const notiId2 = 'noti-' + Date.now() + '-2';
      await pool.query(`
        INSERT INTO notifications (id, target_user_id, title, content, date, is_read)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [notiId2, job.employer_id, '[수수료 명세서 발행]', `'${job.title}' 채용에 따른 수수료 명세서(최종 청구액 ${totalAmount.toLocaleString()}원)가 발행되었습니다. (사장님이 시니어에게 직접 현금을 지급하지 않아도 플랫폼을 통해 안전 정산됩니다)`, dateStr, false]);

      await addLiveLog('PAY_POINTS', `[포인트지급] ${job.store_name}에서 시니어(${seniorId})에게 ${payAmount.toLocaleString()}P 지급 및 명세서 발행 완료.`);
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

app.get('/api/surveys', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM surveys ORDER BY id DESC');
    const surveys = result.rows.map(r => ({
      seniorId: r.senior_id,
      q1: r.q1,
      q2: r.q2,
      q3: r.q3,
      date: r.date
    }));
    res.json({ success: true, surveys });
  } catch (err) {
    res.status(500).json({ success: false, surveys: [] });
  }
});

app.post('/api/surveys', async (req, res) => {
  const { seniorId, q1, q2, q3 } = req.body;
  const dateStr = new Date().toLocaleString('ko-KR');

  try {
    await pool.query(`
      INSERT INTO surveys (senior_id, q1, q2, q3, date)
      VALUES ($1, $2, $3, $4, $5)
    `, [seniorId, q1, q2, q3, dateStr]);

    await pool.query('UPDATE users SET has_survey = true WHERE id = $1', [seniorId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.get('/api/settlements', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settlements');
    const settlements = result.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      bank: r.bank,
      account: r.account,
      amount: r.amount,
      status: r.status,
      date: r.date
    }));
    res.json({ success: true, settlements });
  } catch (err) {
    res.status(500).json({ success: false, settlements: [] });
  }
});

app.post('/api/settlements', async (req, res) => {
  const { userId, userName, bank, account, amount } = req.body;
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) return res.status(400).json({ success: false, message: '회원 정보를 찾을 수 없습니다.' });

    const user = userRes.rows[0];
    const settleAmount = parseInt(amount, 10);
    if (user.points < settleAmount) return res.status(400).json({ success: false, message: '보유 포인트가 부족합니다.' });

    const settleId = 'settle-' + Date.now();
    const dateStr = new Date().toLocaleString('ko-KR');

    await pool.query(`
      INSERT INTO settlements (id, user_id, user_name, bank, account, amount, status, date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [settleId, userId, userName, bank, account, settleAmount, 'PENDING', dateStr]);

    await addLiveLog('SETTLE_REQ', `[정산요청] 시니어 ${userName}(${userId})님이 ${settleAmount.toLocaleString()}P 출금 정산을 요청했습니다.`);
    res.json({ success: true, settlement: { id: settleId, userId, userName, bank, account, amount: settleAmount, status: 'PENDING', date: dateStr } });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/settlements/:id/complete', async (req, res) => {
  try {
    const setRes = await pool.query('SELECT * FROM settlements WHERE id = $1', [req.params.id]);
    if (setRes.rows.length > 0) {
      const settle = setRes.rows[0];
      if (settle.status === 'PENDING') {
        await pool.query("UPDATE settlements SET status = 'COMPLETED' WHERE id = $1", [req.params.id]);

        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [settle.user_id]);
        if (userRes.rows.length > 0) {
          const user = userRes.rows[0];
          const newPoints = Math.max(0, user.points - settle.amount);
          await pool.query('UPDATE users SET points = $1 WHERE id = $2', [newPoints, settle.user_id]);

          const notiId = 'noti-' + Date.now();
          const dateStr = new Date().toLocaleString('ko-KR');
          await pool.query(`
            INSERT INTO notifications (id, target_user_id, title, content, date, is_read)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [notiId, user.id, '[정산 완료 알림]', `요청하신 정산 금액 ${settle.amount.toLocaleString()}원(${settle.bank}) 입금 처리가 완료되었습니다.`, dateStr, false]);

          await addLiveLog('SETTLE_OK', `[정산완료] 관리자가 시니어(${settle.user_id})의 ${settle.amount.toLocaleString()}P 정산을 완료했습니다.`);
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notifications WHERE target_user_id = $1 ORDER BY created_at DESC', [req.params.userId]);
    const userNotis = result.rows.map(r => ({
      id: r.id,
      targetUserId: r.target_user_id,
      title: r.title,
      content: r.content,
      date: r.date,
      isRead: r.is_read
    }));
    const hasUnread = userNotis.some(n => !n.isRead);
    res.json({ success: true, notifications: userNotis, hasUnread });
  } catch (err) {
    res.status(500).json({ success: false, notifications: [], hasUnread: false });
  }
});

app.post('/api/notifications/:userId/read', async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET is_read = true WHERE target_user_id = $1', [req.params.userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.delete('/api/notifications/item/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM notifications WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

const pages = ['index', 'jobs', 'job-detail', 'senior-apply', 'employer', 'admin', 'notifications', 'login', 'profile'];
pages.forEach(page => app.get(`/${page}`, (req, res) => res.sendFile(path.join(__dirname, 'public', `${page}.html`))));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`silverworks 서버가 포트 ${PORT}에서 무오류 작동 중입니다.`));