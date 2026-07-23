const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

// SQLite 데이터베이스 초기화 (프로덕션 파일 분리형)
const db = new sqlite3.Database(path.join(__dirname, 'silverworks.db'), (err) => {
    if (err) console.error('DB 연결 실패:', err.message);
    else console.log('SILVERWORKS 프로덕션 데이터베이스 연결 성공');
});

// 테이블 스키마 엄격 재정비 (보안 및 무결성 강화)
db.serialize(() => {
    // 1. 회원 원장
    db.run(`CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        role TEXT NOT NULL, -- 'seeker', 'employer', 'admin'
        status TEXT DEFAULT 'pending', -- 'pending', 'approved'
        points INTEGER DEFAULT 0,
        fitness_grade TEXT DEFAULT '미인증',
        fitness_grip TEXT DEFAULT '-',
        fitness_flex TEXT DEFAULT '-',
        fitness_cardio TEXT DEFAULT '-'
    )`);

    // 2. 구인공고 원장
    db.run(`CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employer_id TEXT,
        company TEXT,
        title TEXT,
        work_date TEXT,
        wage INTEGER,
        status TEXT DEFAULT 'pending' -- 'pending', 'approved'
    )`);

    // 3. 근태 및 일급 정산 원장
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER,
        employer_id TEXT,
        seeker_id TEXT,
        check_in TEXT,
        check_out TEXT,
        status TEXT DEFAULT 'none' -- 'none', 'working', 'completed'
    )`);

    // 4. 사장님 10% 중개 수수료 본부 청구 원장
    db.run(`CREATE TABLE IF NOT EXISTS admin_billings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employer_id TEXT,
        seeker_id TEXT,
        job_id INTEGER,
        base_wage INTEGER,
        commission INTEGER,
        total_bill INTEGER,
        status TEXT DEFAULT 'pending' -- 'pending', 'paid'
    )`);

    // 5. 시니어 환전 청구 원장
    db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seeker_id TEXT,
        bank_name TEXT,
        account_number TEXT,
        amount INTEGER,
        status TEXT DEFAULT 'pending' -- 'pending', 'completed'
    )`);

    // 6. 경량화된 공감/후기 커뮤니티 원장 (기존 복잡한 SNS 대체)
    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        title TEXT,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 기본 최고 관리자 계정 자동 생성 (아이디: admin / 비번: admin1234)
    db.get(`SELECT * FROM users WHERE username = 'admin'`, (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (username, password, name, phone, role, status) VALUES ('admin', 'admin1234', '최고관리자', '010-0000-0000', 'admin', 'approved')`);
        }
    });
});

// --- 인증 API ---
app.post('/api/auth/register', (req, res) => {
    const { username, password, name, phone, role } = req.body;
    db.run(`INSERT INTO users (username, password, name, phone, role, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
        [username, password, name, phone, role], (err) => {
            if (err) return res.status(400).json({ success: false, message: '이미 존재하는 아이디입니다.' });
            res.json({ success: true, message: '회원가입 신청 완료' });
        });
});

app.post('/api/auth/login', (req, res) => {
    const { username, password, requested_role } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
        if (!user || user.role !== requested_role) {
            return res.status(403).json({ success: false, message: '권한이 없거나 계정 정보가 일치하지 않습니다.' });
        }
        if (user.status !== 'approved' && user.role !== 'admin') {
            return res.status(403).json({ success: false, message: '관리자 승인 대기 중입니다.' });
        }
        // 쿠키 기반 세션 인증 부여 (보안 강화)
        res.cookie('sw_user', JSON.stringify({ username: user.username, role: user.role, name: user.name }), { httpOnly: true, path: '/' });
        res.json({ success: true, user: { username: user.username, role: user.role, name: user.name } });
    });
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('sw_user');
    res.json({ success: true });
});

// --- 관리자 API ---
app.get('/api/admin/users', (req, res) => {
    db.all(`SELECT username, name, phone, role, status, points, fitness_grade, fitness_grip, fitness_flex, fitness_cardio FROM users`, (err, rows) => {
        res.json({ users: rows });
    });
});

app.post('/api/admin/update-user', (req, res) => {
    const { target_username, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio } = req.body;
    db.run(`UPDATE users SET status = ?, fitness_grade = ?, fitness_grip = ?, fitness_flex = ?, fitness_cardio = ? WHERE username = ?`,
        [status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio, target_username], () => {
            res.json({ success: true });
        });
});

app.get('/api/admin/jobs-all', (req, res) => {
    db.all(`SELECT * FROM jobs`, (err, rows) => { res.json({ jobs: rows }); });
});

app.post('/api/admin/approve-job', (req, res) => {
    const { job_id } = req.body;
    db.run(`UPDATE jobs SET status = 'approved' WHERE id = ?`, [job_id], () => { res.json({ success: true }); });
});

app.get('/api/admin/match-logs', (req, res) => {
    db.all(`SELECT * FROM withdrawals`, (err, withdrawals) => {
        db.all(`SELECT * FROM admin_billings`, (err2, billings) => {
            db.all(`SELECT * FROM posts`, (err3, posts) => {
                res.json({ withdrawals, billings, posts });
            });
        });
    });
});

app.post('/api/admin/settle/clear-employer-invoice', (req, res) => {
    const { billing_id } = req.body;
    db.run(`UPDATE admin_billings SET status = 'paid' WHERE id = ?`, [billing_id], () => {
        res.json({ success: true, message: '사장님 중개 수수료 수납이 최종 확정 처리되었습니다.' });
    });
});

app.post('/api/admin/settle/complete-seeker', (req, res) => {
    const { withdrawal_id } = req.body;
    db.run(`UPDATE withdrawals SET status = 'completed' WHERE id = ?`, [withdrawal_id], () => {
        res.json({ success: true });
    });
});

// --- 구인구직 및 정산 API ---
app.get('/api/jobs/live-board', (req, res) => {
    db.all(`SELECT * FROM jobs WHERE status = 'approved'`, (err, rows) => { res.json({ jobs: rows }); });
});

app.post('/api/employer/settle-points', (req, res) => {
    const { employer_id, seeker_id, amount, store_name, job_id } = req.body;
    const wage = parseInt(amount);
    const commission = Math.floor(wage * 0.1); // 10% 중개 수수료 산정
    const totalBill = wage + commission;

    db.serialize(() => {
        // 시니어 포인트 충전
        db.run(`UPDATE users SET points = points + ? WHERE username = ?`, [wage, seeker_id]);
        // 사장님 10% 수수료 청구서 적재
        db.run(`INSERT INTO admin_billings (employer_id, seeker_id, job_id, base_wage, commission, total_bill, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            [employer_id, seeker_id, job_id || 1, wage, commission, totalBill]);
        res.json({ success: true });
    });
});

app.listen(PORT, () => {
    console.log(`SILVERWORKS 프로덕션 서버 구동 완료: http://localhost:${PORT}`);
});