// ==========================================================================
// SILVERWORKS (실버웍스) - 핀테크 현금 환전 정산 및 중개 수수료 10% 관리자 관제 시스템
// [특이사항] 파일별 전/중/후반부 3단계 분할 / 시니어 환전 모달 가동 / 오피셜 DM 자동 알림
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

// [핀테크 환전 전산망 가동] 시니어 현금 인출 정산 신청 내역 보존을 위한 영구 DB 테이블 스키마 인스턴스 serialize 세단 마운트
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
    
    // [핀테크 혁신 핵심 신설] 시니어 회원의 현금 정산 신청 명세를 하드웨어 디스크에 각인할 영구 원장 테이블 생성
    db.run(`CREATE TABLE IF NOT EXISTS cash_withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT, seeker_id TEXT, bank_name TEXT, account_number TEXT, amount INTEGER, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});
// ==========================================================================
// [핀테크 기능 가동 API] 시니어 회원의 실시간 계좌 정산(환전) 신청서 접수 단
// ==========================================================================
app.post('/api/settle/withdraw-request', (req, res) => {
    const { seeker_id, bank_name, account_number, amount } = req.body;
    const reqAmount = parseInt(amount) || 0;

    if (reqAmount <= 0) return res.status(400).json({ success: false, message: "올바른 정산 금액을 입력하세요." });

    // 잔액 검증: 시니어의 보유 포인트가 정산 신청 금액보다 많은지 교차 검증
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

// ==========================================================================
// [운영자 전권 API] 1. 시니어 정산 완료 처리 (포인트 차감 및 오피셜 알림 DM 발송)
// ==========================================================================
app.post('/api/admin/settle/complete-seeker', (req, res) => {
    const { withdrawal_id } = req.body;

    db.get(`SELECT * FROM cash_withdrawals WHERE id = ?`, [withdrawal_id], (err, w) => {
        if (!w || w.status !== 'pending') return res.status(400).json({ success: false, message: "이미 처리되었거나 존재하지 않는 내역입니다." });

        // A. 시니어 포인트 영구 차감 집행
        db.run(`UPDATE users SET points = points - ? WHERE username = ? AND role = 'seeker'`, [w.amount, w.seeker_id], (err) => {
            if (err) return res.status(500).json({ success: false });

            // B. 신청서 상태 'completed'로 종결 업데이트
            db.run(`UPDATE cash_withdrawals SET status = 'completed' WHERE id = ?`, [withdrawal_id], () => {
                
                // C. 인스타 디엠 통신망에 관리자 오피셜 입금 고지 알림 자동 출격 송출
                const systemMsg = `[실버웍스 정산본부 알림] 회원님이 신청하신 ${w.bank_name} 계좌 정산금 ${w.amount.toLocaleString()}원의 실물 현금 계좌 이체가 완료되었습니다. 가상 포인트 잔액이 성공적으로 차감 연동되었습니다.`;
                db.run(`INSERT INTO sns_dms (sender, receiver, message) VALUES ('admin_system', ?, ?)`, [w.seeker_id, systemMsg], () => {
                    res.json({ success: true, message: "시니어 계좌 이체 확정 및 포인트 차감 정산이 무결하게 이행 완료되었습니다." });
                });
            });
        });
    });
});

// ==========================================================================
// [운영자 전권 API] 2. 사장님 정산 완료 처리 (수수료 10% 청구 독촉 DM 자동 발송)
// ==========================================================================
app.post('/api/admin/settle/request-employer', (req, res) => {
    const { withdrawal_id } = req.body;

    db.get(`SELECT * FROM cash_withdrawals WHERE id = ?`, [withdrawal_id], (err, w) => {
        if (!w) return res.status(404).json({ success: false });

        // 계약 관계를 추적하여 해당 시니어를 고용한 사장님(employer_id) 검출
        db.get(`SELECT employer_id, store_name FROM point_logs WHERE seeker_id = ? ORDER BY id DESC LIMIT 1`, [w.seeker_id], (err, log) => {
            const bossId = log ? log.employer_id : "employer";
            const storeName = log ? log.store_name : "소속 사업장";
            
            // 수수료 10% 계산
            const commission = Math.floor(w.amount * 0.1);
            const totalBill = w.amount + commission;

            // 사장님 계정 인스타 디엠실로 중개 수수료 10% 가산 청구 대금 독촉장 자동 송출 발송
            const billingMsg = `[실버웍스 대금 청구서] 사장님 매장(${storeName})에서 근무한 @${w.seeker_id} 시니어의 급여 정산이 본부에 의해 선지급 완료되었습니다. 이에 따라 약정된 중개 수수료 10%(${commission.toLocaleString()}원)가 가산된 총 ${totalBill.toLocaleString()}원의 정산 대금을 본부 계좌(국민은행 4345-SILVER)로 이체해 주시기 바랍니다.`;
            
            db.run(`INSERT INTO sns_dms (sender, receiver, message) VALUES ('admin_system', ?, ?)`, [bossId, billingMsg], () => {
                res.json({ success: true, message: `구인 사장님(@${bossId})에게 수수료 10%가 포함된 총액 청구서 DM 독촉 알림이 가동 발송되었습니다.` });
            });
        });
    });
});
// 최고관리자 API - [기획 대수정 반영] 환전 정산 내역 및 SNS 로그, 포인트 로그를 단일 묶음 패키지로 마스터 송출 관제
app.get('/api/admin/match-logs', (req, res) => {
    db.all(`SELECT * FROM sns_posts ORDER BY id DESC`, [], (err, postsRows) => {
        db.all(`SELECT * FROM sns_dms ORDER BY id DESC`, [], (err, dmsRows) => {
            db.all(`SELECT * FROM reputation_reviews ORDER BY id DESC`, [], (err, revRows) => {
                db.all(`SELECT * FROM point_logs ORDER BY id DESC`, [], (err, pointRows) => {
                    // 신설: 시니어 현금 정산 신청 목록을 교차 취합하여 패키지에 적재
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
