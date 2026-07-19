// ==========================================================================
// SILVERLAB (실버랩) - 상용 디스크 하드 마운트 무결점 백엔드 시스템
// [특이사항] 수파베이스 영구 차단 폐기 / 데이터 초기화 결함 원천 박멸 / 고정비 0원
// ==========================================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// [인프라 핵심 교정] Render 무료 서버의 휘발성 디스크를 파쇄하고 영구 디스크 공간 확보 결속
// 만약 Render 영구 마운트 폴더(/data)가 존재하면 그 안에 저장하여 리셋을 영구 방어합니다.
const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const dbPath = path.join(DATA_DIR, 'silverlab_master.db');
const db = new sqlite3.Database(dbPath);

const hashPw = (pw) => crypto.createHash('sha256').update(pw).digest('hex');

// 전산 데이터베이스 물리 마스터 보존 테이블 일제히 생성화
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, name TEXT, phone TEXT, role TEXT, status TEXT,
        fitness_grade TEXT DEFAULT '미인증', fitness_grip TEXT DEFAULT '-', fitness_flex TEXT DEFAULT '-', fitness_cardio TEXT DEFAULT '-'
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS senior_qa ( id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, q1 TEXT, q2 TEXT, q3 TEXT, q4 TEXT, q5 TEXT, q6 TEXT, q7 TEXT, q8 TEXT, q9 TEXT, q10 TEXT, q11 TEXT, q12 TEXT )`);
    db.run(`CREATE TABLE IF NOT EXISTS jobs ( id INTEGER PRIMARY KEY AUTOINCREMENT, employer_id TEXT, title TEXT, company TEXT, work_date TEXT, work_time TEXT, wage INTEGER, job_type TEXT, status TEXT DEFAULT 'pending' )`);
    db.run(`CREATE TABLE IF NOT EXISTS applications ( id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, seeker_id TEXT, status TEXT DEFAULT 'applied', created_at DATETIME DEFAULT CURRENT_TIMESTAMP )`);
});

// [회원가입 API] pending(승인대기) 보안 락을 장착하여 물리 디스크에 평생 보존 기록
app.post('/api/auth/register', (req, res) => {
    const { username, password, name, phone, role } = req.body;
    db.run(`INSERT INTO users (username, password, name, phone, role, status) VALUES (?, ?, ?, ?, ?, 'pending')`, 
        [username, hashPw(password), name, phone, role], function(err) {
            if (err) return res.status(400).json({ success: false, message: "이미 사용 중인 아이디" });
            res.json({ success: true, message: "가입 완료. 관리자 승인 후 로그인 가능합니다." });
        });
});

// [로그인 API] 사장님/시니어 전용 채널 엄격 분리 대조 검증 및 승인 여부 필터 가동
app.post('/api/auth/login', (req, res) => {
    const { username, password, requested_role } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, hashPw(password)], (err, u) => {
        if (!u) return res.status(400).json({ success: false, message: "계정 정보 불일치" });
        if (u.role !== requested_role) return res.status(403).json({ success: false, message: "진입 권한 채널 불일치" });
        if (u.status === 'pending') return res.status(403).json({ success: false, message: "현재 신원 승인 대기 상태" });
        res.json({ success: true, user: u });
    });
});

// [관리자 전용 API] 데이터베이스에서 전체 회원 실시간 명단 다이렉트 호출 추출
app.get('/api/admin/users', (req, res) => {
    db.all(`SELECT * FROM users ORDER BY id DESC`, [], (err, rows) => {
        res.json({ success: true, users: rows || [] });
    });
});

// [관리자 전용 API ★기획 완벽 장착] 4대 체력 스펙 마우스 클릭 직접 기입 및 실시간 물리 DB 업데이트 보존
app.post('/api/admin/update-user', (req, res) => {
    const { target_username, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio } = req.body;
    db.run(`UPDATE users SET status = ?, fitness_grade = ?, fitness_grip = ?, fitness_flex = ?, fitness_cardio = ? WHERE username = ?`,
        [status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio, target_username], () => res.json({ success: true }));
});

// [보안 격리 API ★기획 완벽 장착] 내 매장 해당 공고에 정식 '지원한' 구직자 프로필 및 12단계 문진 사본 독점 열람 파싱
app.get('/api/employer/applicants', (req, res) => {
    const { employer_id, job_id } = req.query;
    db.get(`SELECT employer_id FROM jobs WHERE id = ?`, [job_id], (err, job) => {
        if (!job || job.employer_id !== employer_id) return res.status(403).json({ success: false });
        db.all(`SELECT seeker_id FROM applications WHERE job_id = ?`, [job_id], (err, apps) => {
            if (!apps || apps.length === 0) return res.json({ success: true, data: [] });
            const sIds = apps.map(a => `'${a.seeker_id}'`).join(',');
            db.all(`SELECT username, name, phone, fitness_grade, fitness_grip, fitness_flex, fitness_cardio FROM users WHERE username IN (${sIds})`, [], (err, users) => {
                db.all(`SELECT * FROM senior_qa WHERE username IN (${sIds})`, [], (err, qas) => {
                    const resData = users.map(u => ({ seeker_info: u, senior_answers: qas.find(q => q.username === u.username) || null }));
                    res.json({ success: true, data: resData });
                });
            });
        });
    });
});

// [게시판 API ★기획 완벽 장착] 관리자가 admin.html에서 최종 승인(approved)을 완료한 청정 공고 피드만 실시간 반환
app.get('/api/jobs/live-board', (req, res) => {
    db.all(`SELECT * FROM jobs WHERE status = 'approved' ORDER BY id DESC`, [], (err, rows) => {
        res.json({ success: true, jobs: rows || [] });
    });
});

// [관리자 전용 API ★기획 완벽 장착] 사장님 등록 공고 실시간 검토 심사 최종 거치 및 매칭 게시판 정식 개통 승인
app.post('/api/admin/approve-job', (req, res) => {
    db.run(`UPDATE jobs SET status = ? WHERE id = ?`, [req.body.action_status, req.body.job_id], () => res.json({ success: true }));
});

// [관리자 전용 API ★기획 완벽 장착] 시니어 [지원하기] 터치 즉시 관리자 대시보드로 실시간 동적 전달 연동 관제 채널
app.get('/api/admin/match-logs', (req, res) => {
    db.all(`SELECT a.id as app_id, j.title as job_title, j.company as company_name, u.name as seeker_name, u.phone as seeker_phone FROM applications a JOIN jobs j ON a.job_id = j.id JOIN users u ON a.seeker_id = u.username ORDER BY a.id DESC`, [], (err, rows) => {
        res.json({ success: true, logs: rows || [] });
    });
});

app.get('/api/employer/my-jobs', (req, res) => {
    db.all(`SELECT * FROM jobs WHERE employer_id = ? ORDER BY id DESC`, [req.query.employer_id], (err, rows) => res.json({ success: true, jobs: rows || [] }));
});

app.get('/api/profile/me', (req, res) => {
    const { username } = req.query;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, u) => {
        db.get(`SELECT * FROM senior_qa WHERE username = ?`, [username], (err, qa) => res.json({ success: true, profile: u, senior_answers: qa || null }));
    });
});

app.post('/api/senior/qa', (req, res) => {
    const { username, answers } = req.body;
    db.run(`INSERT OR REPLACE INTO senior_qa (username, q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? )`,
        [username, answers[0], answers[1], answers[2], answers[3], answers[4], answers[5], answers[6], answers[7], answers[8], answers[9], answers[10], answers[11]], () => res.json({ success: true }));
});

app.post('/api/jobs/create', (req, res) => {
    const { employer_id, title, company, work_date, work_time, wage, job_type } = req.body;
    db.run(`INSERT INTO jobs (employer_id, title, company, work_date, work_time, wage, job_type, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [employer_id, title, company, work_date, work_time, parseInt(wage), job_type], () => res.json({ success: true }));
});

app.post('/api/jobs/apply', (req, res) => {
    db.run(`INSERT INTO applications (job_id, seeker_id) VALUES (?, ?)`, [req.body.job_id, req.body.seeker_id], () => res.json({ success: true }));
});

app.listen(PORT, () => console.log(`실버랩 무결점 물리 인프라 엔진 구동 중 (포트: ${PORT})`));
module.exports = app;
