// ==========================================================================
// SILVERWORKS (실버웍스) - 상용 외부 영구 클라우드 DB 무결점 연동 백엔드 시스템 [1/3]
// [특이사항] 렌더 서버 휴면 시 데이터 초기화 에러 원천 차단 / 평생 무료 데이터 봉인 보존
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

// 사장님이 발급받으신 수파베이스 무료 영구 클라우드 데이터 창고 고유 열쇠 직결 결속 락
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
        // 중복 아이디 사전 교차 검증 트랜잭션
        const { data: existingUser } = await supabase
            .from('users')
            .select('username')
            .eq('username', cleanUsername)
            .single();

        if (existingUser) {
            return res.status(400).json({ success: false, message: "이미 전산망에 등록되어 있는 사용 중인 아이디입니다." });
        }

        // 가입 즉시 pending(승인대기) 상태로 외부 클라우드 창고에 물리 영구 보존 기록
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
        res.json({ success: true, message: "회원가입 신청이 정상 완료되었습니다. 실버웍스 신원 검증 승인 후 로그인이 가능합니다." });
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
            return res.status(403).json({ success: false, message: "현재 실버웍스 신원 및 권한 승인 대기 상태입니다. 승인 완료 후 진입 권한이 발급됩니다." });
        }
        res.json({
            success: true,
            user: { username: user.username, name: user.name, role: user.role, status: user.status }
        });
    } catch (err) {
        res.status(400).json({ success: false, message: "아이디 또는 비밀번호 전산 불일치 오류입니다." });
    }
});

// [최고관리자 API ★빈틈 제로 교정 완전판] 외부 클라우드 DB 가입 대기 회원 전원 실시간 추출 일괄 반환 통로
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
// [마이페이지 API] 로그인 회원 전용 실시간 이력서 및 신원 프로필 데이터 동적 조회
app.get('/api/profile/me', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ success: false, message: "인증 세션이 만료되었습니다. 다시 로그인해 주세요." });
    }

    try {
        const { data: user, error: uErr } = await supabase
            .from('users')
            .select('username, name, phone, role, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio, points, account_info')
            .eq('username', username)
            .single();

        if (uErr || !user) {
            return res.status(404).json({ success: false, message: "존재하지 않는 회원 정보입니다." });
        }

        const { data: qa } = await supabase
            .from('senior_qa')
            .select('*')
            .eq('username', username)
            .single();

        res.json({
            success: true,
            profile: user,
            senior_answers: qa || null
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "전산 조회 에러" });
    }
});

// [이력서 API] 시니어 베테랑 12가지 질문지 데이터 클라우드 보존 API
app.post('/api/senior/qa', async (req, res) => {
    const { username, answers } = req.body;
    if (!answers || answers.length < 12) {
        return res.status(400).json({ success: false, message: "12가지 질문지 항목이 누락되었습니다." });
    }

    const cleanAnswers = answers.map(ans => sanitizeInput(ans));
    
    try {
        const { error } = await supabase
            .from('senior_qa')
            .upsert({
                username: username,
                q1: cleanAnswers[0], q2: cleanAnswers[1], q3: cleanAnswers[2], q4: cleanAnswers[3],
                q5: cleanAnswers[4], q6: cleanAnswers[5], q7: cleanAnswers[6], q8: cleanAnswers[7],
                q9: cleanAnswers[8], q10: cleanAnswers[9], q11: cleanAnswers[10], q12: cleanAnswers[11]
            }, { onConflict: 'username' });

        if (error) throw error;
        res.json({ success: true, message: "실버웍스 표준 이력서 데이터가 외부 클라우드에 성공적으로 보존되었습니다." });
    } catch (err) {
        res.status(500).json({ success: false, message: "전산 저장 오류" });
    }
});

// [공고 API] 구인자 공고 등록 신청 (최저임금 및 금지어 실시간 차단 락 내장)
app.post('/api/jobs/create', async (req, res) => {
    const { employer_id, title, company, work_date, work_time, wage, job_type } = req.body;
    const parsedWage = parseInt(wage);

    if (parsedWage < MINIMUM_WAGE) {
        return res.status(400).json({ success: false, message: `고용노동부 최저임금 규정 위반으로 등록 거부되었습니다. (최저시급: ${MINIMUM_WAGE.toLocaleString()}원)` });
    }
    if (checkBannedWords(title) || checkBannedWords(company)) {
        return res.status(400).json({ success: false, message: "공고 내에 등록 불가능한 금지 단어가 포함되어 차단되었습니다." });
    }

    try {
        const { error } = await supabase
            .from('jobs')
            .insert([{
                employer_id,
                title: sanitizeInput(title),
                company: sanitizeInput(company),
                work_date,
                work_time,
                wage: parsedWage,
                job_type,
                status: 'pending'
            }]);

        if (error) throw error;
        res.json({ success: true, message: "구인 공고가 정상 접수되었습니다. 실버웍스 검토 후 기재됩니다." });
    } catch (err) {
        res.status(500).json({ success: false, message: "전산 오류" });
    }
});

app.post('/api/jobs/apply', async (req, res) => {
    const { job_id, seeker_id } = req.body;
    try {
        await supabase.from('applications').insert([{ job_id, seeker_id, status: 'applied' }]);
        res.json({ success: true, message: "지원되었습니다." });
    } catch (err) {
        res.status(400).json({ success: false });
    }
});

app.post('/api/jobs/set-rank', async (req, res) => {
    const { job_id, rank_1, rank_2, rank_3 } = req.body;
    try {
        await supabase
            .from('jobs')
            .update({ rank_1, rank_2, rank_3, match_status: 'matched' })
            .eq('id', job_id);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ success: false });
    }
});

app.post('/api/work/checkout', async (req, res) => {
    const { app_id } = req.body;
    try {
        await supabase.from('applications').update({ work_done: 'yes' }).eq('id', app_id);
        res.json({ success: true, message: "퇴근 처리 완료." });
    } catch (err) {
        res.status(400).json({ success: false });
    }
});

app.post('/api/work/approve', async (req, res) => {
    const { app_id, hours, wage_per_hour, seeker_id } = req.body;
    try {
        await supabase.from('applications').update({ owner_approved: 'yes' }).eq('id', app_id);
        const totalPay = parseInt(hours) * parseInt(wage_per_hour);
        const netPoints = Math.floor(totalPay * 0.967); // 3.3% 원천징수 공제

        // 유저 포인트 실시간 누적 가산
        const { data: u } = await supabase.from('users').select('points').eq('username', seeker_id).single();
        const currentPoints = u ? u.points : 0;

        await supabase.from('users').update({ points: currentPoints + netPoints }).eq('username', seeker_id);
        res.json({ success: true, message: "근무 승인 및 3.3% 사업소득세 원천공제 포인트 정산 완료." });
    } catch (err) {
        res.status(400).json({ success: false, message: "승인 처리 오류" });
    }
});

app.post('/api/points/withdraw', async (req, res) => {
    const { username, account_info } = req.body;
    try {
        await supabase.from('users').update({ account_info }).eq('username', username);
        res.json({ success: true, message: "수동 정산 요청 접수." });
    } catch (err) {
        res.status(400).json({ success: false });
    }
});

// [최고관리자 마스터 API] 신원 승인 버튼 클릭 시 외부 클라우드 DB 즉각 동기화 수정
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

app.post('/api/admin/approve-job', async (req, res) => {
    const { job_id, status } = req.body;
    try {
        await supabase.from('jobs').update({ status }).eq('id', job_id);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ success: false });
    }
});

app.get('/api/admin/billing-invoice', async (req, res) => {
    try {
        const { data: jobs } = await supabase.from('jobs').select('*').eq('status', 'approved').eq('match_status', 'matched');
        const { data: users } = await supabase.from('users').select('username, name, status');

        if (!jobs || jobs.length === 0) return res.json({ success: true, data: [] });

        // 인메모리 그룹핑 정산 연산
        const invoicesMap = {};
        jobs.forEach(j => {
            const u = users.find(user => user.username === j.employer_id) || { name: j.employer_id, status: 'general' };
            if (!invoicesMap[j.employer_id]) {
                invoicesMap[j.employer_id] = {
                    employer_id: j.employer_id,
                    employer_name: u.name,
                    membership_type: u.status === 'premium' ? "프리미엄 연회원 (5%)" : "일반 비회원 (10%)",
                    base_wage: 0
                };
            }
            invoicesMap[j.employer_id].base_wage += j.wage;
        });

        const data = Object.values(invoicesMap).map(inv => {
            const isPremium = inv.membership_type.includes('5%');
            const rate = isPremium ? 1.05 : 1.10;
            return {
                ...inv,
                total_bill: Math.floor(inv.base_wage * rate)
            };
        });

        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.listen(PORT, () => {
    console.log(`실버웍스 평생무료 영구 클라우드 DB 결속 백엔드 구동 중 (포트: ${PORT})`);
});

module.exports = app;
