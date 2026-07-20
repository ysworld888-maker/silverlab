// ==========================================================================
// SILVERWORKS (실버웍스) - 포인트 정산 및 출퇴근 상용 인프라 코어 시스템
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

const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const dbPath = path.join(DATA_DIR, 'silverworks_final_system.db');
const db = new sqlite3.Database(dbPath);

const hashPw = (pw) => crypto.createHash('sha256').update(pw).digest('hex');

// [핀테크 인프라 가동] 시니어 포인트 컬럼(points) 및 출퇴근 매칭 락 상태 테이블 신설 serialize 마운트
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, name TEXT, phone TEXT, role TEXT, status TEXT,
        fitness_grade TEXT DEFAULT '미인증', fitness_grip TEXT DEFAULT '-', fitness_flex TEXT DEFAULT '-', fitness_cardio TEXT DEFAULT '-',
        points INTEGER DEFAULT 0
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
    // 신설: 출근하기, 퇴근하기, 사장님 정산하기 상호작용 내역을 보존 기록하는 상용 트랜잭션 DB 테이블 생성
    db.run(`CREATE TABLE IF NOT EXISTS point_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, employer_id TEXT, seeker_id TEXT, store_name TEXT, amount INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, seeker_id TEXT, employer_id TEXT, check_in DATETIME, check_out DATETIME, status TEXT DEFAULT 'none'
    )`);
});
// 회원가입 및 권한 고정 가동 API
app.post('/api/auth/register', (req, res) => {
    const { username, password, name, phone, role } = req.body;
    db.run(`INSERT INTO users (username, password, name, phone, role, status) VALUES (?, ?, ?, ?, ?, 'pending')`, 
        [username, hashPw(password), name, phone, role], function(err) {
            if (err) return res.status(400).json({ success: false, message: "이미 사용 중인 아이디" });
            res.json({ success: true });
        });
});

// 로그인 검증 필터 API
app.post('/api/auth/login', (req, res) => {
    const { username, password, requested_role } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, hashPw(password)], (err, u) => {
        if (!u) return res.status(400).json({ success: false, message: "계정 정보 불일치" });
        if (u.role !== requested_role) return res.status(403).json({ success: false, message: "진입 권한 채널 불일치" });
        if (u.status === 'pending') return res.status(403).json({ success: false, message: "현재 신원 승인 대기 상태" });
        res.json({ success: true, user: u });
    });
});

// [핀테크 기능 가동 API] 사장님이 시니어를 선택해 고용 '확정하기'를 단행하는 채널
app.post('/api/employer/confirm-seeker', (req, res) => {
    const { job_id, seeker_id } = req.body;
    db.get(`SELECT employer_id FROM jobs WHERE id = ?`, [job_id], (err, job) => {
        if (!job) return res.status(404).json({ success: false });
        db.run(`UPDATE applications SET status = 'confirmed' WHERE job_id = ? AND seeker_id = ?`, [job_id, seeker_id], () => {
            // 확정 즉시 출퇴근 및 정산 정보가 동적으로 연동될 상호작용 테이블을 개통 초기화 생성합니다.
            db.run(`INSERT OR IGNORE INTO attendance (job_id, seeker_id, employer_id, status) VALUES (?, ?, ?, 'none')`, [job_id, seeker_id, job.employer_id], () => {
                res.json({ success: true });
            });
        });
    });
});

// [핀테크 기능 가동 API] 출근하기 및 퇴근하기 타임스탬프 각인 기록 처리 통로
app.post('/api/attendance/action', (req, res) => {
    const { job_id, seeker_id, action_type } = req.body;
    const nowStr = new Date().toISOString();
    if (action_type === 'check_in') {
        db.run(`UPDATE attendance SET check_in = ?, status = 'working' WHERE job_id = ? AND seeker_id = ?`, [nowStr, job_id, seeker_id], () => res.json({ success: true }));
    } else {
        db.run(`UPDATE attendance SET check_out = ?, status = 'completed' WHERE job_id = ? AND seeker_id = ?`, [nowStr, job_id, seeker_id], () => res.json({ success: true }));
    }
});
// [핀테크 기능 가동 API] 사장님이 시니어 정보 확인 및 최종 체크 동의 후 일급 포인트를 실시간 정산 지급하는 통로
app.post('/api/employer/settle-points', (req, res) => {
    const { employer_id, seeker_id, amount, store_name } = req.body;
    const pointsAmount = parseInt(amount) || 0;

    if (pointsAmount <= 0) return res.status(400).json({ success: false, message: "올바른 정산 금액을 기입하세요." });

    // 1. 구직 시니어 회원 자산 단에 일급 포인트를 실시간 누적 충전 반영
    db.run(`UPDATE users SET points = points + ? WHERE username = ? AND role = 'seeker'`, [pointsAmount, seeker_id], (err) => {
        if (err) return res.status(500).json({ success: false });
        
        // 2. 관리자실 관제 모니터링 장치로 송출할 실시간 핀테크 영구 로그 피드 봉인 적재
        db.run(`INSERT INTO point_logs (employer_id, seeker_id, store_name, amount) VALUES (?, ?, ?, ?)`, 
            [employer_id, seeker_id, store_name, pointsAmount], () => {
                res.json({ success: true, message: "일급 포인트 정산 지급 완료" });
            });
    });
});

// 최고관리자 API - 가입 회원 실시간 파싱 및 갱신된 포인트 잔액 바인딩 호출
app.get('/api/admin/users', (req, res) => {
    db.all(`SELECT * FROM users ORDER BY id DESC`, [], (err, rows) => res.json({ success: true, users: rows || [] }));
});

// 최고관리자 API - 4대 체력 스펙 제어 패널 업데이트
app.post('/api/admin/update-user', (req, res) => {
    const { target_username, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio } = req.body;
    db.run(`UPDATE users SET status = ?, fitness_grade = ?, fitness_grip = ?, fitness_flex = ?, fitness_cardio = ? WHERE username = ?`,
        [status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio, target_username], () => res.json({ success: true }));
});

// 구인 공고 직접 생성 등록 API
app.post('/api/jobs/create', (req, res) => {
    const { employer_id, title, company, work_date, work_time, wage, job_type } = req.body;
    db.run(`INSERT INTO jobs (employer_id, title, company, work_date, work_time, wage, job_type, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [employer_id, title, company, work_date, work_time, parseInt(wage), job_type], () => res.json({ success: true }));
});

// 사장님 API - 우선순위 지망 배정 제어 단추
app.post('/api/employer/update-rank', (req, res) => {
    const { job_id, seeker_id, rank_priority } = req.body;
    db.run(`UPDATE applications SET rank_priority = ? WHERE job_id = ? AND seeker_id = ?`,
        [parseInt(rank_priority), job_id, seeker_id], () => res.json({ success: true }));
});

// 보안 격리 API - 내 공고 지원 베테랑 명단 독점 파싱 및 매칭 상태 분기 추적 호출
app.get('/api/employer/applicants', (req, res) => {
    const { employer_id, job_id } = req.query;
    db.get(`SELECT employer_id FROM jobs WHERE id = ?`, [job_id], (err, job) => {
        if (!job || job.employer_id !== employer_id) return res.status(403).json({ success: false });
        db.all(`SELECT seeker_id, status, rank_priority FROM applications WHERE job_id = ? ORDER BY CASE WHEN rank_priority = 0 THEN 999 ELSE rank_priority END ASC, id ASC`, [job_id], (err, apps) => {
            if (!apps || apps.length === 0) return res.json({ success: true, data: [] });
            const sIds = apps.map(a => `'${a.seeker_id}'`).join(',');
            db.all(`SELECT username, name, phone, fitness_grade, fitness_grip, fitness_flex, fitness_cardio FROM users WHERE username IN (${sIds})`, [], (err, users) => {
                db.all(`SELECT * FROM senior_qa WHERE username IN (${sIds})`, [], (err, qas) => {
                    const resData = apps.map(a => {
                        const u = users.find(user => user.username === a.seeker_id);
                        return {
                            seeker_info: u || { username: a.seeker_id, name: "알수없음", phone: "-" },
                            status: a.status,
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

// 매칭 게시판 API - 관리자 승인이 완료된 청정 라이브 공고 피드 반환
app.get('/api/jobs/live-board', (req, res) => {
    db.all(`SELECT * FROM jobs WHERE status = 'approved' ORDER BY id DESC`, [], (err, rows) => res.json({ success: true, jobs: rows || [] }));
});

// 최고관리자 API - 사장님 등록 공고 전체 심사 제어판 호출
app.get('/api/admin/jobs-all', (req, res) => {
    db.all(`SELECT * FROM jobs ORDER BY id DESC`, [], (err, rows) => res.json({ success: true, jobs: rows || [] }));
});

app.post('/api/admin/approve-job', (req, res) => {
    db.run(`UPDATE jobs SET status = ? WHERE id = ?`, [req.body.action_status, req.body.job_id], () => res.json({ success: true }));
});

// [핀테크 기능 가동 API] 내 매장 공고와 확정(confirmed) 결속을 마친 출퇴근 현황판 호출 라인
app.get('/api/attendance/status', (req, res) => {
    const { job_id, seeker_id } = req.query;
    db.get(`SELECT * FROM attendance WHERE job_id = ? AND seeker_id = ?`, [job_id, seeker_id], (err, row) => {
        res.json({ success: true, attendance: row || null });
    });
});

// 최고관리자 API - [기획 오더 이행] 사장님이 동의 정산한 실시간 포인트 정산 히스토리 통계 파싱 로그 피드 채널 추가
app.get('/api/admin/match-logs', (req, res) => {
    db.all(`SELECT a.id as app_id, j.title as job_title, j.company as company_name, u.name as seeker_name, u.phone as seeker_phone, a.rank_priority, a.status as app_status FROM applications a JOIN jobs j ON a.job_id = j.id JOIN users u ON a.seeker_id = u.username ORDER BY a.id DESC`, [], (err, appsRows) => {
        db.all(`SELECT * FROM point_logs ORDER BY id DESC`, [], (err, pointRows) => {
            res.json({ success: true, logs: appsRows || [], points: pointRows || [] });
        });
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
    db.run(`INSERT OR REPLACE INTO senior_qa (username, q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [username, answers, answers, answers, answers, answers, answers, answers, answers, answers, answers, answers, answers], () => res.json({ success: true }));
});

app.post('/api/jobs/apply', (req, res) => {
    db.run(`INSERT INTO applications (job_id, seeker_id) VALUES (?, ?)`, [req.body.job_id, req.body.seeker_id], () => res.json({ success: true }));
});

app.listen(PORT, () => console.log(`SILVERWORKS 핀테크 코어 시스템 결속 포트: ${PORT}`));
module.exports = app;
