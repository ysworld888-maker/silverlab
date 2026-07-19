// ==========================================================================
// SILVERWORKS (실버웍스) - 상용 디스크 하드 마운트 무결점 백엔드 제어 시스템
// [특이사항] 파일별 전/중/후반부 3단계 분할 / 이모티콘 전량 박멸 / 오션블루 통합
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

// Render 서버의 휴면 시 초기화 결함을 영구 방어하기 위한 마운트 디스크 경로 바인딩
const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const dbPath = path.join(DATA_DIR, 'silverworks_final_system.db');
const db = new sqlite3.Database(dbPath);

const hashPw = (pw) => crypto.createHash('sha256').update(pw).digest('hex');

// [인프라 혁신 교정] 사장님 공고 관리자 승인제 및 지원자 1/2/3순위 지정 컬럼 반영 구조 생성
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, name TEXT, phone TEXT, role TEXT, status TEXT,
        fitness_grade TEXT DEFAULT '미인증', fitness_grip TEXT DEFAULT '-', fitness_flex TEXT DEFAULT '-', fitness_cardio TEXT DEFAULT '-'
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS senior_qa ( 
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, 
        q1 TEXT, q2 TEXT, q3 TEXT, q4 TEXT, q5 TEXT, q6 TEXT, q7 TEXT, q8 TEXT, q9 TEXT, q10 TEXT, q11 TEXT, q12 TEXT 
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS jobs ( 
        id INTEGER PRIMARY KEY AUTOINCREMENT, employer_id TEXT, title TEXT, company TEXT, work_date TEXT, work_time TEXT, wage INTEGER, job_type TEXT, status TEXT DEFAULT 'pending' 
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS applications ( 
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, seeker_id TEXT, status TEXT DEFAULT 'applied', 
        rank_priority INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP 
    )`);
});
// 회원가입 API - pending 승인대기 보안 락을 장착하여 서버 디스크 저장소에 원천 보존
app.post('/api/auth/register', (req, res) => {
    const { username, password, name, phone, role } = req.body;
    db.run(`INSERT INTO users (username, password, name, phone, role, status) VALUES (?, ?, ?, ?, ?, 'pending')`, 
        [username, hashPw(password), name, phone, role], function(err) {
            if (err) return res.status(400).json({ success: false, message: "이미 사용 중인 아이디" });
            res.json({ success: true, message: "가입 완료" });
        });
});

// 로그인 API - 사장님/시니어 권한 등급 엄격 대조 및 승인 상태 채널별 교차 검증 필터 작동
app.post('/api/auth/login', (req, res) => {
    const { username, password, requested_role } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, hashPw(password)], (err, u) => {
        if (!u) return res.status(400).json({ success: false, message: "계정 정보 불일치" });
        if (u.role !== requested_role) return res.status(403).json({ success: false, message: "진입 권한 채널 불일치" });
        if (u.status === 'pending') return res.status(403).json({ success: false, message: "현재 신원 승인 대기 상태" });
        res.json({ success: true, user: u });
    });
});

// 최고관리자 API - 전체 회원 실시간 명단 호출 추출
app.get('/api/admin/users', (req, res) => {
    db.all(`SELECT * FROM users ORDER BY id DESC`, [], (err, rows) => res.json({ success: true, users: rows || [] }));
});

// 최고관리자 API - 4대 체력 측정 수치 직접 기입 시 서버 디스크 실시간 양방향 영구 보존
app.post('/api/admin/update-user', (req, res) => {
    const { target_username, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio } = req.body;
    db.run(`UPDATE users SET status = ?, fitness_grade = ?, fitness_grip = ?, fitness_flex = ?, fitness_cardio = ? WHERE username = ?`,
        [status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio, target_username], () => res.json({ success: true }));
});
// 구인 공고 직접 등록 API - 사장님이 입력한 피크타임 일자리를 디스크 DB에 실시간 적재 (초기 상태: pending)
app.post('/api/jobs/create', (req, res) => {
    const { employer_id, title, company, work_date, work_time, wage, job_type } = req.body;
    db.run(`INSERT INTO jobs (employer_id, title, company, work_date, work_time, wage, job_type, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [employer_id, title, company, work_date, work_time, parseInt(wage), job_type], () => res.json({ success: true }));
});

// [우선순위 지망 등급 이식 명세 API] 사장님이 화면에서 직접 1지망, 2지망, 3지망 지정을 선택 클릭 시 실시간 각인 보존
app.post('/api/employer/update-rank', (req, res) => {
    const { job_id, seeker_id, rank_priority } = req.body;
    db.run(`UPDATE applications SET rank_priority = ? WHERE job_id = ? AND seeker_id = ?`,
        [parseInt(rank_priority), job_id, seeker_id], () => res.json({ success: true }));
});

// 보안 격리 API - 내 공고에 정식 지원서 접수를 마친 시니어 프로필 및 12단계 문진 원본 사본 독점 추출 (우선순위 지표 바인딩)
app.get('/api/employer/applicants', (req, res) => {
    const { employer_id, job_id } = req.query;
    db.get(`SELECT employer_id FROM jobs WHERE id = ?`, [job_id], (err, job) => {
        if (!job || job.employer_id !== employer_id) return res.status(403).json({ success: false });
        // 우선순위가 높은 순(1순위->2순위->3순위->미지정) 및 접수 순으로 상용 정렬 추출
        db.all(`SELECT seeker_id, rank_priority FROM applications WHERE job_id = ? ORDER BY CASE WHEN rank_priority = 0 THEN 999 ELSE rank_priority END ASC, id ASC`, [job_id], (err, apps) => {
            if (!apps || apps.length === 0) return res.json({ success: true, data: [] });
            const sIds = apps.map(a => `'${a.seeker_id}'`).join(',');
            db.all(`SELECT username, name, phone, fitness_grade, fitness_grip, fitness_flex, fitness_cardio FROM users WHERE username IN (${sIds})`, [], (err, users) => {
                db.all(`SELECT * FROM senior_qa WHERE username IN (${sIds})`, [], (err, qas) => {
                    const resData = apps.map(a => {
                        const u = users.find(user => user.username === a.seeker_id);
                        return {
                            seeker_info: u || { username: a.seeker_id, name: "알수없음", phone: "-" },
                            rank_priority: a.rank_priority,
                            senior_answers: qas.find(q => q.username === a.seeker_id) || null
                        };
                    });
                    res.json({ success: true, data: resData });
                });
            });
        });
    });
});

// 매칭 게시판 API - 관리자가 admin.html에서 심사 '최종 승인(approved)'을 완수한 공고 리스트 피드만 반환
app.get('/api/jobs/live-board', (req, res) => {
    db.all(`SELECT * FROM jobs WHERE status = 'approved' ORDER BY id DESC`, [], (err, rows) => res.json({ success: true, jobs: rows || [] }));
});

// 최고관리자 API - 사장님이 등록 신청한 구인공고 리스트 실시간 관제판 표출용 전체 호출
app.get('/api/admin/jobs-all', (req, res) => {
    db.all(`SELECT * FROM jobs ORDER BY id DESC`, [], (err, rows) => res.json({ success: true, jobs: rows || [] }));
});

// 최고관리자 API - 사장님 등록 공고 심사 승인 단추 클릭 즉시 매칭 게시판 공식 기재 개통 처리
app.post('/api/admin/approve-job', (req, res) => {
    db.run(`UPDATE jobs SET status = ? WHERE id = ?`, [req.body.action_status, req.body.job_id], () => res.json({ success: true }));
});

// 최고관리자 API - 시니어 지원 및 사장님 순위 지정 트랜잭션을 종합 모니터링할 실시간 직결 연동 로그 채널
app.get('/api/admin/match-logs', (req, res) => {
    db.all(`SELECT a.id as app_id, j.title as job_title, j.company as company_name, u.name as seeker_name, u.phone as seeker_phone, a.rank_priority FROM applications a JOIN jobs j ON a.job_id = j.id JOIN users u ON a.seeker_id = u.username ORDER BY a.id DESC`, [], (err, rows) => res.json({ success: true, logs: rows || [] }));
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
    db.run(`INSERT OR REPLACE INTO senior_qa (username, q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [username, answers[0], answers[1], answers[2], answers[3], answers[4], answers[5], answers[6], answers[7], answers[8], answers[9], answers[10], answers[11]], () => res.json({ success: true }));
});

app.post('/api/jobs/apply', (req, res) => {
    db.run(`INSERT INTO applications (job_id, seeker_id) VALUES (?, ?)`, [req.body.job_id, req.body.seeker_id], () => res.json({ success: true }));
});

app.listen(PORT, () => console.log(`SILVERWORKS 통합 코어 엔진 가동 완료 포트: ${PORT}`));
module.exports = app;
