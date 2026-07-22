// ==========================================================================
// SILVERWORKS (실버웍스) - 트위터(X) 미학 소셜룸 및 관리자 계정 열람 통제 시스템
// [특이사항] 파일별 전/중/후반부 3단계 분할 / 모달 팝업창 공식 주입 / 이모티콘 전량 박멸
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

// [X 소셜 생태계 마운트] 100점 평판 기준선 및 트위터(X)형 모달 타이틀/콘텐츠 저장을 위한 스키마 테이블 초기화
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
    db.run(`CREATE TABLE IF NOT EXISTS point_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, employer_id TEXT, seeker_id TEXT, store_name TEXT, amount INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, seeker_id TEXT, employer_id TEXT, check_in DATETIME, check_out DATETIME, status TEXT DEFAULT 'none'
    )`);
    
    // 신설 보완: 트위터(X) 및 스레드 미학의 제목(title)과 본문을 개별 수집 보존할 소셜 테이블 업그레이드
    db.run(`CREATE TABLE IF NOT EXISTS sns_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, title TEXT, content TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS sns_dms (
        id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, receiver TEXT, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS reputation_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT, target_id TEXT, author_id TEXT, review_text TEXT, score INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});
// 회원가입 신청 트랜잭션 라우터
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

// ==========================================================================
// [보완 이식] 2-1. SNS 소통실 트위터(X) 모달형 제목/내용 파싱 및 등록 API
// ==========================================================================
app.get('/api/sns/posts', (req, res) => {
    db.all(`SELECT * FROM sns_posts ORDER BY id DESC`, [], (err, rows) => res.json({ success: true, posts: rows || [] }));
});

app.post('/api/sns/posts/create', (req, res) => {
    const { username, title, content } = req.body;
    if(!content || content.trim() === "") return res.status(400).json({ success: false });
    const finalTitle = title && title.trim() !== "" ? title.trim() : "새로운 피드 소식";
    db.run(`INSERT INTO sns_posts (username, title, content) VALUES (?, ?, ?)`, [username, finalTitle, content.trim()], () => res.json({ success: true }));
});

// ==========================================================================
// 2-2. SNS 소통실 인스타그램 DM 규격 1대1 다이렉트 메시지 통신 API
// ==========================================================================
app.get('/api/sns/dms', (req, res) => {
    const { sender, receiver } = req.query;
    db.all(`SELECT * FROM sns_dms WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) ORDER BY id ASC`,
        [sender, receiver, receiver, sender], (err, rows) => res.json({ success: true, dms: rows || [] }));
});

app.post('/api/sns/dms/send', (req, res) => {
    const { sender, receiver, message } = req.body;
    if(!receiver || !message || message.trim() === "") return res.status(400).json({ success: false });
    db.run(`INSERT INTO sns_dms (sender, receiver, message) VALUES (?, ?, ?)`, [sender, receiver, message.trim()], () => res.json({ success: true }));
});

// ==========================================================================
// [대대적 전산 개조] 2-3. 100점 만점 기준 절대 평판 리뷰 등록 및 산출 파싱 API
// ==========================================================================
app.get('/api/sns/reputation', (req, res) => {
    const { target_id } = req.query;
    db.all(`SELECT * FROM reputation_reviews WHERE target_id = ? ORDER BY id DESC`, [target_id], (err, rows) => {
        if(!rows || rows.length === 0) return res.json({ success: true, reviews: [], avg: 100 });
        let sum = 0; rows.forEach(r => sum += r.score);
        res.json({ success: true, reviews: rows, avg: Math.floor(sum / rows.length) });
    });
});

app.post('/api/sns/reputation/create', (req, res) => {
    const { target_id, author_id, review_text, score } = req.body;
    const finalScore = Math.max(1, Math.min(100, parseInt(score) || 100)); // 100점 가드락 바인딩
    db.run(`INSERT INTO reputation_reviews (target_id, author_id, review_text, score) VALUES (?, ?, ?, ?)`,
        [target_id, author_id, review_text.trim(), finalScore], () => res.json({ success: true }));
});

// ==========================================================================
// [운영자 특권 통제] 2-4. 최고 관리자실 게시글/디엠/평판 리뷰 영구 파쇄 소멸 API
// ==========================================================================
app.post('/api/admin/purge/post', (req, res) => {
    db.run(`DELETE FROM sns_posts WHERE id = ?`, [req.body.id], () => res.json({ success: true }));
});

app.post('/api/admin/purge/dm', (req, res) => {
    db.run(`DELETE FROM sns_dms WHERE id = ?`, [req.body.id], () => res.json({ success: true }));
});

app.post('/api/admin/purge/review', (req, res) => {
    db.run(`DELETE FROM reputation_reviews WHERE id = ?`, [req.body.id], () => res.json({ success: true }));
});
// ==========================================================================
// [신설] 2-5. [사장님 오더 완벽 이식] 최고 관리자 계정 임의 강제 실시간 열람 API
// ==========================================================================
app.get('/api/admin/inspect-user', (req, res) => {
    const { target_username } = req.query;
    db.get(`SELECT username, name, phone, role, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio, points FROM users WHERE username = ?`, [target_username], (err, u) => {
        if (!u) return res.status(404).json({ success: false, message: "존재하지 않는 회원 계정" });
        db.get(`SELECT * FROM senior_qa WHERE username = ?`, [target_username], (err, qa) => {
            res.json({ success: true, profile: u, senior_answers: qa || null });
        });
    });
});

// [핀테크 기능 가동 API] 사장님이 시니어를 선택해 고용 '확정하기'를 단행하는 채널
app.post('/api/employer/confirm-seeker', (req, res) => {
    const { job_id, seeker_id } = req.body;
    db.get(`SELECT employer_id FROM jobs WHERE id = ?`, [job_id], (err, job) => {
        if (!job) return res.status(404).json({ success: false });
        db.run(`UPDATE applications SET status = 'confirmed' WHERE job_id = ? AND seeker_id = ?`, [job_id, seeker_id], () => {
            db.run(`INSERT OR IGNORE INTO attendance (job_id, seeker_id, employer_id, status) VALUES (?, ?, ?, 'none')`, [job_id, seeker_id, job.employer_id], () => {
                res.json({ success: true });
            });
        });
    });
});

// 출근하기 및 퇴근하기 타임스탬프 각인 기록 처리 통로
app.post('/api/attendance/action', (req, res) => {
    const { job_id, seeker_id, action_type } = req.body;
    const nowStr = new Date().toISOString();
    if (action_type === 'check_in') {
        db.run(`UPDATE attendance SET check_in = ?, status = 'working' WHERE job_id = ? AND seeker_id = ?`, [nowStr, job_id, seeker_id], () => res.json({ success: true }));
    } else {
        db.run(`UPDATE attendance SET check_out = ?, status = 'completed' WHERE job_id = ? AND seeker_id = ?`, [nowStr, job_id, seeker_id], () => res.json({ success: true }));
    }
});

// 사장님 일급 포인트 실시간 정산 지급 통로
app.post('/api/employer/settle-points', (req, res) => {
    const { employer_id, seeker_id, amount, store_name } = req.body;
    const pointsAmount = parseInt(amount) || 0;
    if (pointsAmount <= 0) return res.status(400).json({ success: false, message: "올바른 정산 금액을 기입하세요." });

    db.run(`UPDATE users SET points = points + ? WHERE username = ? AND role = 'seeker'`, [pointsAmount, seeker_id], (err) => {
        if (err) return res.status(500).json({ success: false });
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

// 내 공고 지원 베테랑 명단 독점 파싱 및 매칭 상태 분기 추적 호출
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

// 매칭 게시판 API - 관리자 승인이 완료된 라이브 공고 피드 반환
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

// 내 매장 공고와 확정 결속을 마친 출퇴근 현황판 호출 라인
app.get('/api/attendance/status', (req, res) => {
    const { job_id, seeker_id } = req.query;
    db.get(`SELECT * FROM attendance WHERE job_id = ? AND seeker_id = ?`, [job_id, seeker_id], (err, row) => {
        res.json({ success: true, attendance: row || null });
    });
});

// 최고관리자 API - 포인트 로그와 더불어 SNS 모든 원천 데이터 묶음을 단일 패키지로 마스터 송출 관제
app.get('/api/admin/match-logs', (req, res) => {
    db.all(`SELECT * FROM sns_posts ORDER BY id DESC`, [], (err, postsRows) => {
        db.all(`SELECT * FROM sns_dms ORDER BY id DESC`, [], (err, dmsRows) => {
            db.all(`SELECT * FROM reputation_reviews ORDER BY id DESC`, [], (err, revRows) => {
                db.all(`SELECT * FROM point_logs ORDER BY id DESC`, [], (err, pointRows) => {
                    res.json({ 
                        success: true, 
                        posts: postsRows || [], 
                        dms: dmsRows || [], 
                        reviews: revRows || [], 
                        points: pointRows || [] 
                    });
                });
            });
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

app.listen(PORT, () => console.log(`SILVERWORKS 소셜-핀테크 마스터 제어 엔진 기동 포트: ${PORT}`));
module.exports = app;
