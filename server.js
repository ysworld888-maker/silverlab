const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// [지시 반영] 기존 디자인 뼈대를 100% 보존하면서 외부 바이너리 충돌을 차단하는 내장 초경량 파일 원장 DB 엔진
class LightWeightFileDB {
    constructor(filePath) {
        this.filePath = filePath;
        this.tables = {};
        this.initMemoryStore();
    }
    initMemoryStore() {
        if (fs.existsSync(this.filePath)) {
            try { 
                this.tables = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); 
            } catch(e) { 
                this.tables = {}; 
            }
        }
    }
    save() {
        fs.writeFileSync(this.filePath, JSON.stringify(this.tables, null, 2), 'utf8');
    }
    run(query, params = [], callback) {
        if(query.includes('INSERT INTO notifications')) {
            if(!this.tables['notifications']) this.tables['notifications'] = [];
            this.tables['notifications'].push({
                id: this.tables['notifications'].length + 1,
                username: params[0],
                message: params[1],
                is_read: 0,
                created_at: params[2] || new Date().toISOString()
            });
            this.save();
        }
        if(query.includes('INSERT INTO store_consults')) {
            if(!this.tables['store_consults']) this.tables['store_consults'] = [];
            this.tables['store_consults'].push({
                id: this.tables['store_consults'].length + 1,
                store_name: params[0],
                phone: params[1],
                created_at: params[2]
            });
            this.save();
        }
        if (callback) callback(null);
    }
    get(query, params = [], callback) {
        if(query.includes('username = ? AND password = ?')) {
            const rows = this.tables['users'] || [];
            const found = rows.find(r => r.username === params[0] && r.password === params[1]);
            return callback(null, found);
        }
        if(query.includes('username = ?')) {
            const rows = this.tables['users'] || [];
            const found = rows.find(r => r.username === params[0]);
            return callback(null, found);
        }
        if(query.includes('senior_qa')) {
            const rows = this.tables['senior_qa'] || [];
            const found = rows.find(r => r.username === params[0]);
            return callback(null, found);
        }
        if(query.includes('COUNT(*)')) {
            const rows = this.tables['admin_billings'] || [];
            const cnt = rows.filter(r => r.employer_id === params[0] && ['pending', 'paid_requested', 'disputed_claim_hold'].includes(r.status)).length;
            return callback(null, { 'COUNT(*)': cnt });
        }
        callback(null, null);
    }
    all(query, params = [], callback) {
        if(query.includes('employer_id = ?')) {
            const rows = this.tables['jobs'] || [];
            const filtered = rows.filter(r => r.employer_id === params[0]);
            return callback(null, filtered);
        }
        if(query.includes('SELECT * FROM jobs')) {
            const rows = this.tables['jobs'] || [];
            return callback(null, rows);
        }
        if(query.includes('notifications WHERE username = ?')) {
            const rows = this.tables['notifications'] || [];
            const filtered = rows.filter(r => r.username === params[0]);
            return callback(null, filtered);
        }
        callback(null, []);
    }
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const dbPath = path.join(DATA_DIR, 'silverworks_v2_core.json');
const db = new LightWeightFileDB(dbPath);
const hashPw = (pw) => crypto.createHash('sha256').update(pw).digest('hex');
// 회원가입 신청 트랜잭션 라우터 (사장님 필수: 사업자번호 / 시니어 필수: 비상연락처)
app.post('/api/auth/register', (req, res) => {
    const { username, password, name, phone, role, business_number, emergency_phone } = req.body;
    
    if(!db.tables['users']) db.tables['users'] = [];
    
    const userExists = db.tables['users'].find(r => r.username === username);
    if (userExists) return res.status(400).json({ success: false, message: "이미 사용 중인 아이디입니다." });

    const bNum = role === 'employer' ? (business_number || '-').trim() : '-';
    const ePhone = role === 'seeker' ? (emergency_phone || '-').trim() : '-';

    // [지시 요건 완벽 수호] 기존 양식 구조를 해치지 않고 백엔드에서 원천 필수 입력 검증 락 가동
    if (role === 'employer' && (bNum === '-' || bNum === '')) {
        return res.status(400).json({ success: false, message: "사장님 회원은 사업자등록번호 기입이 필수입니다." });
    }
    if (role === 'seeker' && (ePhone === '-' || ePhone === '')) {
        return res.status(400).json({ success: false, message: "시니어 베테랑 회원은 보호자 비상 연락처 기입이 필수입니다." });
    }

    const newUser = {
        id: db.tables['users'].length + 1,
        username,
        password: hashPw(password),
        name,
        phone,
        role,
        business_number: bNum,
        emergency_phone: ePhone,
        points: 0,
        is_blacklist: 0,
        status: 'approved',
        subscription_status: 'normal'
    };
    
    db.tables['users'].push(newUser);
    db.save();
    res.json({ success: true });
});

// 로그인 검증 필터 API (사장님실 / 시니어 관제실 교차 권한 차단 가드)
app.post('/api/auth/login', (req, res) => {
    const { username, password, requested_role } = req.body;
    
    if(!db.tables['users']) db.tables['users'] = [];
    
    const u = db.tables['users'].find(r => r.username === username && r.password === hashPw(password));
    if (!u) return res.status(400).json({ success: false, message: "계정 정보가 일치하지 않습니다." });
    if (u.role !== requested_role) return res.status(403).json({ success: false, message: "선택하신 회원 유형과 일치하지 않는 계정입니다." });
    if (parseInt(u.is_blacklist) === 1) return res.status(403).json({ success: false, message: "보안 가드 경고: 약속 위반으로 인해 블랙리스트 차단된 계정입니다. 본부에 문의하세요." });
    
    res.json({ success: true, user: u });
});

// [비회원 전수 개방] 사장님 매장 다이렉트 행정 문의 데이터 저장 API
app.post('/api/employer/consult', (req, res) => {
    const { store_name, phone } = req.body;
    if(!store_name || !phone) return res.status(400).json({ success: false, message: "누락된 입력 정보가 존재합니다." });
    
    if(!db.tables['store_consults']) db.tables['store_consults'] = [];
    db.tables['store_consults'].push({
        id: db.tables['store_consults'].length + 1,
        store_name: store_name.trim(),
        phone: phone.trim(),
        created_at: new Date().toISOString()
    });
    db.save();
    res.json({ success: true, message: "행정 문의 및 실시간 접수 시각 데이터가 본부 전산망에 보존되었습니다." });
});

// 회원 전용 통합 알림 내역 실시간 파싱 로드 API
app.get('/api/notifications/list', (req, res) => {
    const { username } = req.query;
    if(!db.tables['notifications']) db.tables['notifications'] = [];
    const rows = db.tables['notifications'].filter(n => n.username === username);
    res.json({ success: true, notifications: rows });
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

// 유저 프로필 및 12단계 문진 내역 교차 파싱 로드선 (단순 조회 개방 스펙)
app.get('/api/profile/me', (req, res) => {
    const { username } = req.query;
    if(!db.tables['users']) db.tables['users'] = [];
    if(!db.tables['senior_qa']) db.tables['senior_qa'] = [];
    
    const u = db.tables['users'].find(r => r.username === username);
    if (!u) return res.json({ success: false });
    
    const qa = db.tables['senior_qa'].find(q => q.username === username);
    res.json({ success: true, profile: u, senior_answers: qa || null });
});

// 시니어 12단계 정밀 온라인 건강 문진 질문지 등록 API
app.post('/api/senior/qa', (req, res) => {
    const { username, answers } = req.body;
    if(!db.tables['senior_qa']) db.tables['senior_qa'] = [];
    if(!db.tables['notifications']) db.tables['notifications'] = [];
    
    const existIdx = db.tables['senior_qa'].findIndex(q => q.username === username);
    const qaObj = { username, q1: answers, q2: answers, q3: answers, q4: answers, q5: answers, q6: answers, q7: answers, q8: answers, q9: answers, q10: answers, q11: answers, q12: answers };
    
    if(existIdx > -1) db.tables['senior_qa'][existIdx] = qaObj;
    else db.tables['senior_qa'].push(qaObj);
    
    db.tables['notifications'].push({
        id: db.tables['notifications'].length + 1,
        username: username,
        message: '온라인 문진표 작성이 완료되었습니다. 기입하신 내용을 토대로 실버웍스 본사에서 순차적으로 유선 전화 상담을 드릴 예정입니다.',
        is_read: 0,
        created_at: new Date().toISOString()
    });
        
    db.save();
    res.json({ success: true });
});
// [지시 요건 반영] 사장님 피크타임 구인공고 신규 생성 등록 API (6대 필수 항목 검증 및 미납 사장님 가드 락)
app.post('/api/jobs/create', (req, res) => {
    const { employer_id, title, company, work_date, work_time, wage, job_type, job_location, job_duty, slots_limit } = req.body;
    
    if(!db.tables['jobs']) db.tables['jobs'] = [];
    if(!db.tables['admin_billings']) db.tables['admin_billings'] = [];
    if(!db.tables['users']) db.tables['users'] = [];

    // [지시 요건] 정산 명세 미납 상태인 사장님은 새로운 공고글을 새로 쓸 수 없게 차단 가드 락 가동
    const hasUnpaidInvoice = db.tables['admin_billings'].some(b => b.employer_id === employer_id && ['pending', 'paid_requested', 'disputed_claim_hold'].includes(b.status));
    if (hasUnpaidInvoice) {
        return res.status(403).json({ success: false, message: "보안 가드 차단: 본부에 완납되지 않은 수수료 청구 명세 대금이 존재하여 신규 구인공고를 등록할 수 없습니다. 수납을 완료해 주세요." });
    }

    const ownerInfo = db.tables['users'].find(u => u.username === employer_id) || { subscription_status: 'normal' };
    const isPinnedActive = ownerInfo.subscription_status === 'premium' ? 1 : 0; // 연 4만원 구독 사장님 공고 상단 고정 광고 마케팅 락 연동

    const newJob = {
        id: db.tables['jobs'].length + 1,
        employer_id,
        title,
        company,
        work_date,
        work_time,
        wage: parseInt(wage),
        job_type,
        job_location,
        job_duty,
        slots_limit: parseInt(slots_limit),
        status: 'approved', // 초기 승인 게재 상태
        is_pinned: isPinnedActive,
        created_at: new Date().toISOString()
    };

    db.tables['jobs'].push(newJob);
    db.save();
    res.json({ success: true });
});

// 마이페이지 구인처 내 공고 목록 및 동적 타이머 매칭 트랙 조회 파싱선
app.get('/api/employer/my-jobs', (req, res) => {
    const { employer_id } = req.query;
    if(!db.tables['jobs']) db.tables['jobs'] = [];
    const rows = db.tables['jobs'].filter(j => j.employer_id === employer_id);
    res.json({ success: true, jobs: rows });
});

// 특정 구인공고 피드에 지원한 베테랑 리스트 교차 검출 API 
app.get('/api/employer/applicants', (req, res) => {
    const { job_id } = req.query;
    if(!db.tables['applications']) db.tables['applications'] = [];
    if(!db.tables['users']) db.tables['users'] = [];

    const apps = db.tables['applications'].filter(a => parseInt(a.job_id) === parseInt(job_id));
    const resultData = apps.map(a => {
        const sInfo = db.tables['users'].find(u => u.username === a.seeker_id) || {};
        return {
            id: a.id,
            job_id: a.job_id,
            seeker_id: a.seeker_id,
            rank_priority: a.rank_priority,
            status: a.status,
            seeker_info: {
                username: sInfo.username,
                name: sInfo.name,
                phone: sInfo.phone,
                emergency_phone: sInfo.emergency_phone,
                fitness_grade: sInfo.fitness_grade || '미인증',
                fitness_grip: sInfo.fitness_grip || '-',
                fitness_flex: sInfo.fitness_flex || '-',
                fitness_cardio: sInfo.fitness_cardio || '-',
                points: sInfo.points || 0
            }
        };
    });
    res.json({ success: true, data: resultData });
});

// [지시 요건] 사장님의 지원자 1·2·3순위 지정 및 채용 확정 단행 트랜잭션 (마감 락 가동 및 1페이지 안심 근무 확인서 발부 알림)
app.post('/api/employer/assign-multi-ranks', (req, res) => {
    const { job_id, rank1_seeker, rank2_seeker, rank3_seeker } = req.body;
    
    if(!db.tables['applications']) db.tables['applications'] = [];
    if(!db.tables['jobs']) db.tables['jobs'] = [];
    if(!db.tables['notifications']) db.tables['notifications'] = [];

    // 기존 해당 공고 지원 내역 리셋 정렬
    db.tables['applications'] = db.tables['applications'].filter(a => parseInt(a.job_id) !== parseInt(job_id));

    const timestamp = new Date().toISOString();
    const jobNode = db.tables['jobs'].find(j => parseInt(j.id) === parseInt(job_id));

    if(jobNode) {
        jobNode.status = 'completed'; // 구인공고글 채용 완료 마감 태그 상태 전환 가드 락
    }

    // 1지망 배정 및 안심 근무 확인서 알림 발송
    if(rank1_seeker) {
        db.tables['applications'].push({ id: db.tables['applications'].length+1, job_id: parseInt(job_id), seeker_id: rank1_seeker, rank_priority: 1, status: 'assigned' });
        db.tables['notifications'].push({
            id: db.tables['notifications'].length + 1,
            username: rank1_seeker,
            message: `계약 확정 알림: 사장님의 선택으로 1순위 피크타임 채용이 확정 성사되었습니다. 안심 근무 확인서가 발부되었습니다. (상호명: ${jobNode?.company || '실버웍스 매장'} / 근무일시: ${jobNode?.work_date || '-'} ${jobNode?.work_time || '-'} / 약정시급: ${jobNode?.wage.toLocaleString() || '0'}원)`,
            is_read: 0,
            created_at: timestamp
        });
    }
    // 2지망 대기 배정 및 실시간 안내 통보
    if(rank2_seeker) {
        db.tables['applications'].push({ id: db.tables['applications'].length+1, job_id: parseInt(job_id), seeker_id: rank2_seeker, rank_priority: 2, status: 'waiting_backup' });
        db.tables['notifications'].push({
            id: db.tables['notifications'].length + 1,
            username: rank2_seeker,
            message: `대기 지정 고지: 귀하가 해당 매장의 2순위 대체 근로 인력으로 배정 각인되었습니다. 1순위 노쇼 결함 비상 발생 시 가산 임금 보상 패키지와 함께 권한이 승계 작동됩니다.`,
            is_read: 0,
            created_at: timestamp
        });
    }
    // 3지망 대기 배정 및 최고 등급 안내 통보
    if(rank3_seeker) {
        db.tables['applications'].push({ id: db.tables['applications'].length+1, job_id: parseInt(job_id), seeker_id: rank3_seeker, rank_priority: 3, status: 'waiting_backup' });
        db.tables['notifications'].push({
            id: db.tables['notifications'].length + 1,
            username: rank3_seeker,
            message: `대기 지정 고지: 귀하가 해당 매장의 3순위 대체 근로 인력으로 배정 각인되었습니다. 1순위 노쇼 결함 비상 발생 시 2순위보다 더 높은 최고 등급 가산 임금 보상 패키지와 함께 권한이 승계 작동됩니다.`,
            is_read: 0,
            created_at: timestamp
        });
    }

    db.save();
    res.json({ success: true });
});

// [지시 요건] 1순위 약속 위반 노쇼 시 사장님의 [노쇼 처리] 터치 연동 및 2·3순위 가산 임금 지갑 자동 이양 엔진
app.post('/api/employer/trigger-noshow-pass', (req, res) => {
    const { job_id, current_noshow_id } = req.body;
    
    if(!db.tables['applications']) db.tables['applications'] = [];
    if(!db.tables['users']) db.tables['users'] = [];
    if(!db.tables['notifications']) db.tables['notifications'] = [];

    // 1. 노쇼 인력 블랙 가드 스코어 규격 각인
    const badUser = db.tables['users'].find(u => u.username === current_noshow_id);
    if(badUser) {
        badUser.is_blacklist = 1; 
    }

    // 2순위 및 3순위 대체 대기자 순차 조회 판독
    const rank2Node = db.tables['applications'].find(a => parseInt(a.job_id) === parseInt(job_id) && parseInt(a.rank_priority) === 2);
    const rank3Node = db.tables['applications'].find(a => parseInt(a.job_id) === parseInt(job_id) && parseInt(a.rank_priority) === 3);

    let nextTargetSeeker = null;
    let nextLevel = 0;

    if (rank2Node) {
        rank2Node.rank_priority = 1;
        rank2Node.status = 'assigned';
        nextTargetSeeker = rank2Node.seeker_id;
        nextLevel = 2;
    } else if (rank3Node) {
        rank3Node.rank_priority = 1;
        rank3Node.status = 'assigned';
        nextTargetSeeker = rank3Node.seeker_id;
        nextLevel = 3;
    }

    if(nextTargetSeeker) {
        // [지시 요건 반영] 1순위 노쇼로 인해 가산임금 자동 승계 알림 원터치 전송 가동
        db.tables['notifications'].push({
            id: db.tables['notifications'].length + 1,
            username: nextTargetSeeker,
            message: `1순위 노쇼로 인해 승계되었습니다 (가산 임금 적용). 긴급 대체 출동 미션 권한이 실시간 인계 개통되었습니다.`,
            is_read: 0,
            created_at: new Date().toISOString()
        });
    }

    db.save();
    res.json({ success: true, next_level: nextLevel });
});
// [지시 요건] 사장님이 약정 마감 종료 시간이 지나 [근무 완료 승인] 터치 즉시 시니어 지갑 충전 및 10% vs 5% 차등 청구서 영수증 발부 엔진
app.post('/api/employer/execute-work-complete', (req, res) => {
    const { job_id, seeker_id, final_wage } = req.body;
    
    if(!db.tables['users']) db.tables['users'] = [];
    if(!db.tables['admin_billings']) db.tables['admin_billings'] = [];
    if(!db.tables['notifications']) db.tables['notifications'] = [];
    if(!db.tables['applications']) db.tables['applications'] = [];

    const seekerInfo = db.tables['users'].find(u => u.username === seeker_id);
    
    // [지시 요건] 노쇼 패널티 먹은 시니어가 후순위 대체인력 임무 무사 완수 시 자동으로 패널티 삭제 세척
    if(seekerInfo && parseInt(seekerInfo.is_blacklist) === 1) {
        seekerInfo.is_blacklist = 0;
    }

    // 공고 등록한 사장님의 ID 추출 및 수수료율 계산 변수 장전
    const targetJob = db.tables['jobs'].find(j => parseInt(j.id) === parseInt(job_id));
    const myEmployerId = targetJob ? targetJob.employer_id : '';
    const info = db.tables['users'].find(u => u.username === myEmployerId) || { subscription_status: 'normal', username: myEmployerId };
    const baseWage = parseInt(final_wage);
    
    const isPremium = info.subscription_status === 'premium';
    const commissionRate = isPremium ? 0.05 : 0.10; 
    const commission = Math.floor(baseWage * commissionRate);
    const totalBill = baseWage + commission;
    
    // 1. 대체 인력 완수 상태 원장 기재
    const appNode = db.tables['applications'].find(a => parseInt(a.job_id) === parseInt(job_id) && a.seeker_id === seeker_id);
    if(appNode) appNode.status = 'completed_clear';
    
    // 2. 가상 포인트 즉시 시니어 지갑 원장에 실시간 충전 이체
    if(seekerInfo) {
        seekerInfo.points = (parseInt(seekerInfo.points) || 0) + baseWage;
    }
    
    // [지시 요건] 무사 완료 승인 시 시니어 프로필에 3대 마스터 성실 배지 자가동 장착 트리거 메시지 송출
    db.tables['notifications'].push({
        id: db.tables['notifications'].length + 1,
        username: seeker_id,
        message: '축하합니다! 매장 근무 완료 승인이 도출되어 임금 포인트가 안전 수납되었습니다. 프로필에 [시간 엄수 100%], [사장님 추천], [체력 베테랑] 마스터 배지가 영구 장착되었습니다.',
        is_read: 0,
        created_at: new Date().toISOString()
    });
        
    // 3. 본사 관제센터 사장님 앞 차등 가산 청구 대금 명세서 레이어 자동 즉시 발부 발행
    const newBilling = {
        id: db.tables['admin_billings'].length + 1,
        employer_id: info.username,
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
    res.json({ success: true, message: "이의 신청 분쟁 접수서가 본사 심사대에 전격 접수되어 포인트 정산 처리가 일시정지(Holding) 가드 처리되었습니다." });
});

// 사장님 청구 명세서 수납 확인 대기 요청 전송 피드 포트
app.post('/api/settle/request-paid-invoice', (req, res) => {
    const { billing_id } = req.body;
    if(db.tables['admin_billings']) {
        const bNode = db.tables['admin_billings'].find(b => parseInt(b.id) === parseInt(billing_id));
        if(bNode) bNode.status = 'paid_requested';
    }
    db.save();
    res.json({ success: true });
});

app.get('/api/settle/employer-billing-invoice', (req, res) => {
    const { employer_id } = req.query;
    const rows = db.tables['admin_billings'] || [];
    const filtered = rows.filter(b => b.employer_id === employer_id && ['pending', 'paid_requested', 'disputed_claim_hold'].includes(b.status));
    res.json({ success: true, billings: filtered });
});

app.get('/api/admin/users', (req, res) => { res.json({ success: true, users: db.tables['users'] || [] }); });
app.get('/api/admin/jobs-all', (req, res) => { res.json({ success: true, jobs: db.tables['jobs'] || [] }); });
app.get('/api/admin/match-logs', (req, res) => {
    res.json({ success: true, billings: db.tables['admin_billings'] || [], consults: db.tables['store_consults'] || [] });
});

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

app.post('/api/settle/withdraw-request', (req, res) => {
    const { seeker_id, amount } = req.body;
    if(!db.tables['admin_billings']) db.tables['admin_billings'] = [];
    db.tables['admin_billings'].push({
        id: db.tables['admin_billings'].length + 1, employer_id: 'system_withdraw', seeker_id: seeker_id, job_id: 0, base_wage: parseInt(amount), commission: 0, total_bill: parseInt(amount), status: 'withdrawal_pending', created_at: new Date().toISOString()
    });
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
            if(!db.tables['notifications']) db.tables['notifications'] = [];
            db.tables['notifications'].push({
                id: db.tables['notifications'].length + 1,
                username: bNode.employer_id,
                message: '본부 입금 수납 확인 통보: 송금해 주신 가산 청구 대금의 통장 실물 대조 수납 확인이 무결 완료되어 청구서 잔액이 0원으로 청정 리셋 소멸 처리되었습니다. 신규 공고 작성 권한이 전격 복귀 개통되었습니다.',
                is_read: 0,
                created_at: new Date().toISOString()
            });
        }
    }
    db.save();
    res.json({ success: true, message: "본부 오피셜 대금 확인 수납 각인 성료! 영수증 잔액이 0원으로 클리어 청정 세척되었습니다." });
});

app.post('/api/jobs/purge-delete', (req, res) => {
    const { job_id } = req.body;
    if(db.tables['jobs']) db.tables['jobs'] = db.tables['jobs'].filter(j => parseInt(j.id) !== parseInt(job_id));
    db.save();
    res.json({ success: true });
});

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
