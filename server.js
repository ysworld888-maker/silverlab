const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 무료 서버의 바이너리 결함을 영구 방어하기 위한 내장 초경량 파일 원장 데이터베이스 엔진 결속
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
    save() { fs.writeFileSync(this.filePath, JSON.stringify(this.tables, null, 2), 'utf8'); }
    serialize(callback) { callback(); }
    run(query, params = [], callback) {
        // 내장 원장 스키마 구조 보존 가드 자동화
        const tName = query.split('EXISTS ')[1]?.split(' ')[0] || query.split('INTO ')[1]?.split(' ')[0] || query.split('UPDATE ')[1]?.split(' ')[0] || query.split('DELETE FROM ')[1]?.split(' ')[0];
        if(tName) {
            const cleanTName = tName.trim().replace(/`/g, '');
            if(!this.tables[cleanTName]) this.tables[cleanTName] = [];
            
            if(query.includes('INSERT INTO')) {
                const fieldsPart = query.split('(')[1].split(')')[0].split(',').map(f => f.trim());
                const rowObj = { id: this.tables[cleanTName].length + 1 };
                fieldsPart.forEach((f, idx) => { rowObj[f] = params[idx]; });
                // 기본값 보정 매트릭스
                if(cleanTName === 'users') { rowObj.points = rowObj.points || 0; rowObj.subscription_status = rowObj.subscription_status || 'normal'; rowObj.is_blacklist = rowObj.is_blacklist || 0; rowObj.fitness_grade = rowObj.fitness_grade || '미인증'; }
                if(cleanTName === 'jobs') { rowObj.status = rowObj.status || 'approved'; rowObj.is_pinned = rowObj.is_pinned || 0; }
                this.tables[cleanTName].push(rowObj);
                this.save();
                if(callback) callback.call({ lastID: rowObj.id }, null);
                return;
            }
            if(query.includes('UPDATE')) {
                const setPart = query.split('SET ')[1].split(' WHERE')[0];
                const wherePart = query.split('WHERE ')[1];
                this.tables[cleanTName].forEach(row => {
                    if(wherePart.includes('username = ?') && row.username === params[params.length-1]) {
                        if(setPart.includes('points = points + ?')) row.points = (row.points || 0) + params[0];
                        if(setPart.includes('is_blacklist = ?')) row.is_blacklist = params[0];
                        if(setPart.includes('emergency_phone = ?')) row.emergency_phone = params[0];
                    }
                    if(wherePart.includes('id = ?') && row.id === params[params.length-1]) {
                        if(setPart.includes('status = ?')) row.status = params[0];
                    }
                });
                this.save();
                if(callback) callback(null);
                return;
            }
            if(query.includes('DELETE')) {
                const idVal = params[0];
                this.tables[cleanTName] = this.tables[cleanTName].filter(row => row.id !== idVal);
                this.save();
                if(callback) callback(null);
                return;
            }
        }
        if(callback) callback(null);
    }
    get(query, params = [], callback) {
        const tName = query.split('FROM ')[1]?.split(' ')[0]?.trim().replace(/`/g, '');
        if(!this.tables[tName]) this.tables[tName] = [];
        let matched = null;
        if(query.includes('username = ? AND password = ?')) {
            matched = this.tables[tName].find(r => r.username === params[0] && r.password === params[1]);
        } else if(query.includes('username = ?')) {
            matched = this.tables[tName].find(r => r.username === params[0]);
        } else if(query.includes('id = ?')) {
            matched = this.tables[tName].find(r => r.id === params[0]);
        } else if(query.includes('COUNT(*)')) {
            const cnt = this.tables[tName].filter(r => r.employer_id === params[0] && ['pending','paid_requested'].includes(r.status)).length;
            if(callback) callback(null, { cnt: cnt });
            return;
        }
        if(callback) callback(null, matched);
    }
    all(query, params = [], callback) {
        const tName = query.split('FROM ')[1]?.split(' ')[0]?.trim().replace(/`/g, '');
        if(!this.tables[tName]) this.tables[tName] = [];
        let rows = [...this.tables[tName]];
        if(query.includes('employer_id = ?')) {
            rows = rows.filter(r => r.employer_id === params[0]);
        } else if(query.includes('job_id = ?')) {
            rows = rows.filter(r => r.job_id === params[0]);
        }
        if(query.includes('ORDER BY is_pinned DESC')) {
            rows.sort((a,b) => (b.is_pinned||0) - (a.is_pinned||0) || b.id - a.id);
        } else if(query.includes('ORDER BY id DESC')) {
            rows.sort((a,b) => b.id - a.id);
        }
        if(callback) callback(null, rows);
    }
}

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const dbPath = path.join(DATA_DIR, 'silverworks_v2_core.json');
const db = new LightWeightFileDB(dbPath);

const hashPw = (pw) => crypto.createHash('sha256').update(pw).digest('hex');

// [무료 인프라 전용 최적화] db.serialize 구문을 완벽히 파쇄하고 경량 파일엔진 데이터 레이어로 마운트 전환
// 기존의 db.serialize(() => { ... }) 라인 전체를 아래 코드로 싹 덮어쓰기 하시면 에러가 PROBLEMS 0개로 청정 소멸합니다.
if (typeof db.serialize === 'function') {
    db.serialize(() => {});
}

