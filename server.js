const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// [In-Memory Mock Database]
// ==========================================

// 1. 구인 공고 데이터
let jobsData = [
    {
        id: 'job-1',
        storeName: '대박식당',
        title: '[대박식당] 주말 점심 피크타임 홀 서빙 긴급 구인',
        category: '식당·서빙',
        badgeReq: '체력 베테랑 우대',
        date: '2026-07-28',
        time: '11:30 ~ 14:30 (3시간)',
        pay: 35000,
        feeRate: 0.05, // 1년 정기구독 5% 우대 수수료
        status: '모집중',
        candidates: [
            { id: 'u-1', name: '김철수', phone: '010-1234-5678', badge: '체력 베테랑 (국민체력100 1등급)', rank: 1, status: '출근확정' },
            { id: 'u-2', name: '박영희', phone: '010-9876-5432', badge: '보건증 보유', rank: 2, status: '2순위 대기중 (+5,000원 가산 대상)' }
        ]
    },
    {
        id: 'job-2',
        storeName: '즐거운카페',
        title: '[즐거운카페] 오후 음료 제조 및 식기 세척 피크 알바',
        category: '카페·음료',
        badgeReq: '보건증 필수',
        date: '2026-07-28',
        time: '14:00 ~ 17:00 (3시간)',
        pay: 32000,
        feeRate: 0.10, // 일반 수수료 10%
        status: '모집중',
        candidates: [
            { id: 'u-3', name: '이민수', phone: '010-5555-7777', badge: '자가 문진표 작성', rank: 1, status: '출근확정' }
        ]
    }
];

// 2. 체력 검증 신청 데이터
let verificationsData = [
    { id: 'ver-1', seniorName: '김철수 (68세)', type: '국민체력100', detail: '성남 체력인증센터 1등급', date: '2026-07-26 10:15', status: '심사대기' },
    { id: 'ver-2', seniorName: '박영희 (66세)', type: '보건증', detail: '중원구 보건소 (유효기간 ~2027)', date: '2026-07-26 11:00', status: '심사대기' }
];

// 3. 사장님 정기 구독 & 무통장 입금 신청 데이터
let subscriptionsData = [
    { id: 'sub-1', storeName: '대박식당', employerName: '김대박', amount: 120000, depositor: '김대박', date: '2026-07-26 09:30', status: '입금대기' },
    { id: 'sub-2', storeName: '즐거운카페', employerName: '이즐거운', amount: 120000, depositor: '이즐거운', date: '2026-07-25 14:10', status: '승인완료' }
];

// 4. 알림 데이터
let notificationsData = [
    {
        id: 'noti-1',
        type: 'match',
        title: '[대박식당] 피크타임 근무 2순위 승계 출근 확정!',
        content: '1순위 지원자의 노쇼 발생으로 대기자(2순위) 지원님의 출근이 승계 확정되었습니다. 대기 가산금 +5,000원이 추가 합산됩니다.',
        time: '10분 전',
        read: false
    },
    {
        id: 'noti-2',
        type: 'verify',
        title: '국민체력100 1등급 검증 서류 승인 완료',
        content: '제출하신 인증서 심사가 완료되어 프로필에 [체력 베테랑] 배지가 정상 부여되었습니다.',
        time: '1시간 전',
        read: true
    }
];


// ==========================================
// [REST API Routes]
// ==========================================

// 1. 공고 목록 조회 및 검색 (GET /api/jobs)
app.get('/api/jobs', (req, res) => {
    const { category, search } = req.query;
    let filtered = [...jobsData];

    if (category && category !== '전체') {
        filtered = filtered.filter(j => j.category === category);
    }

    if (search) {
        filtered = filtered.filter(j => j.title.includes(search) || j.storeName.includes(search));
    }

    res.json({ success: true, count: filtered.length, jobs: filtered });
});

// 2. 단일 공고 상세 조회 (GET /api/jobs/:id)
app.get('/api/jobs/:id', (req, res) => {
    const job = jobsData.find(j => j.id === req.params.id);
    if (!job) {
        return res.status(404).json({ success: false, message: '공고를 찾을 수 없습니다.' });
    }
    res.json({ success: true, job });
});

// 3. 신규 피크타임 공고 등록 (POST /api/jobs)
app.post('/api/jobs', (req, res) => {
    const { storeName, title, category, badgeReq, date, time, pay, isSubscribed } = req.body;

    const newJob = {
        id: 'job-' + Date.now(),
        storeName: storeName || '대박식당',
        title,
        category: category || '식당·서빙',
        badgeReq: badgeReq || '체력검증 우대',
        date,
        time,
        pay: parseInt(pay, 10),
        feeRate: isSubscribed ? 0.05 : 0.10, // 구독 사장님은 5% 수수료 적용
        status: '모집중',
        candidates: []
    };

    jobsData.unshift(newJob);
    res.status(201).json({ success: true, message: '피크타임 공고가 등록되었습니다.', job: newJob });
});

// 4. 구직자 지원하기 - 1·2·3순위 자동 대기열 배치 (POST /api/jobs/:id/apply)
app.post('/api/jobs/:id/apply', (req, res) => {
    const { applicantName, phone, badge } = req.body;
    const job = jobsData.find(j => j.id === req.params.id);

    if (!job) {
        return res.status(404).json({ success: false, message: '공고가 존재하지 않습니다.' });
    }

    const currentCandidates = job.candidates || [];
    const rank = currentCandidates.length + 1;

    if (rank > 3) {
        return res.status(400).json({ success: false, message: '이미 1·2·3순위 대기열 매칭이 완료된 공고입니다.' });
    }

    let statusText = `${rank}순위 출근확정`;
    if (rank === 2) statusText = '2순위 대기중 (+5,000원 가산 대상)';
    if (rank === 3) statusText = '3순위 예비대기';

    const newApplicant = {
        id: 'u-' + Date.now(),
        name: applicantName || '김시니어',
        phone: phone || '010-0000-0000',
        badge: badge || '체력 베테랑',
        rank: rank,
        status: statusText
    };

    job.candidates.push(newApplicant);

    // 알림 생성
    notificationsData.unshift({
        id: 'noti-' + Date.now(),
        type: 'match',
        title: `[${job.storeName}] ${rank}순위 매칭 신청 완료`,
        content: `${applicantName}님, ${job.title} 공고에 ${rank}순위로 성공적으로 접수되었습니다.`,
        time: '방금 전',
        read: false
    });

    res.json({
        success: true,
        rank: rank,
        message: `${rank}순위 지원이 완료되었습니다.`,
        applicant: newApplicant
    });
});

// 5. 사장님의 노쇼 처리 및 2순위 자동 승계 실행 (POST /api/jobs/:id/noshow)
app.post('/api/jobs/:id/noshow', (req, res) => {
    const job = jobsData.find(j => j.id === req.params.id);

    if (!job || !job.candidates || job.candidates.length < 2) {
        return res.status(400).json({ success: false, message: '승계 처리할 2순위 대기 지원자가 없습니다.' });
    }

    // 1순위 탈락 처리 및 제거
    const noShowUser = job.candidates.shift(); 
    
    // 2순위 -> 1순위 승계
    job.candidates.forEach((c, idx) => {
        c.rank = idx + 1;
        if (c.rank === 1) {
            c.status = '2순위 승계 출근확정 (+5,000원 가산금 반영)';
        } else {
            c.status = `${c.rank}순위 대기`;
        }
    });

    job.status = '2순위 승계 완료';

    // 2순위 승계 긴급 알림 생성
    const promotedUser = job.candidates[0];
    notificationsData.unshift({
        id: 'noti-' + Date.now(),
        type: 'match',
        title: `[${job.storeName}] 2순위 긴급 승계 출근 확정!`,
        content: `1순위 지원자의 노쇼 발생으로 ${promotedUser.name}님의 출근이 승계 확정되었습니다. 대기 가산금 +5,000원이 지급됩니다.`,
        time: '방금 전',
        read: false
    });

    res.json({
        success: true,
        message: '노쇼 처리 완료. 2순위 대기자에게 승계 및 가산금(+5,000원)이 정상 부여되었습니다.',
        promotedCandidate: promotedUser
    });
});

// 6. 체력 검증 서류 제출 (POST /api/verifications)
app.post('/api/verifications', (req, res) => {
    const { seniorName, type, detail } = req.body;

    const newVer = {
        id: 'ver-' + Date.now(),
        seniorName: seniorName || '시니어 회원',
        type: type || '국민체력100',
        detail: detail || '체력인증센터 검증',
        date: new Date().toISOString().replace('T', ' ').substring(0, 16),
        status: '심사대기'
    };

    verificationsData.unshift(newVer);
    res.status(201).json({ success: true, message: '서류 심사 요청이 접수되었습니다.', verification: newVer });
});

// 7. 관리자 HQ - 체력 검증 승인 및 [체력 베테랑] 배지 부여 (PUT /api/verifications/:id/approve)
app.put('/api/verifications/:id/approve', (req, res) => {
    const item = verificationsData.find(v => v.id === req.params.id);
    if (!item) {
        return res.status(404).json({ success: false, message: '항목을 찾을 수 없습니다.' });
    }

    item.status = '승인완료';

    notificationsData.unshift({
        id: 'noti-' + Date.now(),
        type: 'verify',
        title: `${item.type} 검증 승인 완료`,
        content: `${item.seniorName}님께 [체력 베테랑] 배지가 부여되었습니다.`,
        time: '방금 전',
        read: false
    });

    res.json({ success: true, message: '체력 검증 승인 및 배지 부여가 완료되었습니다.' });
});

// 8. 사장님 연간 구독 무통장 입금 요청 (POST /api/subscriptions)
app.post('/api/subscriptions', (req, res) => {
    const { storeName, employerName, depositor } = req.body;

    const newSub = {
        id: 'sub-' + Date.now(),
        storeName: storeName || '대박식당',
        employerName: employerName || '김대박',
        amount: 120000,
        depositor: depositor || employerName,
        date: new Date().toISOString().replace('T', ' ').substring(0, 16),
        status: '입금대기'
    };

    subscriptionsData.unshift(newSub);
    res.status(201).json({ success: true, message: '구독 입금 확인 요청이 등록되었습니다.', subscription: newSub });
});

// 9. 관리자 HQ - 무통장 입금 승인 & 수수료 5% 감면 처리 (PUT /api/subscriptions/:id/approve)
app.put('/api/subscriptions/:id/approve', (req, res) => {
    const item = subscriptionsData.find(s => s.id === req.params.id);
    if (!item) {
        return res.status(404).json({ success: false, message: '항목을 찾을 수 없습니다.' });
    }

    item.status = '승인완료';

    // 해당 사장님의 기존 공고 수수료율 5%로 감면 처리
    jobsData.forEach(j => {
        if (j.storeName === item.storeName) {
            j.feeRate = 0.05;
        }
    });

    res.json({ success: true, message: `${item.storeName} 사장님의 구독 승인 완료 (수수료 5% 우대 적용)` });
});

// 10. 알림 목록 조회 (GET /api/notifications)
app.get('/api/notifications', (req, res) => {
    res.json({ success: true, notifications: notificationsData });
});

// ==========================================
// [HTML Pages Static Fallback Routing]
// ==========================================
const pages = [
    'index', 'jobs', 'job-detail', 'senior-apply', 
    'employer', 'admin', 'notifications', 'login', 
    'seeker', 'profile'
];

pages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', `${page}.html`));
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 가동
app.listen(PORT, () => {
    console.log(`================================================`);
    console.log(`🚀 실버웍스(silverworks) 풀 스택 백엔드 서버 가동!`);
    console.log(`🌐 서비스 URL: http://localhost:${PORT}`);
    console.log(`📊 REST API 엔드포인트 활성화 완료`);
    console.log(`================================================`);
});