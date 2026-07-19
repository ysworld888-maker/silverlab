const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Supabase 무료 영구 클라우드 DB 고유 주소 및 마스터 키 완벽 바인딩
const SUPABASE_URL = 'https://supabase.co';
const SUPABASE_KEY = 'sb_publishable_xlf7PhQ8NmZ0hf1S8lHOEw_WL_vc'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const hashPw = (pw) => crypto.createHash('sha256').update(pw).digest('hex');

// [회원가입 API] pending(승인대기) 상태로 클라우드 DB에 즉시 영구 봉인
app.post('/api/auth/register', async (req, res) => {
    const { username, password, name, phone, role } = req.body;
    try {
        const { data: ex } = await supabase.from('users').select('username').eq('username', username).single();
        if (ex) return res.status(400).json({ success: false, message: "사용 중인 아이디" });

        await supabase.from('users').insert([{ username, password: hashPw(password), name, phone, role, status: 'pending' }]);
        res.json({ success: true, message: "가입 신청 완료. 관리자 승인 후 로그인 가능합니다." });
    } catch (err) { res.status(500).json({ success: false }); }
});

// [로그인 API] 사장님/시니어 권한 채널 일치 여부 정밀 대조 및 승인 락 필터 작동
app.post('/api/auth/login', async (req, res) => {
    const { username, password, requested_role } = req.body;
    try {
        const { data: u } = await supabase.from('users').select('*').eq('username', username).eq('password', hashPw(password)).single();
        if (!u) return res.status(400).json({ success: false, message: "계정 정보 불일치" });
        if (u.role !== requested_role) return res.status(403).json({ success: false, message: "권한 채널 불일치" });
        if (u.status === 'pending') return res.status(403).json({ success: false, message: "신원 승인 대기 상태" });
        res.json({ success: true, user: u });
    } catch (err) { res.status(400).json({ success: false, message: "계정 오류" }); }
});

// [관리자 전용 API] 실시간 가입 명단 전체 호출 통로
app.get('/api/admin/users', async (req, res) => {
    const { data } = await supabase.from('users').select('*').order('id', { ascending: false });
    res.json({ success: true, users: data || [] });
});

// [관리자 전용 API] 스펙 수치 직접 기입 및 실시간 클라우드 DB 업데이트 보존 라우터
app.post('/api/admin/update-user', async (req, res) => {
    const { target_username, status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio } = req.body;
    await supabase.from('users').update({ status, fitness_grade, fitness_grip, fitness_flex, fitness_cardio }).eq('username', target_username);
    res.json({ success: true });
});

// [보안 격리 API] 내 공고에 정식 '지원한' 시니어 프로필 및 문진표 사본만 자사 독점 실시간 파싱
app.get('/api/employer/applicants', async (req, res) => {
    const { employer_id, job_id } = req.query;
    try {
        const { data: j } = await supabase.from('jobs').select('employer_id').eq('id', job_id).single();
        if (!j || j.employer_id !== employer_id) return res.status(403).json({ success: false });

        const { data: apps } = await supabase.from('applications').select('seeker_id').eq('job_id', job_id);
        if (!apps || apps.length === 0) return res.json({ success: true, data: [] });

        const sIds = apps.map(a => a.seeker_id);
        const { data: users } = await supabase.from('users').select('*').in('username', sIds);
        const { data: qas } = await supabase.from('senior_qa').select('*').in('username', sIds);

        const resData = users.map(u => ({ seeker_info: u, senior_answers: qas.find(q => q.username === u.username) || null }));
        res.json({ success: true, data: resData });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/jobs/live-board', async (req, res) => {
    const { data } = await supabase.from('jobs').select('*').eq('status', 'approved').order('id', { ascending: false });
    res.json({ success: true, jobs: data || [] });
});

app.post('/api/admin/approve-job', async (req, res) => {
    const { job_id, action_status } = req.body;
    await supabase.from('jobs').update({ status: action_status }).eq('id', job_id);
    res.json({ success: true });
});

app.get('/api/admin/match-logs', async (req, res) => {
    const { data: apps } = await supabase.from('applications').select('*').order('id', { ascending: false });
    const { data: jobs } = await supabase.from('jobs').select('*');
    const { data: users } = await supabase.from('users').select('*');
    const logs = (apps || []).map(a => {
        const j = jobs.find(job => job.id === a.job_id) || { title: "삭제된 공고", company: "-", employer_id: "-" };
        return {
            app_id: a.id, job_title: j.title, company_name: j.company,
            seeker_name: (users.find(u => u.username === a.seeker_id) || { name: "알수없음" }).name,
            seeker_phone: (users.find(u => u.username === a.seeker_id) || { phone: "-" }).phone
        };
    });
    res.json({ success: true, logs });
});

app.get('/api/employer/my-jobs', async (req, res) => {
    const { data } = await supabase.from('jobs').select('*').eq('employer_id', req.query.employer_id).order('id', { ascending: false });
    res.json({ success: true, jobs: data || [] });
});

app.get('/api/profile/me', async (req, res) => {
    const { username } = req.query;
    const { data: u } = await supabase.from('users').select('*').eq('username', username).single();
    const { data: qa } = await supabase.from('senior_qa').select('*').eq('username', username).single();
    res.json({ success: true, profile: u, senior_answers: qa || null });
});

app.post('/api/senior/qa', async (req, res) => {
    const { username, answers } = req.body;
    await supabase.from('senior_qa').upsert({
        username, q1: answers[0], q2: answers[1], q3: answers[2], q4: answers[3], q5: answers[4],
        q6: answers[5], q7: answers[6], q8: answers[7], q9: answers[8], q10: answers[9], q11: answers[10], q12: answers[11]
    }, { onConflict: 'username' });
    res.json({ success: true });
});

app.post('/api/jobs/create', async (req, res) => {
    const { employer_id, title, company, work_date, work_time, wage, job_type } = req.body;
    if (parseInt(wage) < 10030) return res.status(400).json({ success: false });
    await supabase.from('jobs').insert([{ employer_id, title, company, work_date, work_time, wage: parseInt(wage), job_type, status: 'pending' }]);
    res.json({ success: true });
});

app.post('/api/jobs/apply', async (req, res) => {
    await supabase.from('applications').insert([{ job_id: req.body.job_id, seeker_id: req.body.seeker_id, status: 'applied' }]);
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`서버 가동 중 포트: ${PORT}`));
module.exports = app;
