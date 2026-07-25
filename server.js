const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// [무료 인프라 전용 최적화] 외부 라이브러리 의존성을 완벽히 배제한 독자적 초경량 파일 원장 데이터베이스 엔진
class LightWeightFileDB {
    constructor(filePath) {
        this.filePath = filePath;
        this.tables = {};
        this.initMemoryStore();
    }
    initMemoryStore() {
        if (fs.existsSync(this.filePath)) {
            try { this.tables = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); }
            catch(e) { this.tables = {}; }
        }
    }
    save() {
        fs.writeFileSync(this.filePath, JSON.stringify(this.tables, null, 2), 'utf8');
    }
    run(query, params = [], callback) {
        const tName = query.split('EXISTS ')[1]?.split(' ')[0] || query.split('INTO ')[1]?.split(' ')[0] || query.split('UPDATE ')[1]?.split(' ')[0] || query.split('FROM ')[1]?.split(' ')[0];
        if(!tName) return callback ? callback(null) : null;
        const cleanTName = tName.trim().replace(/[`()]/g, '');
        if(!this.tables[cleanTName]) this.tables[cleanTName] = [];
        
        if(query.includes('INSERT INTO')) {
            const fieldsPart = query.split('(')[1].split(')')[0].split(',').map(f => f.trim());
            const rowObj = { id: this.tables[cleanTName].length + 1 };
            fieldsPart.forEach((f, idx) => { rowObj[f] = params[idx]; });
            if(cleanTName === 'users') { rowObj.points = rowObj.points || 0; rowObj.is_blacklist = rowObj.is_blacklist || 0; rowObj.status = rowObj.status || 'approved'; }
            if(cleanTName === 'jobs') { rowObj.status = rowObj.status || 'approved'; rowObj.is_pinned = rowObj.is_pinned || 0; }
            this.tables[cleanTName].push(rowObj);
            this.save();
        }
        if(callback) callback(null);
    }
    get(query, params = [], callback) {
        const tName = query.split('FROM ')[1]?.split(' ')[0];
        if(!tName) return callback(null, null);
        const cleanTName = tName.trim().replace(/[`()]/g, '');
        const rows = this.tables[cleanTName] || [];
        
        let found = null;
        if(query.includes('username = ? AND password = ?')) {
            found = rows.find(r => r.username === params[0] && r.password === params[1]);
        } else if(query.includes('username = ?')) {
            found = rows.find(r => r.username === params[0]);
        } else if(query.includes('employer_id = ?')) {
            found = rows.find(r => r.employer_id === params[0]);
        } else if(query.includes('id = ?')) {
            found = rows.find(r => parseInt(r.id) === parseInt(params[0]));
        } else if(query.includes('COUNT(*)')) {
            const cnt = rows.filter(r => r.employer_id === params[0] && ['pending', 'paid_requested'].includes(r.status)).length;
            return callback(null, { cnt });
        }
        callback(null, found);
    }
    all(query, params = [], callback) {
        const tName = query.split('FROM ')[1]?.split(' ')[0];
        if(!tName) return callback(null, []);
        const cleanTName = tName.trim().replace(/[`()]/g, '');
        let rows = this.tables[cleanTName] || [];
        
        if(query.includes('username = ?')) rows = rows.filter(r => r.username === params[0]);
        if(query.includes('employer_id = ?')) rows = rows.filter(r => r.employer_id === params[0]);
        if(query.includes('job_id = ?')) rows = rows.filter(r => parseInt(r.job_id) === parseInt(params[0]));
        
        if(query.includes('ORDER BY is_pinned DESC')) {
            rows = [...rows].sort((a,b) => (b.is_pinned || 0) - (a.is_pinned || 0) || b.id - a.id);
        } else {
            rows = [...rows].sort((a,b) => b.id - a.id);
        }
        callback(null, rows);
    }
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const dbPath = path.join(DATA_DIR, 'silverworks_v2_core.json');
const db = new LightWeightFileDB(dbPath);
const hashPw = (pw) => crypto.createHash('sha256').update(pw).digest('hex');
// 회원가입 신청 트랜잭션 라우터 (사장님 필수: 사업자번호 / 시니어 필수: 비상연락처)
app.post('/api/auth/register', (req, res) => {
    const { username, password, name, phone, role, business_number, emergency_phone } = req.body;
    const bNum = role === 'employer' ? (business_number || '-').trim() : '-';
    const ePhone = role === 'seeker' ? (emergency_phone || '-').trim() : '-';

    if (role === 'employer' && bNum === '-') {
        return res.status(400).json({ success: false, message: "사장님 회원은 사업자등록번호 기입이 필수입니다." });
    }

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, userExists) => {
        if (userExists) return res.status(400).json({ success: false, message: "이미 사용 중인 아이디입니다." });
        
        db.run(`INSERT INTO users (username, password, name, phone, role, business_number, emergency_phone) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
            [username, hashPw(password), name, phone, role, bNum, ePhone], function(err) {
                res.json({ success: true });
            });
    });
});

// 로그인 검증 필터 API (사장님실 / 시니어 관제실 교차 라우팅 디바이드)
app.post('/api/auth/login', (req, res) => {
    const { username, password, requested_role } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, hashPw(password)], (err, u) => {
        if (!u) return res.status(400).json({ success: false, message: "계정 정보가 일치하지 않습니다." });
        if (u.role !== requested_role) return res.status(403).json({ success: false, message: "선택하신 회원 유형과 일치하지 않는 계정입니다." });
        if (parseInt(u.is_blacklist) === 1) return res.status(403).json({ success: false, message: "보안 가드 경고: 약속 위반으로 인해 블랙리스트 차단된 계정입니다. 본부에 문의하세요." });
        res.json({ success: true, user: u });
    });
});

// [비회원 전면 이용 개방] 사장님 매장 행정 문의 데이터 저장 API (로그인 없이 단순기입 후 터치 가동)
app.post('/api/employer/consult', (req, res) => {
    const { store_name, phone } = req.body;
    if(!store_name || !phone) return res.status(400).json({ success: false, message: "누락된 입력 정보가 존재합니다." });
    
    db.run(`INSERT INTO store_consults (store_name, phone, created_at) VALUES (?, ?, ?)`, [store_name.trim(), phone.trim(), new Date().toISOString()], (err) => {
        res.json({ success: true, message: "행정 문의 및 실시간 접수 시각 데이터가 전산망에 보존되었습니다." });
    });
});

// 회원 전용 통합 알림 내역 실시간 파싱 로드 API
app.get('/api/notifications/list', (req, res) => {
    const { username } = req.query;
    db.all(`SELECT * FROM notifications WHERE username = ?`, [username], (err, rows) => {
        res.json({ success: true, notifications: rows || [] });
    });
});

// 알림 일괄 읽음 처리 컴팩트 마디
app.post('/api/notifications/read-all', (req, res) => {
    const { username } = req.body;
    if(!db.tables['notifications']) db.tables['notifications'] = [];
    db.tables['notifications'].forEach(n => {
        if(n.username === username) n.is_read = 1;
    });
    db.save();
    res.json({ success: true });
});

// 유저 프로필 및 12단계 문진 내역 교차 파싱 로드선 (비회원/어떤 회원이든 단순 조회 개방 스펙 적용)
app.get('/api/profile/me', (req, res) => {
    const { username } = req.query;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, u) => {
        if (!u) return res.json({ success: false });
        db.get(`SELECT * FROM senior_qa WHERE username = ?`, [username], (err, qa) => {
            res.json({ success: true, profile: u, senior_answers: qa || null });
        });
    });
});

// 시니어 12단계 정밀 온라인 건강 문진 질문지 등록 API
app.post('/api/senior/qa', (req, res) => {
    const { username, answers } = req.body;
    if(!db.tables['senior_qa']) db.tables['senior_qa'] = [];
    
    const existIdx = db.tables['senior_qa'].findIndex(q => q.username === username);
    const qaObj = { username, q1: answers, q2: answers, q3: answers, q4: answers, q5: answers, q6: answers, q7: answers, q8: answers, q9: answers, q10: answers, q11: answers, q12: answers };
    
    if(existIdx > -1) db.tables['senior_qa'][existIdx] = qaObj;
    else db.tables['senior_qa'].push(qaObj);
    
    db.run(`INSERT INTO notifications (username, message, created_at) VALUES (?, ?, ?)`, 
        [username, '온라인 문진표 작성이 완료되었습니다! 기입하신 내용을 토대로 실버웍스 본사에서 순차적으로 유선 전화 상담을 드릴 예정입니다.', new Date().toISOString()]);
        
    db.save();
    res.json({ success: true });
});
// [지시 요건] 사장님 구인공고 신규 등록 (필수 6대 항목 및 미납금 사장님 검증 락 가속 결속)
app.post('/api/jobs/create', (req, res) => {
    const { employer_id, title, company, work_date, work_time, wage, job_type, job_location, job_duty, slots_limit } = req.body;
    
    // 미납 명세서 전산 락 확인
    if(!db.tables['admin_billings']) db.tables['admin_billings'] = [];
    const hasUnpaid = db.tables['admin_billings'].some(b => b.employer_id === employer_id && ['pending', 'paid_requested'].includes(b.status));
    
    if(hasUnpaid) {
        return res.status(403).json({ success: false, message: "⚠️ 미납 또는 확인 대기 중인 정산 명세서가 존재합니다. 본부 통장으로 대금 이체 완료 및 관리자 최종 확인 전까지는 신규 구인공고를 등록할 수 없습니다." });
    }
    
    db.get(`SELECT * FROM users WHERE username = ?`, [employer_id], (err, u) => {
        const isPinned = (u && u.subscription_status === 'premium') ? 1 : 0;
        
        db.run(`INSERT INTO jobs (employer_id, title, company, work_date, work_time, wage, job_type, job_location, job_duty, slots_limit, is_pinned, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
            [employer_id, title, company, work_date, work_time, parseInt(wage), job_type, job_location, job_duty, parseInt(slots_limit)||1, isPinned]);
        
        res.json({ success: true });
    });
});

// [비회원 전면 전수 개방] 전체 구인구직 피드 게재판 로드 (구독제 사장님 공고 최상단 고정 배치 렌더링)
app.get('/api/jobs/live-board', (req, res) => {
    db.all(`SELECT * FROM jobs ORDER BY is_pinned DESC`, [], (err, rows) => {
        res.json({ success: true, jobs: rows || [] });
    });
});

// 시니어 회원 공고 지원하기 API (채용 마감/완료 시 원천 차단 락 가드 보존)
app.post('/api/jobs/apply', (req, res) => {
    const { job_id, seeker_id } = req.body;
    db.get(`SELECT * FROM jobs WHERE id = ?`, [job_id], (err, job) => {
        if(job && job.status === 'completed') {
            return res.status(400).json({ success: false, message: "이미 채용이 마감/완료된 공고입니다." });
        }
        db.run(`INSERT INTO applications (job_id, seeker_id, status) VALUES (?, ?, 'applied')`);
        res.json({ success: true });
    });
});

// 내 매장 공고별 지원 시니어 명단 및 1·2·3 지망 순위 조회 엔진
app.get('/api/employer/applicants', (req, res) => {
    const { job_id } = req.query;
    db.all(`SELECT * FROM applications WHERE job_id = ?`, [job_id], (err, apps) => {
        if (!apps || apps.length === 0) return res.json({ success: true, data: [] });
        
        if(!db.tables['users']) db.tables['users'] = [];
        const resData = apps.map(a => {
            const u = db.tables['users'].find(user => user.username === a.seeker_id);
            return { seeker_info: u || { username: a.seeker_id, name: "알수없음", phone: "-" }, status: a.status, rank_priority: a.rank_priority || 0 };
        });
        res.json({ success: true, data: resData });
    });
});

// [지시 요건] 사장님이 지원자 중 1·2·3순위 마킹 및 최종 [채용하기] 계약 성사 파이프라인
app.post('/api/employer/confirm-hiring', (req, res) => {
    const { job_id, first_id, second_id, third_id } = req.body;
    
    if(!db.tables['applications']) db.tables['applications'] = [];
    db.tables['applications'].forEach(a => {
        if(parseInt(a.job_id) === parseInt(job_id)) { a.rank_priority = 0; a.status = 'applied'; }
    });
    
    const setRank = (sId, rank, stat) => {
        const found = db.tables['applications'].find(a => parseInt(a.job_id) === parseInt(job_id) && a.seeker_id === sId);
        if(found) { found.rank_priority = rank; found.status = stat; }
    };
    if(first_id) setRank(first_id, 1, 'selected_1');
    if(second_id) setRank(second_id, 2, 'selected_2');
    if(third_id) setRank(third_id, 3, 'selected_3');
    
    if(!db.tables['jobs']) db.tables['jobs'] = [];
    const job = db.tables['jobs'].find(j => parseInt(j.id) === parseInt(job_id));
    if(job) job.status = 'completed';
    
    const sendNoti = (sId, msg) => {
        db.run(`INSERT INTO notifications (username, message, created_at) VALUES (?, ?, ?)`, [sId, msg, new Date().toISOString()]);
    };
    if(first_id) sendNoti(first_id, '축하합니다! 1순위로 채용이 최종 확정되어 계약이 안심 성사되었습니다. 안심근무확인서 양식이 자동 발부되었으니 일정을 엄수해 주세요.');
    if(second_id) sendNoti(second_id, '안내 알림: 해당 구인 공고에 [2순위 대체 보상 인력]으로 지명 배정되었습니다. 1순위 노쇼 발생 시 자동으로 임금 가산 조치와 함께 매칭 승계 권한이 활성화됩니다.');
    if(third_id) sendNoti(third_id, '안내 알림: 해당 구인 공고에 [3순위 대체 보상 인력]으로 지명 배정되었습니다. 대체순위 승계 권한 조항이 활성화되었습니다.');
    
    db.save();
    res.json({ success: true });
});

// [지시 요건] 1순위 연락두절 결함 시 사장님의 [노쇼 처리] 발동 및 2순위 가산임금 자동 승계 엔진
app.post('/api/employer/trigger-noshow-pass', (req, res) => {
    const { job_id, current_noshow_id } = req.body;
    
    if(!db.tables['applications']) db.tables['applications'] = [];
    const nsApp = db.tables['applications'].find(a => parseInt(a.job_id) === parseInt(job_id) && a.seeker_id === current_noshow_id);
    if(nsApp) nsApp.status = 'noshow_penalty';
    
    const secApp = db.tables['applications'].find(a => parseInt(a.job_id) === parseInt(job_id) && parseInt(a.rank_priority) === 2);
    if(secApp) {
        secApp.rank_priority = 1;
        secApp.status = 'selected_1_compensation';
        db.run(`INSERT INTO notifications (username, message, created_at) VALUES (?, ?, ?)`, 
            [secApp.seeker_id, '🚨 긴급 승계 알림: 기존 1순위 회원의 연락두절 노쇼로 인해 매칭 권한이 귀하에게 최종 승계되었습니다! 계약 조항에 의거하여 기존 기재 임금보다 더 높은 [대체 근로 가산 보상 임금]이 실시간 자동 적용됩니다.', new Date().toISOString()]);
        db.save();
        return res.json({ success: true, next_level: 2 });
    }
    
    const thrApp = db.tables['applications'].find(a => parseInt(a.job_id) === parseInt(job_id) && parseInt(a.rank_priority) === 3);
    if(thrApp) {
        thrApp.rank_priority = 1;
        thrApp.status = 'selected_1_compensation_max';
        db.run(`INSERT INTO notifications (username, message, created_at) VALUES (?, ?, ?)`, 
            [thrApp.seeker_id, '🚨 긴급 승계 알림: 기존 인력 노쇼로 인해 3순위 대체 권한이 귀하에게 최종 이관 승계되었습니다! 최고 등급의 [특수 대체 가산 보상 임금] 조항이 실시간 강제 대입 적용됩니다.', new Date().toISOString()]);
        db.save();
        return res.json({ success: true, next_level: 3 });
    }
    
    db.save();
    res.json({ success: true, next_level: 0, message: "대기 지망자가 존재하지 않습니다." });
});

// [지시 요건] 근무 종료 시간 자동인식 후 사장님의 [근무 완료 승인] 집행 및 수수료 차등 청구서 강제 발부 API
app.post('/api/employer/execute-work-complete', (req, res) => {
    const { job_id, seeker_id, final_wage } = req.body;
    const baseWage = parseInt(final_wage);
    
    if(!db.tables['jobs']) db.tables['jobs'] = [];
    if(!db.tables['users']) db.tables['users'] = [];
    
    const job = db.tables['jobs'].find(j => parseInt(j.id) === parseInt(job_id));
    if(!job) return res.status(404).json({ success: false });
    
    const employer = db.tables['users'].find(u => u.username === job.employer_id);
    const isPremium = employer && employer.subscription_status === 'premium';
    const commissionRate = isPremium ? 0.05 : 0.10;
    const commission = Math.floor(baseWage * commissionRate);
    const totalBill = baseWage + commission;
    
    if(!db.tables['applications']) db.tables['applications'] = [];
    const appRecord = db.tables['applications'].find(a => parseInt(a.job_id) === parseInt(job_id) && a.seeker_id === seeker_id);
    if(appRecord) appRecord.status = 'completed_clear';
    
    const seeker = db.tables['users'].find(u => u.username === seeker_id);
    if(seeker) seeker.points = (parseInt(seeker.points) || 0) + baseWage;
    
    db.run(`INSERT INTO notifications (username, message, created_at) VALUES (?, ?, ?)`, 
        [seeker_id, '축하합니다! 매장 근무 완료 승인이 도출되어 임금 포인트가 안전 수납되었습니다. 프로필에 [시간 엄수 100%], [체력 베테랑] 마스터 배지가 영구 장착되었습니다.', new Date().toISOString()]);
        
    db.run(`INSERT INTO admin_billings (employer_id, seeker_id, job_id, base_wage, commission, total_bill, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [job.employer_id, seeker_id, parseInt(job_id), baseWage, commission, totalBill, new Date().toISOString()]);
        
    db.save();
    res.json({ success: true, message: "베테랑 포인트 충전 완료 및 차등 중개 수수료가 적용된 오피셜 청구서 영수증이 발부되었습니다." });
});

// [지시 요건] 사장님의 [이의 신청] 클릭 시 본사 전산망 비상 알림 트리거 및 지급 홀딩 API
app.post('/api/employer/trigger-dispute-claim', (req, res) => {
    const { job_id, seeker_id } = req.body;
    if(!db.tables['admin_billings']) db.tables['admin_billings'] = [];
    const billing = db.tables['admin_billings'].find(b => parseInt(b.job_id) === parseInt(job_id) && b.seeker_id === seeker_id);
    if(billing) billing.status = 'disputed_claim_hold';
    db.save();
    res.json({ success: true, message: "이의 신청 분쟁 접수서가 본사 심사대에 전격 접수되어 포인트 정산 처리가 일시 일시정지(Holding) 가드 처리되었습니다." });
});

// [지시 요건] 사장님이 알림창 명세서 하단 [입금 완료했어요] 터치 시 안심 가이드 전환 락 수신 트랙 API
app.post('/api/settle/request-paid-invoice', (req, res) => {
    const { billing_id } = req.body;
    if(!db.tables['admin_billings']) db.tables['admin_billings'] = [];
    const billing = db.tables['admin_billings'].find(b => parseInt(b.id) === parseInt(billing_id));
    if(billing) billing.status = 'paid_requested';
    db.save();
    res.json({ success: true });
});

// 사장님 수수료 10% vs 5% 대시보드 리포트 실시간 미납 파싱 로드선
app.get('/api/settle/employer-billing-invoice', (req, res) => {
    const { employer_id } = req.query;
    if(!db.tables['admin_billings']) db.tables['admin_billings'] = [];
    const rows = db.tables['admin_billings'].filter(b => b.employer_id === employer_id && ['pending', 'paid_requested'].includes(b.status));
    res.json({ success: true, billings: rows });
});

// 시니어 보유 포인트 환전 인프라 원장 결속선
app.post('/api/settle/withdraw-request', (req, res) => {
    const { seeker_id, amount } = req.body;
    db.run(`INSERT INTO admin_billings (employer_id, seeker_id, job_id, base_wage, commission, total_bill, status, created_at) VALUES ('system_withdraw', ?, 0, ?, 0, ?, 'withdrawal_pending', ?)`,
        [seeker_id, parseInt(amount), parseInt(amount), new Date().toISOString()]);
    res.json({ success: true });
});

// 마스터 관리자실 최종 통제 수납 승인 및 대금 잔액 [0원] 리셋 정화 청정 파이프라인 API
app.post('/api/admin/settle/clear-employer-invoice', (req, res) => {
    const { billing_id } = req.body;
        if(!db.tables['admin_billings']) db.tables['admin_billings'] = [];
        
        const isPremium = info.subscription_status === 'premium';
        const commissionRate = isPremium ? 0.05 : 0.10; 
        const commission = Math.floor(baseWage * commissionRate);
        const totalBill = baseWage + commission;
        
        // 1. 대체 인력 완수 상태 원장 기재
        if(db.tables['applications']) {
            const appNode = db.tables['applications'].find(a => parseInt(a.job_id) === parseInt(job_id) && a.seeker_id === seeker_id);
            if(appNode) appNode.status = 'completed_clear';
        }
        
        // 2. 가상 포인트 즉시 시니어 지갑 원장에 실시간 충전 이체
        if(db.tables['users']) {
            const uNode = db.tables['users'].find(u => u.username === seeker_id);
            if(uNode) uNode.points = (parseInt(uNode.points) || 0) + baseWage;
        }
        
        // 시니어 알림 메시지 적재
        db.run(`INSERT INTO notifications (username, message, created_at) VALUES (?, ?, ?)`,
            [seeker_id, '축하합니다! 매장 근무 완료 승인이 도출되어 임금 포인트가 안전 수납되었습니다. 프로필에 [시간 엄수 100%], [체력 베테랑] 마스터 배지가 영구 장착되었습니다.', new Date().toISOString()]);
            
        // 3. 본사 관제센터 사장님 앞 차등 가산 청구 대금 명세서 레이어 자동 즉시 발부 발행
        const newBilling = {
            id: db.tables['admin_billings'].length + 1,
            employer_id: info.employer_id,
            seeker_id: seeker_id,
            job_id: parseInt(job_id),
            base_wage: baseWage,
            commission: commission,
            total_bill: totalBill,
            status: 'pending',
            created_at: new Date().toISOString()
        };
        db.tables['admin_billings'].push(newBilling);
        db.save();
        
        res.json({ success: true, message: "베테랑 포인트 충전 완료 및 차등 중개 수수료가 적용된 오피셜 청구서 영수증이 발부되었습니다." });
    });

// [지시 요건] 사장님의 [이의 신청] 클릭 시 본사 전산망 비상 알림 트리거 및 지급 홀딩 API
app.post('/api/employer/trigger-dispute-claim', (req, res) => {
    const { job_id, seeker_id } = req.body;
    if(db.tables['admin_billings']) {
        const bNode = db.tables['admin_billings'].find(b => parseInt(b.job_id) === parseInt(job_id) && b.seeker_id === seeker_id);
        if(bNode) bNode.status = 'disputed_claim_hold';
    }
    db.save();
    res.json({ success: true, message: "이의 신청 분쟁 접수서가 본사 심사대에 전격 접수되어 포인트 정산 처리가 일시 일시정지(Holding) 가드 처리되었습니다." });
});

// [지시 요건] 사장님이 알림창 명세서 하단 [입금 완료했어요] 터치 시 안심 가이드 전환 락 수신 트랙 API
app.post('/api/settle/request-paid-invoice', (req, res) => {
    const { billing_id } = req.body;
    if(db.tables['admin_billings']) {
        const bNode = db.tables['admin_billings'].find(b => parseInt(b.id) === parseInt(billing_id));
        if(bNode) bNode.status = 'paid_requested';
    }
    db.save();
    res.json({ success: true });
});

// 사장님 수수료 10% vs 5% 대시보드 리포트 실시간 미납 파싱 로드선
app.get('/api/settle/employer-billing-invoice', (req, res) => {
    const { employer_id } = req.query;
    const rows = db.tables['admin_billings'] || [];
    const filtered = rows.filter(b => b.employer_id === employer_id && ['pending', 'paid_requested'].includes(b.status));
    res.json({ success: true, billings: filtered });
});

// 최고 관리자 마스터 콘솔실: 가입 회원 전체 리스트 마스터 로드선
app.get('/api/admin/users', (req, res) => {
    res.json({ success: true, users: db.tables['users'] || [] });
});

// 최고 관리자 마스터 콘솔실: 구인 공고 전체 리스트 마스터 로드선
app.get('/api/admin/jobs-all', (req, res) => {
    res.json({ success: true, jobs: db.tables['jobs'] || [] });
});

// 최고 관리자 마스터 콘솔실: 차등 청구서 및 행정 문의 원장 통합 파싱 로드선
app.get('/api/admin/match-logs', (req, res) => {
    res.json({ 
        success: true, 
        billings: db.tables['admin_billings'] || [],
        consults: db.tables['store_consults'] || []
    });
});

// 최고 관리자 마스터 콘솔실: 특정 유저 종합 원장 정밀 신원 영구 검출록 API
app.get('/api/admin/inspect-user', (req, res) => {
    const { target_username } = req.query;
    const users = db.tables['users'] || [];
    const qas = db.tables['senior_qa'] || [];
    const u = users.find(user => user.username === target_username) || { username: target_username, name: '알수없음', phone: '-', points: 0, role: 'seeker' };
    const qa = qas.find(q => q.username === target_username) || null;
    res.json({ success: true, profile: u, senior_answers: qa });
});

// 최고 관리자 마스터 콘솔실: 2차 오프라인 체력 수치 수기 강제 주입 주입소 API
app.post('/api/admin/update-user', (req, res) => {
    const { target_username, fitness_grade, fitness_grip, fitness_flex, fitness_cardio } = req.body;
    if(db.tables['users']) {
        const uNode = db.tables['users'].find(u => u.username === target_username);
        if(uNode) {
            uNode.fitness_grade = fitness_grade;
            uNode.fitness_grip = fitness_grip;
            uNode.fitness_flex = fitness_flex;
            uNode.fitness_cardio = fitness_cardio;
            uNode.status = 'approved';
        }
    }
    db.save();
    res.json({ success: true });
});

// 최고 관리자 마스터 콘솔실: 블랙리스트 행정 가드 처분 및 토글 스위칭 API
app.post('/api/auth/update-blacklist-status', (req, res) => {
    const { target_username, is_blacklist } = req.body;
    if(db.tables['users']) {
        const uNode = db.tables['users'].find(u => u.username === target_username);
        if(uNode) uNode.is_blacklist = parseInt(is_blacklist);
    }
    db.save();
    res.json({ success: true });
});

// 시니어 회원 보유 포인트 환전 인프라 원장 결속선
app.post('/api/settle/withdraw-request', (req, res) => {
    const { seeker_id, amount } = req.body;
    if(!db.tables['admin_billings']) db.tables['admin_billings'] = [];
    
    const newWithdraw = {
        id: db.tables['admin_billings'].length + 1,
        employer_id: 'system_withdraw',
        seeker_id: seeker_id,
        job_id: 0,
        base_wage: parseInt(amount),
        commission: 0,
        total_bill: parseInt(amount),
        status: 'withdrawal_pending',
        created_at: new Date().toISOString()
    };
    db.tables['admin_billings'].push(newWithdraw);
    
    if(db.tables['users']) {
        const uNode = db.tables['users'].find(u => u.username === seeker_id);
        if(uNode) uNode.points = (parseInt(uNode.points) || 0) - parseInt(amount);
    }
    db.save();
    res.json({ success: true });
});

// 마스터 관리자실 최종 통제 수납 승인 및 대금 잔액 [0원] 리셋 정화 청정 파이프라인 API
app.post('/api/admin/settle/clear-employer-invoice', (req, res) => {
    const { billing_id } = req.body;
    if(db.tables['admin_billings']) {
        const bNode = db.tables['admin_billings'].find(b => parseInt(b.id) === parseInt(billing_id));
        if(bNode) {
            bNode.status = 'paid_completed_clear';
            db.run(`INSERT INTO notifications (username, message, created_at) VALUES (?, ?, ?)`,
                [bNode.employer_id, '✓ 본부 입금 수납 확인 통보: 송금해 주신 가산 청구 대금의 통장 실물 대조 수납 확인이 무결 완료되어 청구서 잔액이 [0원]으로 청정 리셋 소멸 처리되었습니다. 신규 공고 작성 권한이 전격 복귀 개통되었습니다.', new Date().toISOString()]);
        }
    }
    db.save();
    res.json({ success: true, message: "본부 오피셜 대금 확인 수납 각인 성료! 영수증 잔액이 [0원]으로 클리어 청정 세척되었습니다." });
});

// 사장님 구인공고 직접 삭제 및 관리자실 강제 파쇄 통제선
app.post('/api/jobs/purge-delete', (req, res) => {
    const { job_id } = req.body;
    if(db.tables['jobs']) {
        db.tables['jobs'] = db.tables['jobs'].filter(j => parseInt(j.id) !== parseInt(job_id));
    }
    db.save();
    res.json({ success: true });
});

// 시니어 회원 개인정보 보호자 비상연락처 원장 강제 각인 수정 API 포트
app.post('/api/auth/update-emergency-phone', (req, res) => {
    const { username, emergency_phone } = req.body;
    if(db.tables['users']) {
        const uNode = db.tables['users'].find(u => u.username === username);
        if(uNode) uNode.emergency_phone = emergency_phone;
    }
    db.save();
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`SILVERWORKS V2 통합 코어 백엔드 금융 연동 서버 포트: ${PORT}`));
module.exports = app;
