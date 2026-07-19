// ==========================================================================
// SILVERLAB (실버랩) - 상용 실실물 DB 1대1 매칭 보안 격리 백엔드 인프라 [1/3]
// [특이사항] 타인 공고 열람 차단 / 지원자 프로필 독점 열람 권한 / 관리자 실시간 연동
// ==========================================================================

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 사장님 고유 수파베이스 외부 영구 클라우드 DB 창고 열쇠 강력 결속
const SUPABASE_URL = 'https://supabase.co';
const SUPABASE_KEY = 'sb_publishable_xlf7PhQ8NmZ0hf1S8lHOEw_WL_vc'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 악성 스크립트 코드 주입을 차단하는 XSS 방어 샌드박스
function sanitizeInput(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/\//g, '&#x2F;');
}

// 비밀번호 보호용 SHA-256 일방향 해시 암호화 알고리즘
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// 고용노동부 최저임금 규정 하한선 및 유해업종 금지어 세팅
const MINIMUM_WAGE = 10030;
const BAN_WORDS = ['유흥', '성매매', '유사성행위', '마사지', '안마시술소', '도우미'];
function checkBannedWords(text) {
    if (!text) return false;
    return BAN_WORDS.some(word => text.includes(word));
}
// [회원제 API] 오직 아이디/비밀번호 정보만으로 외부 영구 클라우드 DB 다이렉트 가입 처리 (본인인증 전산 생략)
app.post('/api/auth/register', async (req, res) => {
    const { username, password, name, phone, role } = req.body;

    if (!username || !password || !name || !phone || !role) {
        return res.status(400).json({ success: false, message: "필수 가입 서식 정보가 누락되었습니다." });
    }

    if (checkBannedWords(username) || checkBannedWords(name)) {
        return res.status(400).json({ success: false, message: "등록 불가능한 단어가 포함되어 가입이 전산 거부되었습니다. 위반 시 관할 경찰서 수사 고발 조치됩니다." });
    }

    const cleanUsername = sanitizeInput(username);
    const cleanName = sanitizeInput(name);
    const cleanPhone = sanitizeInput(phone);
    const securedPassword = hashPassword(password);

    try {
        const { data: existingUser } = await supabase
            .from('users')
            .select('username')
            .eq('username', cleanUsername)
            .single();

        if (existingUser) {
            return res.status(400).json({ success: false, message: "이미 전산망에 등록되어 있는 사용 중인 아이디입니다." });
        }

        const { error } = await supabase
            .from('users')
            .insert([{ 
                username: cleanUsername, 
                password: securedPassword, 
                name: cleanName, 
                phone: cleanPhone, 
                role: role, 
                status: 'pending',
                fitness_grade: '미인증',
                fitness_grip: '-',
                fitness_flex: '-',
                fitness_cardio: '-'
            }]);

        if (error) throw error;
        res.json({ success: true, message: "회원가입 신청이 정상 완료되었습니다. 실버랩 신원 검증 승인 후 로그인이 가능합니다." });
    } catch (err) {
        console.error("가입 에러:", err);
        res.status(500).json({ success: false, message: "영구 클라우드 DB 저장소 트랜잭션 실패" });
    }
});

// [회원제 API] 사장님, 시니어 권한 분리 검증 클라우드 보안 로그인 처리
app.post('/api/auth/login', async (req, res) => {
    const { username, password, requested_role } = req.body;
    const securedPassword = hashPassword(password);

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .eq('password', securedPassword)
            .single();

        if (error || !user) {
            return res.status(400).json({ success: false, message: "아이디 또는 비밀번호 전산 불일치 오류입니다." });
        }
        if (user.role !== requested_role) {
            return res.status(403).json({ success: false, message: `해당 로그인 창은 ${requested_role === 'employer' ? '구인 사장님' : '구직 시니어'} 전용 채널입니다. 회원 권한 등급을 대조 확인해 주세요.` });
        }
        if (user.status === 'pending') {
            return res.status(403).json({ success: false, message: "현재 실버랩 신원 및 권한 승인 대기 상태입니다. 승인 완료 후 진입 권한이 발급됩니다." });
        }
        res.json({
            success: true,
            user: { username: user.username, name: user.name, role: user.role, status: user.status }
        });
    } catch (err) {
        res.status(400).json({ success: false, message: "아이디 또는 비밀번호 전산 불일치 오류입니다." });
    }
});

// [최고관리자 API] 외부 클라우드 DB 가입 대기 회원 전원 실시간 추출 일괄 반환 통로
app.get('/api/admin/users', async (req, res) => {
    try {
        const { data: rows, error } = await supabase
            .from('users')
            .select('username, name, phone, role, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio')
            .order('id', { ascending: false });

        if (error) throw error;
        res.json({ success: true, users: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: "회원 데이터 클라우드 통신 조회 실패" });
    }
});

// [최고관리자 마스터 API] 신원 승인 버튼 클릭 시 외부 클라우드 DB 및 체력 스펙 즉각 동기화 수정 패치
app.post('/api/admin/update-user', async (req, res) => {
    const { target_username, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio } = req.body;
    try {
        await supabase
            .from('users')
            .update({
                status,
                fitness_grade,
                fitness_grip,
                fitness_flex,
                fitness_cardio
            })
            .eq('username', target_username);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ success: false });
    }
});
// [보안 격리 API ★신규 장착] 사장님 마이페이지 전용 - 내 매장 공고에 '지원한' 시니어 프로필만 독점 추출
app.get('/api/employer/applicants', async (req, res) => {
    const { employer_id, job_id } = req.query;

    if (!employer_id || !job_id) {
        return res.status(400).json({ success: false, message: "필수 조회 권한 정보 누락" });
    }

    try {
        // 1차 보안 검증: 해당 공고가 요청한 사장님의 실물 공고가 맞는지 교차 대조 락
        const { data: job } = await supabase.from('jobs').select('employer_id').eq('id', job_id).single();
        if (!job || job.employer_id !== employer_id) {
            return res.status(403).json({ success: false, message: "권한 오류: 타인 매장의 공고 지원자 내역은 법적으로 열람이 불가능합니다." });
        }

        // 2차 추출: 해당 공고 ID에 정식으로 원서를 던진 지원자 명단 추출
        const { data: apps } = await supabase.from('applications').select('seeker_id').eq('job_id', job_id);
        if (!apps || apps.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const seekerIds = apps.map(a => a.seeker_id);

        // 3차 패키징: 지원자들의 기본 신원, 체력 4대 측정치, 12단계 문진 원본 매핑 결속
        const { data: users } = await supabase.from('users').select('username, name, phone, fitness_grade, fitness_grip, fitness_flex, fitness_cardio').in('username', seekerIds);
        const { data: qas } = await supabase.from('senior_qa').select('*').in('username', seekerIds);

        const result = users.map(u => {
            const qa = qas.find(q => q.username === u.username) || null;
            return { seeker_info: u, senior_answers: qa };
        });

        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, message: "클라우드 매칭 격리 보안 서버 파싱 실패" });
    }
});

// [공고 매칭 API] 시니어 게시판 전용 - 최고 관리자가 'approved' 승인한 정식 공고 목록만 실시간 반환
app.get('/api/jobs/live-board', async (req, res) => {
    try {
        // 사장님이 공고를 올려도 status가 'approved'인 완전 승인본 공고만 선별 기재 (빈틈 제로 락)
        const { data: rows, error } = await supabase
            .from('jobs')
            .select('*')
            .eq('status', 'approved')
            .order('id', { ascending: false });

        if (error) throw error;
        res.json({ success: true, jobs: rows });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// [최고관리자 API ★신규 장착] 사장님 등록 공고 실시간 승인 및 통제 제어 밸런서
app.post('/api/admin/approve-job', async (req, res) => {
    const { job_id, action_status } = req.body; // action_status: 'approved' (승인) 또는 'rejected' (거절)
    try {
        const { error } = await supabase
            .from('jobs')
            .update({ status: action_status })
            .eq('id', job_id);

        if (error) throw error;
        res.json({ success: true, message: "해당 매장 구인공고 최종 승인 완수. 매칭 게시판에 실시간 개통 기재되었습니다." });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// [최고관리자 API ★신규 장착] 실시간 전산망 매칭 관제용 - 전 구인 매장의 실시간 지원 결속 통계 출력
app.get('/api/admin/match-logs', async (req, res) => {
    try {
        const { data: apps } = await supabase.from('applications').select('*').order('id', { ascending: false });
        const { data: jobs } = await supabase.from('jobs').select('id, title, company, employer_id');
        const { data: users } = await supabase.from('users').select('username, name, phone');

        const logs = apps.map(a => {
            const j = jobs.find(job => job.id === a.job_id) || { title: "삭제된 공고", company: "-", employer_id: "-" };
            const seeker = users.find(u => u.username === a.seeker_id) || { name: "알수없음", phone: "-" };
            const owner = users.find(u => u.username === j.employer_id) || { name: "알수없음" };
            return {
                app_id: a.id,
                job_title: j.title,
                company_name: j.company,
                owner_name: owner.name,
                seeker_name: seeker.name,
                seeker_phone: seeker.phone,
                time: a.created_at
            };
        });
        res.json({ success: true, logs });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// 사장님 마이페이지 전용 - 내 고유 계정으로 등록한 공고 내역만 1대1 파싱
app.get('/api/employer/my-jobs', async (req, res) => {
    const { employer_id } = req.query;
    try {
        const { data: rows } = await supabase.from('jobs').select('*').eq('employer_id', employer_id).order('id', { ascending: false });
        res.json({ success: true, jobs: rows || [] });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// 개인 마이페이지 세션 조회 엔드포인트
app.get('/api/profile/me', async (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ success: false });
    try {
        const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
        const { data: qa } = await supabase.from('senior_qa').select('*').eq('username', username).single();
        res.json({ success: true, profile: user, senior_answers: qa || null });
    } catch (err) { res.status(500).json({ success: false }); }
});

// 시니어 12단계 문진 데이터 보존 엔드포인트
app.post('/api/senior/qa', async (req, res) => {
    const { username, answers } = req.body;
    try {
        await supabase.from('senior_qa').upsert({
            username, q1: answers[0], q2: answers[1], q3: answers[2], q4: answers[3],
            q5: answers[4], q6: answers[5], q7: answers[6], q8: answers[7], q9: answers[8],
            q10: answers[9], q11: answers[10], q12: answers[11]
        }, { onConflict: 'username' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// 구인 공고 최초 등록 생성 신청 엔드포인트
app.post('/api/jobs/create', async (req, res) => {
    const { employer_id, title, company, work_date, work_time, wage, job_type } = req.body;
    if (parseInt(wage) < MINIMUM_WAGE) return res.status(400).json({ success: false });
    try {
        await supabase.from('jobs').insert([{ employer_id, title, company, work_date, work_time, wage: parseInt(wage), job_type, status: 'pending' }]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/jobs/apply', async (req, res) => {
    const { job_id, seeker_id } = req.body;
    try {
        await supabase.from('applications').insert([{ job_id, seeker_id, status: 'applied' }]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.listen(PORT, () => {
    console.log(`실버랩 상용 1대1 매칭 보안 격리 백엔드 가동 중 (포트: ${PORT})`);
});

module.exports = app;
