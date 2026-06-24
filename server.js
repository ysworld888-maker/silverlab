const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 데이터베이스 로드 및 영구 저장 파일 연결
const db = new sqlite3.Database('./silverlab.db', (err) => {
    if (err) return console.error(err.message);
    console.log('실버랩 보안 데이터베이스 연결 완료.');
});

// 데이터 유실 방지용 기본 테이블 구조 동적 빌드
db.serialize(() => {
    // 1. 회원 정보 테이블 (일반 구직회원 정보 관리용)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT
    )`);

    // 2. 구인구직 동적 카드 관리 테이블 (가게이름, 근무장소, 근무시간, 전화번호)
    db.run(`CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, shop_name TEXT, location TEXT, work_time TEXT, phone TEXT
    )`);

    // 3. 시니어 질문지 전용 보안 보관 테이블 (우리만 보기 통제 설정)
    db.run(`CREATE TABLE IF NOT EXISTS seniors (
        id INTEGER PRIMARY KEY AUTOINCREMENT, q1 TEXT, q2 TEXT, q3 TEXT, q4 TEXT, q5 TEXT,
        q6 TEXT, q7 TEXT, q8 TEXT, q9 TEXT, q10 TEXT, q11 TEXT, q12 TEXT, date TEXT
    )`);

    // 4. 사장님 구인 상담 신청 보안 보관 테이블 (우리만 보기 통제 설정)
    db.run(`CREATE TABLE IF NOT EXISTS employers (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT, date TEXT
    )`);

    // 초기 마스터 테스트 데이터 셋 주입 (계정 유도 및 기본 일자리 리스트 자동화)
    db.run(`INSERT OR IGNORE INTO users (username, password, role) VALUES ('senior', '1234', 'user')`);
    db.run(`INSERT OR IGNORE INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin')`);
    
    db.get(`SELECT COUNT(*) as count FROM jobs`, (err, row) => {
        if (row && row.count === 0) {
            db.run(`INSERT INTO jobs (shop_name, location, work_time, phone) VALUES ('분당 파크카페', '경기도 성남시 분당구 정자동', '오전 파트 09:00 ~ 11:30 (월-금)', '031-712-9876')`);
            db.run(`INSERT INTO jobs (shop_name, location, work_time, phone) VALUES ('중앙 유통물류', '서울시 서초구 서초동', '피크 타임 12:00 ~ 14:30 (화,목)', '02-544-1234')`);
        }
    });
});
// [API 1] 구인구직 게시판 및 관리자 가상 로그인 통제 창구
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (row) {
            res.json({ success: true, username: row.username, role: row.role });
        } else {
            res.json({ success: false, message: '아이디 또는 비밀번호가 틀렸습니다.' });
        }
    });
});

// [API 2] 등록된 동적 구인 카드 목록 전체 불러오기 창구
app.get('/api/jobs', (req, res) => {
    db.all(`SELECT * FROM jobs ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// [API 3] 관리자 전용: 새로운 구인 카드 등록 창구 (Create)
app.post('/api/jobs', (req, res) => {
    const { shop_name, location, work_time, phone } = req.body;
    const sql = `INSERT INTO jobs (shop_name, location, work_time, phone) VALUES (?, ?, ?, ?)`;
    db.run(sql, [shop_name, location, work_time, phone], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

// [API 4] 관리자 전용: 기존 구인 카드 내용 수정 창구 (Update)
app.put('/api/jobs/:id', (req, res) => {
    const { shop_name, location, work_time, phone } = req.body;
    const { id } = req.params;
    const sql = `UPDATE jobs SET shop_name = ?, location = ?, work_time = ?, phone = ? WHERE id = ?`;
    db.run(sql, [shop_name, location, work_time, phone, id], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

// [API 5] 관리자 전용: 불필요한 구인 카드 삭제 창구 (Delete)
app.delete('/api/jobs/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM jobs WHERE id = ?`, [id], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

// [API 6] 시니어 페이지: 대화형 질문지 보안 저장 창구
app.post('/api/senior', (req, res) => {
    const d = req.body;
    const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const sql = `INSERT INTO seniors (q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12, date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    const params = [d.q1, d.q2, d.q3, d.q4, d.q5, d.q6, d.q7, d.q8, d.q9, d.q10, d.q11, d.q12, dateStr];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

// [API 7] 사장님 페이지: 구인 상담 신청 보안 저장 창구
app.post('/api/employer', (req, res) => {
    const { name, phone } = req.body;
    const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const sql = `INSERT INTO employers (name, phone, date) VALUES (?, ?, ?)`;
    db.run(sql, [name, phone, dateStr], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

// [API 8] 통합 관리자 전용: 수집된 보안 데이터 전체 조회 창구 (우리만 보기 통제)
app.get('/api/admin/data', (req, res) => {
    db.all(`SELECT * FROM seniors ORDER BY id DESC`, [], (err, seniorRows) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all(`SELECT * FROM employers ORDER BY id DESC`, [], (err, employerRows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ seniors: seniorRows, employers: employerRows });
        });
    });
});

app.listen(PORT, () => {
    console.log(`실버랩 백엔드 서버 가동 성공: http://localhost:${PORT}`);
});
