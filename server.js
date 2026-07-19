// ==========================================================================
// SILVERWORKS (실버웍스) - 상용 실물 DB 실시간 연동 백엔드 시스템 [1/3]
// [특이사항] 임시 모의 데이터 전량 박멸, 가입 명단 즉시 동적 렌더링 결속 완료
// ==========================================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 10000; // 렌더 기본 포트 10000 최적화 바인딩

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 실물 SQLite3 데이터베이스 평생 강력 결속 장치
const dbPath = path.join(__dirname, 'silverworks.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("DB 결속 치명적 에러:", err.message);
});

// 악성 스크립트 코드 주입을 차단하는 XSS 방어 샌드박스
function sanitizeInput(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/\//g, '&#x2F;');
}

// 비밀번호 보호용 SHA-256 일방향 해시 암호화 알고리즘
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// 고용노동부 최저임금 규정 하한선 및 유해업종 금지어 세팅
const MINIMUM_WAGE = 10030;
const BAN_WORDS = ['유흥', '성매매', '유사성행위', '마사지', '안마시술소', '도우미'];
function checkBannedWords(text) {
    if (!text) return false;
    return BAN_WORDS.some(word => text.includes(word));
}

// 전산 데이터베이스 물리 마스터 테이블 연동 자동화 생성
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        role TEXT NOT NULL, 
        status TEXT DEFAULT 'pending',
        fitness_grade TEXT DEFAULT '미인증',
        fitness_grip TEXT DEFAULT '-',
        fitness_flex TEXT DEFAULT '-',
        fitness_cardio TEXT DEFAULT '-',
        account_info TEXT DEFAULT '-',
        points INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS senior_qa (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        q1 TEXT, q2 TEXT, q3 TEXT, q4 TEXT, q5 TEXT, q6 TEXT,
        q7 TEXT, q8 TEXT, q9 TEXT, q10 TEXT, q11 TEXT, q12 TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // 3. 구인자 공고 등록 심사 테이블 (1~3순위 결정사 매칭 인프라 결속)
    db.run(`CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employer_id TEXT NOT NULL,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        work_date TEXT NOT NULL,
        work_time TEXT NOT NULL,
        wage INTEGER NOT NULL,
        job_type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        rank_1 TEXT DEFAULT NULL,
        rank_2 TEXT DEFAULT NULL,
        rank_3 TEXT DEFAULT NULL,
        match_status TEXT DEFAULT 'open',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 4. 구직자 실시간 공고 지원자 내역 테이블
    db.run(`CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        seeker_id TEXT NOT NULL,
        status TEXT DEFAULT 'applied',
        work_done TEXT DEFAULT 'no',
        owner_approved TEXT DEFAULT 'no',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// [회원제 API] 오직 아이디/비밀번호 정보만으로 다이렉트 가입 처리 (본인인증 전산 생략)
app.post('/api/auth/register', (req, res) => {
    const { username, password, name, phone, role } = req.body;

    if (!username || !password || !name || !phone || !role) {
        return res.status(400).json({ success: false, message: "필수 가입 서식 정보가 누락되었습니다." });
    }

    if (checkBannedWords(username) || checkBannedWords(name)) {
        return res.status(400).json({ success: false, message: "등록 불가능한 단어가 포함되어 가입이 전산 거부되었습니다. 위반 시 관할 경찰서 수사 고발 조치됩니다." });
    }

    const cleanUsername = sanitizeInput(username);
    const cleanName = sanitizeInput(name);
    const cleanPhone = sanitizeInput(phone);
    const securedPassword = hashPassword(password);

    const query = `INSERT INTO users (username, password, name, phone, role, status) VALUES (?, ?, ?, ?, ?, 'pending')`;
    db.run(query, [cleanUsername, securedPassword, cleanName, cleanPhone, role], function(err) {
        if (err) {
            return res.status(400).json({ success: false, message: "이미 전산망에 등록되어 있는 사용 중인 아이디입니다." });
        }
        res.json({ success: true, message: "회원가입 신청이 정상 완료되었습니다. 실버웍스 신원 검증 승인 후 로그인이 가능합니다." });
    });
});

// [회원제 API] 사장님, 시니어 권한 분리 검증 보안 로그인 처리
app.post('/api/auth/login', (req, res) => {
    const { username, password, requested_role } = req.body;
    const securedPassword = hashPassword(password);

    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, securedPassword], (err, user) => {
        if (err || !user) {
            return res.status(400).json({ success: false, message: "아이디 또는 비밀번호 전산 불일치 오류입니다." });
        }
        if (user.role !== requested_role) {
            return res.status(403).json({ success: false, message: `해당 로그인 창은 ${requested_role === 'employer' ? '구인 사장님' : '구직 시니어'} 전용 채널입니다. 회원 권한 등급을 대조 확인해 주세요.` });
        }
        if (user.status === 'pending') {
            return res.status(403).json({ success: false, message: "현재 실버웍스 신원 및 권한 승인 대기 상태입니다. 승인 완료 후 진입 권한이 발급됩니다." });
        }
        res.json({
            success: true,
            user: { username: user.username, name: user.name, role: user.role, status: user.status }
        });
    });
});

// [최고관리자 API ★빈틈 제로 교정 완전판] 실시간 가입 대기 회원 전원 dynamic 리스트 일괄 반환 통로
app.get('/api/admin/users', (req, res) => {
    const query = `SELECT username, name, phone, role, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio FROM users ORDER BY id DESC`;
    db.all(query, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: "회원 데이터 통신 조회 실패" });
        }
        res.json({ success: true, users: rows });
    });
});
// 로그인 회원 전용 실시간 이력서 및 신원 프로필 데이터 동적 조회
app.get('/api/profile/me', (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ success: false, message: "인증 세션이 만료되었습니다. 다시 로그인해 주세요." });
    }
    db.get(`SELECT username, name, phone, role, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio, points, account_info FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ success: false, message: "존재하지 않는 회원 정보입니다." });
        }
        db.get(`SELECT * FROM senior_qa WHERE username = ?`, [username], (err, qa) => {
            res.json({
                success: true,
                profile: user,
                senior_answers: qa || null
            });
        });
    });
});

// 시니어 베테랑 12가지 질문지 데이터 보존 API
app.post('/api/senior/qa', (req, res) => {
    const { username, answers } = req.body;
    if (!answers || answers.length < 12) {
        return res.status(400).json({ success: false, message: "12가지 질문지 항목이 누락되었습니다." });
    }
    const query = `INSERT OR REPLACE INTO senior_qa (username, q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [username, ...answers.map(ans => sanitizeInput(ans))];
    db.run(query, params, function(err) {
        if (err) return res.status(500).json({ success: false, message: "전산 저장 오류" });
        res.json({ success: true, message: "실버웍스 표준 이력서 데이터가 성공적으로 보존되었습니다." });
    });
});

// 구인자 공고 등록 신청 API (최저임금 및 금지어 실시간 차단 락 내장)
app.post('/api/jobs/create', (req, res) => {
    const { employer_id, title, company, work_date, work_time, wage, job_type } = req.body;
    const parsedWage = parseInt(wage);

    if (parsedWage < MINIMUM_WAGE) {
        return res.status(400).json({ success: false, message: `고용노동부 최저임금 규정 위반으로 등록 거부되었습니다. (최저시급: ${MINIMUM_WAGE.toLocaleString()}원)` });
    }
    if (checkBannedWords(title) || checkBannedWords(company)) {
        return res.status(400).json({ success: false, message: "공고 내에 등록 불가능한 금지 단어가 포함되어 차단되었습니다." });
    }

    const query = `INSERT INTO jobs (employer_id, title, company, work_date, work_time, wage, job_type, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`;
    db.run(query, [employer_id, sanitizeInput(title), sanitizeInput(company), work_date, work_time, parsedWage, job_type], function(err) {
        if (err) return res.status(500).json({ success: false, message: "전산 오류" });
        res.json({ success: true, message: "구인 공고가 정상 접수되었습니다. 실버웍스 검토 후 기재됩니다." });
    });
});

app.post('/api/jobs/apply', (req, res) => {
    const { job_id, seeker_id } = req.body;
    db.run(`INSERT INTO applications (job_id, seeker_id, status) VALUES (?, ?, 'applied')`, [job_id, seeker_id], function(err) {
        if (err) return res.status(400).json({ success: false });
        res.json({ success: true, message: "지원되었습니다." });
    });
});

app.post('/api/jobs/set-rank', (req, res) => {
    const { job_id, rank_1, rank_2, rank_3 } = req.body;
    db.run(`UPDATE jobs SET rank_1 = ?, rank_2 = ?, rank_3 = ?, match_status = 'matched' WHERE id = ?`, [rank_1, rank_2, rank_3, job_id], function(err) {
        res.json({ success: true });
    });
});

app.post('/api/work/checkout', (req, res) => {
    const { app_id } = req.body;
    db.run(`UPDATE applications SET work_done = 'yes' WHERE id = ?`, [app_id], function(err) {
        res.json({ success: true, message: "퇴근 처리 완료." });
    });
});

app.post('/api/work/approve', (req, res) => {
    const { app_id, hours, wage_per_hour, seeker_id } = req.body;
    db.serialize(() => {
        db.run(`UPDATE applications SET owner_approved = 'yes' WHERE id = ?`, [app_id]);
        const totalPay = parseInt(hours) * parseInt(wage_per_hour);
        const netPoints = Math.floor(totalPay * 0.967); // 3.3% 원천징수 공제
        db.run(`UPDATE users SET points = points + ? WHERE username = ?`, [netPoints, seeker_id], function(err) {
            res.json({ success: true, message: "근무 승인 및 3.3% 사업소득세 원천공제 포인트 정산 완료." });
        });
    });
});

app.post('/api/points/withdraw', (req, res) => {
    const { username, account_info } = req.body;
    db.run(`UPDATE users SET account_info = ? WHERE username = ?`, [account_info, username], function(err) {
        res.json({ success: true, message: "수동 정산 요청 접수." });
    });
});

app.post('/api/admin/update-user', (req, res) => {
    const { target_username, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio } = req.body;
    db.run(`UPDATE users SET status = ?, fitness_grade = ?, fitness_grip = ?, fitness_flex = ?, fitness_cardio = ? WHERE username = ?`, [status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio, target_username], function(err) {
        res.json({ success: true });
    });
});

app.post('/api/admin/approve-job', (req, res) => {
    const { job_id, status } = req.body;
    db.run(`UPDATE jobs SET status = ? WHERE id = ?`, [status, job_id], function(err) {
        res.json({ success: true });
    });
});

app.get('/api/admin/billing-invoice', (req, res) => {
    const query = `SELECT j.employer_id, u.name as employer_name, u.status as membership_status, SUM(j.wage) as base_wage_total FROM jobs j JOIN users u ON j.employer_id = u.username WHERE j.status = 'approved' AND j.match_status = 'matched' GROUP BY j.employer_id`;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        const invoices = rows.map(row => {
            const isPremium = row.membership_status === 'premium';
            const rate = isPremium ? 1.05 : 1.10;
            return {
                employer_id: row.employer_id,
                employer_name: row.employer_name,
                membership_type: isPremium ? "프리미엄 연회원 (5%)" : "일반 비회원 (10%)",
                base_wage: row.base_wage_total,
                total_bill: Math.floor(row.base_wage_total * rate)
            };
        });
        res.json({ success: true, data: invoices });
    });
});

app.listen(PORT, () => {
    console.log(`실버웍스 상용 통합 회원제 백엔드 제어 엔진 구동 중 (포트: ${PORT})`);
});

module.exports = app;
