// ==========================================================================
// SILVERWORKS (실버웍스) - 인터넷 직업정보제공사업 정식 상용화 백엔드 엔진 [1/3]
// [보안 지위] DB 영구 보존 / SHA-256 암호화 / 유해업종·최저임금 원천 차단 필터링
// ==========================================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// 토스 스타일 모바일 최적화 미들웨어 및 인터페이스 통일
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// [보안 1] 휴면 모드 대응 실물 SQLite3 파일 저장소 평생 강력 결속
const dbPath = path.join(__dirname, 'silverworks.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Database 결속 치명적 에러:", err.message);
    } else {
        console.log("실물 영구 보존 DB 파일 결속 완료:", dbPath);
    }
});

// [보안 2] 악성 스크립트 코드 주입을 차단하는 XSS 방어 샌드박스
function sanitizeInput(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

// [보안 3] 개인정보 보호법 준수 비밀번호 SHA-256 일방향 암호화
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// [보안 4] 유흥·성매매 연상 단어 자동 차단 및 형사고발 금지어 필터링 리스트
const BAN_WORDS = ['유흥', '성매매', '유사성행위', '마사지', '안마시술소', '도우미', '키스방', '조건만남', '룸살롱'];
function checkBannedWords(text) {
    if (!text) return false;
    return BAN_WORDS.some(word => text.includes(word));
}

// [정산 1] 2026년 당해 연도 고용노동부 고시 최저임금 기준 적용 (시급 하한선 필터)
const MINIMUM_WAGE = 10030; 

// 데이터베이스 마스터 테이블 연동 구조 설계 (구동 시 자동 생성)
db.serialize(() => {
    // 1. 구인자/구직자 회원 관리 테이블 (국민체력100 스펙 컬럼 확장 내장)
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

    // 2. 시니어 베테랑 전용 12가지 질문지 서식 테이블
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
// ==========================================================================
// SILVERWORKS (실버웍스) - 인터넷 직업정보제공사업 정식 상용화 백엔드 엔진 [2/3]
// [인프라] 약관 검증 / 가입 승인제 / 최저임금·금지어 실시간 차단 라우터
// ==========================================================================

// 1. 구인자/구직자 통합 보안 회원가입 API (약관 필수 동의 및 유해업종 원천 차단)
app.post('/api/auth/register', (req, res) => {
    const { username, password, name, phone, role, biz_type, terms_agree } = req.body;
    
    // 보안 필터 1: 법적 의무 사항인 이용약관 및 개인정보 처리방침 동의 여부 검증
    if (terms_agree !== true && terms_agree !== 'true') {
        return res.status(400).json({ success: false, message: "실버웍스 이용약관 및 개인정보 처리방침 동의가 필요합니다." });
    }

    // 보안 필터 2: 한국표준산업분류 기준 유해업종 회원가입 원천 차단
    if (role === 'employer' && (biz_type === '유흥주점' || biz_type === '마사지' || biz_type === '안마시술소')) {
        return res.status(400).json({ success: false, message: "표준산업분류 기준 유해 업종 코드는 가입이 원천 차단됩니다." });
    }

    // 보안 필터 3: 아이디 및 성명 내 금지어 감지 시 수사기관 즉시 고발 경고
    if (checkBannedWords(username) || checkBannedWords(name)) {
        return res.status(400).json({ success: false, message: "유흥·성매매 연상 단어 입력이 감지되어 가입이 차단되었습니다. 위반 사항은 즉시 관할 경찰서로 고발 조치됩니다." });
    }

    const cleanUsername = sanitizeInput(username);
    const cleanName = sanitizeInput(name);
    const cleanPhone = sanitizeInput(phone);
    const securedPassword = hashPassword(password);

    const query = `INSERT INTO users (username, password, name, phone, role, status) VALUES (?, ?, ?, ?, ?, 'pending')`;
    db.run(query, [cleanUsername, securedPassword, cleanName, cleanPhone, role], function(err) {
        if (err) {
            return res.status(400).json({ success: false, message: "이미 존재하는 아이디이거나 가입 정보가 유효하지 않습니다." });
        }
        res.json({ success: true, message: "회원가입이 완료되었습니다. 실버웍스 신원 검증 승인 후 서비스 이용이 가능합니다." });
    });
});

// 2. 통합 암호화 로그인 API (미승인 대기 회원 철저 통제 차단)
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const securedPassword = hashPassword(password);

    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, securedPassword], (err, user) => {
        if (err || !user) {
            return res.status(400).json({ success: false, message: "아이디 또는 비밀번호가 일치하지 않습니다." });
        }
        if (user.status === 'pending') {
            return res.status(403).json({ success: false, message: "현재 실버웍스 승인 대기 상태입니다. 신원 및 보건증 확인 완료 후 진입 권한이 부여됩니다." });
        }
        res.json({
            success: true,
            user: { username: user.username, name: user.name, role: user.role, status: user.status }
        });
    });
});

// 3. 시니어 베테랑 12가지 질문지(표준 이력서 원본) 동적 접수 및 영구 저장 API
app.post('/api/senior/qa', (req, res) => {
    const { username, answers } = req.body; // answers는 q1~q12 배열
    if (!answers || answers.length < 12) {
        return res.status(400).json({ success: false, message: "12가지 질문지 항목이 누락되었습니다." });
    }

    const query = `INSERT OR REPLACE INTO senior_qa (username, q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [username, ...answers.map(ans => sanitizeInput(ans))];

    db.run(query, params, function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: "질문지 저장 중 오류가 발생했습니다." });
        }
        res.json({ success: true, message: "실버웍스 전용 표준 이력서 데이터가 성공적으로 보존되었습니다." });
    });
});

// 4. 구인자 공고 등록 신청 API (★최저임금 하한선 및 금지어 실시간 차단 락 내장)
app.post('/api/jobs/create', (req, res) => {
    const { employer_id, title, company, work_date, work_time, wage, job_type } = req.body;
    const parsedWage = parseInt(wage);

    // 보안 필터 1: 당해 연도 고용노동부 고시 최저임금 미달 여부 원천 필터링
    if (parsedWage < MINIMUM_WAGE) {
        return res.status(400).json({ success: false, message: `고용노동부 고시 최저임금 규정 위반으로 공고 등록이 원천 거부되었습니다. (2026년 최저시급 하한선: ${MINIMUM_WAGE.toLocaleString()}원)` });
    }

    // 보안 필터 2: 공고 내용 중 유해 금지어 입력 시 실시간 차단 및 사법고발 예고
    if (checkBannedWords(title) || checkBannedWords(company)) {
        return res.status(400).json({ success: false, message: "공고 내용에 등록 불가능한 유해 단어가 포함되어 있습니다. 위반 정보는 수사기관으로 즉시 이송 고발됩니다." });
    }

    const query = `INSERT INTO jobs (employer_id, title, company, work_date, work_time, wage, job_type, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`;
    db.run(query, [employer_id, sanitizeInput(title), sanitizeInput(company), work_date, work_time, parsedWage, job_type], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: "공고 등록 신청 중 전산 오류가 발생했습니다." });
        }
        res.json({ success: true, message: "구인 공고가 정상 접수되었습니다. 실버웍스 검토 후 일자리 게시판에 최종 기재됩니다." });
    });
});
// ==========================================================================
// SILVERWORKS (실버웍스) - 인터넷 직업정보제공사업 정식 상용화 백엔드 엔진 [3/3]
// [핀테크] 1~3순위 결정사 매칭 / 3.3% 자동 원천징수 공제 / 월말 일괄 후불 청구서
// ==========================================================================

// 5. 구직자 실시간 공고 지원 API ("지원되었습니다" 완전 자동 팝업 연동)
app.post('/api/jobs/apply', (req, res) => {
    const { job_id, seeker_id } = req.body;
    
    // 이미 지원한 회원인지 사전 검증
    db.get(`SELECT id FROM applications WHERE job_id = ? AND seeker_id = ?`, [job_id, seeker_id], (err, exists) => {
        if (exists) {
            return res.status(400).json({ success: false, message: "이미 지원 완료된 공고입니다." });
        }
        const query = `INSERT INTO applications (job_id, seeker_id, status) VALUES (?, ?, 'applied')`;
        db.run(query, [job_id, seeker_id], function(err) {
            if (err) {
                return res.status(500).json({ success: false, message: "지원 전산 처리 중 에러가 발생했습니다." });
            }
            res.json({ success: true, message: "지원되었습니다." });
        });
    });
});

// 6. 구인자 전용 지원자 우선순위(1순위, 2순위, 3순위) 지정 및 결정사 매칭 확정 API
app.post('/api/jobs/set-rank', (req, res) => {
    const { job_id, rank_1, rank_2, rank_3 } = req.body;
    
    const query = `UPDATE jobs SET rank_1 = ?, rank_2 = ?, rank_3 = ?, match_status = 'matched' WHERE id = ?`;
    db.run(query, [rank_1, rank_2, rank_3, job_id], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: "우선순위 지정 중 전산 오류가 발생했습니다." });
        }
        res.json({ success: true, message: "우선순위 지정이 성공적으로 완료되었습니다. 1순위 근로자 매칭 상태로 가동됩니다." });
    });
});

// 7. 시니어 실시간 당일 근무 [퇴근하기] 인증 API
app.post('/api/work/checkout', (req, res) => {
    const { app_id } = req.body;
    
    const query = `UPDATE applications SET work_done = 'yes' WHERE id = ?`;
    db.run(query, [app_id], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: "퇴근 처리 중 전산 오류가 발생했습니다." });
        }
        res.json({ success: true, message: "오늘 자 근무 퇴근 인증이 정상 접수되었습니다. 사장님 최종 확인 후 포인트가 지급됩니다." });
    });
});

// 8. 사장님 실시간 근무 시간 검증 및 [근무 승인 + 3.3% 원천세 공제 정산] API
app.post('/api/work/approve', (req, res) => {
    const { app_id, hours, wage_per_hour, seeker_id } = req.body;
    
    db.serialize(() => {
        // 근무 승인 상태로 업데이트
        db.run(`UPDATE applications SET owner_approved = 'yes' WHERE id = ?`, [app_id]);
        
        // [핀테크 공식 산식] 3.3% 프리랜서 사업소득세 원천징수 후 순수 포인트 계산
        // 수식: 실제 근로시간 * 시급 * 0.967
        const totalPay = parseInt(hours) * parseInt(wage_per_hour);
        const netPoints = Math.floor(totalPay * 0.967);
        
        // 해당 시니어 회원 개인 자산 계정으로 즉시 포인트 누적 적립
        db.run(`UPDATE users SET points = points + ? WHERE username = ?`, [netPoints, seeker_id], function(err) {
            if (err) {
                return res.status(500).json({ success: false, message: "포인트 정산 적립 중 치명적인 내부 오류가 발생했습니다." });
            }
            res.json({ success: true, message: `근무 승인이 완수되었습니다. 3.3% 원천세가 공제된 순수 임금 ${netPoints.toLocaleString()}포인트가 근로자에게 즉시 지급되었습니다.` });
        });
    });
});

// 9. 시니어 자율 상시 [정산받기] 출금 신청 알림 API
app.post('/api/points/withdraw', (req, res) => {
    const { username, account_info } = req.body;
    
    db.serialize(() => {
        // 출금 계좌 정보 업데이트 후 출금 상태를 대기 상태로 고정 유치
        db.run(`UPDATE users SET account_info = ? WHERE username = ?`, [account_info, username]);
        
        // 최고 관리자 대시보드(admin.html) 수동 정산 알림용 인덱스 전달 데이터 반환
        res.json({ success: true, message: "정산받기 수동 계좌이체 요청이 실버웍스 관리자 패널로 실시간 인덱싱되었습니다. 사업용 계좌에서 순차 입금 처리됩니다." });
    });
});

// 10. 최고 관리자 전용 시니어 신원 검증 승인 및 [국민체력 100 오프라인 검증 스펙 제어판] API
app.post('/api/admin/update-user', (req, res) => {
    const { target_username, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio } = req.body;
    
    const query = `UPDATE users SET status = ?, fitness_grade = ?, fitness_grip = ?, fitness_flex = ?, fitness_cardio = ? WHERE username = ?`;
    db.run(query, [status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio, target_username], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: "관리자 회원 정보 수정 및 권한 부여 중 전산 오류가 발생했습니다." });
        }
        res.json({ success: true, message: "해당 회원에 대한 권한 승인 및 국민체력 100 정밀 검증 데이터 업데이트가 완료되었습니다." });
    });
});

// 11. 최고 관리자 전용 사장님 공고 최종 수동 검토 및 게시판 기재 승인 API
app.post('/api/admin/approve-job', (req, res) => {
    const { job_id, status } = req.body; // status: 'approved' 또는 'rejected'
    
    const query = `UPDATE jobs SET status = ? WHERE id = ?`;
    db.run(query, [status, job_id], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: "공고 심사 승인 전산 처리 중 오류가 발생했습니다." });
        }
        res.json({ success: true, message: "해당 구인 공고의 최종 검토 및 일자리 게시판 기재 승인이 완료되었습니다." });
    });
});

// 12. 사장님 대상 월말 일괄 후불 정산 청구서 자동 산식 명세 조회 API
app.get('/api/admin/billing-invoice', (req, res) => {
    // 한 달간 매장별 승인 완료된 총 근로 임금 합산 데이터 통계 추출
    const query = `
        SELECT j.employer_id, u.name as employer_name, u.status as membership_status, SUM(j.wage) as base_wage_total
        FROM jobs j
        JOIN users u ON j.employer_id = u.username
        WHERE j.status = 'approved' AND j.match_status = 'matched'
        GROUP BY j.employer_id
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: "월말 일괄 청구 데이터 산출 중 전산 오류가 발생했습니다." });
        }
        
        // 프리미엄 연회원 등급 구분 자동 후불 가산 산식 적용
        const invoices = rows.map(row => {
            const isPremium = row.membership_status === 'premium'; // 프리미엄 회원권(연 20,000원) 회원 상태 판별
            const rate = isPremium ? 1.05 : 1.10; // 회원: 5% 가산 / 비회원: 10% 가산 플랫폼 이용료 수취
            const totalBill = Math.floor(row.base_wage_total * rate);
            
            return {
                employer_id: row.employer_id,
                employer_name: row.employer_name,
                membership_type: isPremium ? "프리미엄 연회원 (5% 수수료 우대)" : "일반 비회원 (10% 표준 수수료)",
                base_wage: row.base_wage_total,
                total_bill: totalBill,
                payment_method: "실버웍스 법인 사업용 계좌 수동 이체 및 전자세금계산서 100% 발행"
            };
        });
        
        res.json({ success: true, data: invoices });
    });
});

// 정식 인터넷 직업정보제공사업 규격 하단 인프라 포트 구동 가동
app.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(` 실버웍스(SILVERWORKS) 상용 최적화 백엔드 제어 엔진 가동 개시`);
    console.log(` 포트번호: ${PORT} 번 채널로 인터넷 정보 매개 인프라 네트워크 가동 중`);
    console.log(`================================================================`);
});

module.exports = app;
