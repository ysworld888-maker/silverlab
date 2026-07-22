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

// 가입 트랜잭션 실패 오류를 차단하기 위한 하드디스크 스키마 테이블 안전 마운트 프로토콜
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
    db.run(`CREATE TABLE IF NOT EXISTS sns_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, title TEXT, content TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS sns_dms (
        id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, receiver TEXT, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS reputation_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT, target_id TEXT, author_id TEXT, review_text TEXT, score INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS cash_withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT, seeker_id TEXT, bank_name TEXT, account_number TEXT, amount INTEGER, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // [트랜잭션 락 완벽 파쇄] 기존 구버전 구동 환경에서 sns_posts 테이블에 title 컬럼 누락 시 자동 강제 추가 가드 처리
    db.run(`ALTER TABLE sns_posts ADD COLUMN title TEXT`, (err) => {
        // 이미 컬럼이 존재할 경우 에러는 자동 패스 처리되어 안전하게 트랜잭션을 보존합니다.
    });
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

// SNS 소통실 트위터(X) 모달형 제목/내용 파싱 및 등록 API
app.get('/api/sns/posts', (req, res) => {
    db.all(`SELECT * FROM sns_posts ORDER BY id DESC`, [], (err, rows) => res.json({ success: true, posts: rows || [] }));
});

app.post('/api/sns/posts/create', (req, res) => {
    const { username, title, content } = req.body;
    if(!content || content.trim() === "") return res.status(400).json({ success: false });
    const finalTitle = title && title.trim() !== "" ? title.trim() : "새로운 피드 소식";
    db.run(`INSERT INTO sns_posts (username, title, content) VALUES (?, ?, ?)`, [username, finalTitle, content.trim()], () => res.json({ success: true }));
});

// SNS 소통실 인스타그램 DM 규격 1대1 다이렉트 메시지 통신 API
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

// 100점 만점 절대 평판 리뷰 등록 및 산출 파싱 API
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
    const finalScore = Math.max(1, Math.min(100, parseInt(score) || 100)); 
    db.run(`INSERT INTO reputation_reviews (target_id, author_id, review_text, score) VALUES (?, ?, ?, ?)`,
        [target_id, author_id, review_text.trim(), finalScore], () => res.json({ success: true }));
});

// 최고 관리자실 게시글/디엠/평판 리뷰 영구 파쇄 소멸 API
app.post('/api/admin/purge/post', (req, res) => {
    db.run(`DELETE FROM sns_posts WHERE id = ?`, [req.body.id], () => res.json({ success: true }));
});

app.post('/api/admin/purge/dm', (req, res) => {
    db.run(`DELETE FROM sns_dms WHERE id = ?`, [req.body.id], () => res.json({ success: true }));
});

app.post('/api/admin/purge/review', (req, res) => {
    db.run(`DELETE FROM reputation_reviews WHERE id = ?`, [req.body.id], () => res.json({ success: true }));
});
// 시니어 회원의 실시간 계좌 정산(환전) 신청서 접수 단
app.post('/api/settle/withdraw-request', (req, res) => {
    const { seeker_id, bank_name, account_number, amount } = req.body;
    const reqAmount = parseInt(amount) || 0;

    if (reqAmount <= 0) return res.status(400).json({ success: false, message: "올바른 정산 금액을 입력하세요." });

    db.get(`SELECT points FROM users WHERE username = ? AND role = 'seeker'`, [seeker_id], (err, u) => {
        if (!u || u.points < reqAmount) {
            return res.status(400).json({ success: false, message: "보유하신 포인트 잔액이 부족하여 정산 신청이 거부되었습니다." });
        }
        
        db.run(`INSERT INTO cash_withdrawals (seeker_id, bank_name, account_number, amount, status) VALUES (?, ?, ?, ?, 'pending')`,
            [seeker_id, bank_name, account_number, reqAmount], (err) => {
                if (err) return res.status(500).json({ success: false });
                res.json({ success: true, message: "정산 신청서가 최고 관리자실로 안전하게 접수되었습니다." });
            });
    });
});

// 운영자 전권 API - 1. 시니어 정산 완료 처리 (포인트 차감 및 오피셜 알림 DM 발송)
app.post('/api/admin/settle/complete-seeker', (req, res) => {
    const { withdrawal_id } = req.body;

    db.get(`SELECT * FROM cash_withdrawals WHERE id = ?`, [withdrawal_id], (err, w) => {
        if (!w || w.status !== 'pending') return res.status(400).json({ success: false, message: "이미 처리되었거나 존재하지 않는 내역입니다." });

        db.run(`UPDATE users SET points = points - ? WHERE username = ? AND role = 'seeker'`, [w.amount, w.seeker_id], (err) => {
            if (err) return res.status(500).json({ success: false });

            db.run(`UPDATE cash_withdrawals SET status = 'completed' WHERE id = ?`, [withdrawal_id], () => {
                const systemMsg = `[실버웍스 정산본부 알림] 회원님이 신청하신 ${w.bank_name} 계좌 정산금 ${w.amount.toLocaleString()}원의 실물 현금 계좌 이체가 완료되었습니다. 가상 포인트 잔액이 성공적으로 차감 연동되었습니다.`;
                db.run(`INSERT INTO sns_dms (sender, receiver, message) VALUES ('admin_system', ?, ?)`, [w.seeker_id, systemMsg], () => {
                    res.json({ success: true, message: "시니어 계좌 이체 확정 및 포인트 차감 정산이 무결하게 이행 완료되었습니다." });
                });
            });
        });
    });
});

// 운영자 전권 API - 2. 사장님 정산 완료 처리 (수수료 10% 청구 독촉 DM 자동 발송)
app.post('/api/admin/settle/request-employer', (req, res) => {
    const { withdrawal_id } = req.body;

    db.get(`SELECT * FROM cash_withdrawals WHERE id = ?`, [withdrawal_id], (err, w) => {
        if (!w) return res.status(404).json({ success: false });

        db.get(`SELECT employer_id, store_name FROM point_logs WHERE seeker_id = ? ORDER BY id DESC LIMIT 1`, [w.seeker_id], (err, log) => {
            const bossId = log ? log.employer_id : "employer";
            const storeName = log ? log.store_name : "소속 사업장";
            
            const commission = Math.floor(w.amount * 0.1);
            const totalBill = w.amount + commission;

            const billingMsg = `[실버웍스 대금 청구서] 사장님 매장(${storeName})에서 근무한 @${w.seeker_id} 시니어의 급여 정산이 본부에 의해 선지급 완료되었습니다. 이에 따라 약정된 중개 수수료 10%(${commission.toLocaleString()}원)가 가산된 총 ${totalBill.toLocaleString()}원의 정산 대금을 본부 계좌로 이체해 주시기 바랍니다.`;
            
            db.run(`INSERT INTO sns_dms (sender, receiver, message) VALUES ('admin_system', ?, ?)`, [bossId, billingMsg], () => {
                res.json({ success: true, message: `구인 사장님(@${bossId})에게 수수료 10%가 포함된 총액 청구서 DM 독촉 알림이 가동 발송되었습니다.` });
            });
        });
    });
});

// 최고관리자 API - 환전 정산 내역 및 소셜 패키지 취합 송출 관제
app.get('/api/admin/match-logs', (req, res) => {
    db.all(`SELECT * FROM sns_posts ORDER BY id DESC`, [], (err, postsRows) => {
        db.all(`SELECT * FROM sns_dms ORDER BY id DESC`, [], (err, dmsRows) => {
            db.all(`SELECT * FROM reputation_reviews ORDER BY id DESC`, [], (err, revRows) => {
                db.all(`SELECT * FROM point_logs ORDER BY id DESC`, [], (err, pointRows) => {
                    db.all(`SELECT * FROM cash_withdrawals ORDER BY id DESC`, [], (err, withdrawRows) => {
                        res.json({ 
                            success: true, 
                            posts: postsRows || [], 
                            dms: dmsRows || [], 
                            reviews: revRows || [], 
                            points: pointRows || [],
                            withdrawals: withdrawRows || []
                        });
                    });
                });
            });
        });
    });
});

app.get('/api/admin/users', (req, res) => {
    db.all(`SELECT * FROM users ORDER BY id DESC`, [], (err, rows) => res.json({ success: true, users: rows || [] }));
});

app.post('/api/admin/update-user', (req, res) => {
    const { target_username, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio } = req.body;
    db.run(`UPDATE users SET status = ?, fitness_grade = ?, fitness_grip = ?, fitness_flex = ?, fitness_cardio = ? WHERE username = ?`,
        [status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio, target_username], () => res.json({ success: true }));
});

app.post('/api/jobs/create', (req, res) => {
    const { employer_id, title, company, work_date, work_time, wage, job_type } = req.body;
    db.run(`INSERT INTO jobs (employer_id, title, company, work_date, work_time, wage, job_type, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [employer_id, title, company, work_date, work_time, parseInt(wage), job_type], () => res.json({ success: true }));
});

app.post('/api/employer/update-rank', (req, res) => {
    const { job_id, seeker_id, rank_priority } = req.body;
    db.run(`UPDATE applications SET rank_priority = ? WHERE job_id = ? AND seeker_id = ?`,
        [parseInt(rank_priority), job_id, seeker_id], () => res.json({ success: true }));
});

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

app.get('/api/jobs/live-board', (req, res) => {
    db.all(`SELECT * FROM jobs WHERE status = 'approved' ORDER BY id DESC`, [], (err, rows) => res.json({ success: true, jobs: rows || [] }));
});

app.get('/api/admin/jobs-all', (req, res) => {
    db.all(`SELECT * FROM jobs ORDER BY id DESC`, [], (err, rows) => res.json({ success: true, jobs: rows || [] }));
});

app.post('/api/admin/approve-job', (req, res) => {
    db.run(`UPDATE jobs SET status = ? WHERE id = ?`, [req.body.action_status, req.body.job_id], () => res.json({ success: true }));
});

app.get('/api/attendance/status', (req, res) => {
    const { job_id, seeker_id } = req.query;
    db.get(`SELECT * FROM attendance WHERE job_id = ? AND seeker_id = ?`, [job_id, seeker_id], (err, row) => {
        res.json({ success: true, attendance: row || null });
    });
});

app.get('/api/admin/inspect-user', (req, res) => {
    const { target_username } = req.query;
    db.get(`SELECT username, name, phone, role, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio, points FROM users WHERE username = ?`, [target_username], (err, u) => {
        if (!u) return res.status(404).json({ success: false, message: "존재하지 않는 회원 계정" });
        db.get(`SELECT * FROM senior_qa WHERE username = ?`, [target_username], (err, qa) => {
            res.json({ success: true, profile: u, senior_answers: qa || null });
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

app.listen(PORT, () => console.log(`SILVERWORKS 핀테크 수수료 인프라 엔진 포트: ${PORT}`));
module.exports = app;
