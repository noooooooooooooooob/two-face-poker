// 양면 포커 - 1대1 온라인 서버
// 실행: npm install && npm start  →  http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const START_COINS = 40;
const ANTE = 1;
const BOTH_BONUS = 10;

// ---------- 정적 파일 서버 ----------
const server = http.createServer((req, res) => {
  let file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const fp = path.join(__dirname, 'public', path.normalize(file).replace(/^(\.\.[\/\\])+/, ''));
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(fp);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map(); // code -> room

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(c));
  return c;
}

function dealCard() {
  // white = 짝수(2,4,6,8,10), black = 홀수(1,3,5,7,9)
  return {
    white: (Math.floor(Math.random() * 5) + 1) * 2,
    black: Math.floor(Math.random() * 5) * 2 + 1,
  };
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

// ---------- 게임 로직 ----------
function newRoom(code) {
  return {
    code,
    players: [], // {ws, name, coins, card, side, level, committed, ready}
    phase: 'waiting', // waiting | side | betting | over | gameover
    dealer: 0,        // 선 인덱스
    turn: 0,
    pot: 0,
    carry: 0,         // 무승부 이월 팟
    checks: 0,
    round: 0,
    log: [],
  };
}

function addLog(room, msg) {
  room.log.push(msg);
  if (room.log.length > 60) room.log.shift();
}

function mult(p) { return p.side === 'both' ? 2 : 1; }

function affordableLevel(p) { return p.level + Math.floor(p.coins / mult(p)); }

function maxLevel(room) {
  return Math.min(...room.players.map(affordableLevel));
}

function startRound(room) {
  room.round++;
  room.pot = room.carry;
  room.carry = 0;
  room.checks = 0;
  for (const p of room.players) {
    p.card = dealCard();
    p.side = null;
    p.level = 0;
    p.committed = 0;
    p.ready = false;
  }
  // 앤티는 면 선택 시 함께 지불 (both면 2코인)
  room.phase = 'side';
  room.turn = room.dealer;
  addLog(room, `--- ${room.round}라운드 시작 (선: ${room.players[room.dealer].name}) ---`);
  broadcast(room);
}

function chooseSide(room, idx, side, amount) {
  const p = room.players[idx];
  if (room.phase !== 'side' || room.turn !== idx || p.side) return;
  if (!['white', 'black', 'both'].includes(side)) return;
  const o = room.players[1 - idx];
  const m = side === 'both' ? 2 : 1;
  let amt = Math.floor(Number(amount)) || ANTE;
  amt = Math.max(ANTE, Math.min(amt, Math.floor(p.coins / m), affordableLevel(o)));
  const cost = amt * m;
  if (p.coins < cost) { send(p.ws, { type: 'error', msg: '코인이 부족합니다.' }); return; }
  p.side = side;
  p.level = amt;
  p.coins -= cost;
  p.committed += cost;
  room.pot += cost;
  addLog(room, `${p.name} 면 선택 + ${cost}코인 배팅`);
  if (o.side) {
    room.phase = 'betting';
    // 배팅액이 다르면 적게 건 쪽부터, 같으면 선부터
    room.turn = p.level === o.level ? room.dealer : (p.level < o.level ? idx : 1 - idx);
  } else {
    room.turn = 1 - idx;
  }
  broadcast(room);
}

function action(room, idx, act, amount) {
  const p = room.players[idx];
  const o = room.players[1 - idx];

  // 면 선택 단계에서 다이: 기본 배팅 1코인만 내고 포기
  if (room.phase === 'side') {
    if (act !== 'fold' || room.turn !== idx || p.side) return;
    const pay = Math.min(ANTE, p.coins);
    p.coins -= pay; p.committed += pay; room.pot += pay;
    addLog(room, `${p.name} 다이 (기본 배팅 ${pay}코인 지불). ${o.name}이(가) 팟 ${room.pot}코인 획득`);
    const gain = room.pot;
    o.coins += room.pot;
    endRound(room, 1 - idx, idx, null, gain);
    return;
  }

  if (room.phase !== 'betting' || room.turn !== idx) return;

  if (act === 'fold') {
    addLog(room, `${p.name} 폴드. ${o.name}이(가) 팟 ${room.pot}코인 획득`);
    const gain = room.pot;
    o.coins += room.pot;
    endRound(room, 1 - idx, idx, null, gain);
    return;
  }

  if (act === 'check') {
    if (p.level !== o.level) return;
    room.checks++;
    addLog(room, `${p.name} 체크`);
    if (room.checks >= 2) { showdown(room); return; }
    room.turn = 1 - idx;
    broadcast(room);
    return;
  }

  if (act === 'call') {
    if (p.level >= o.level) return;
    const diff = (o.level - p.level) * mult(p);
    const pay = Math.min(diff, p.coins);
    p.coins -= pay; p.committed += pay; room.pot += pay;
    p.level = o.level;
    addLog(room, `${p.name} 콜 (${pay}코인)`);
    showdown(room);
    return;
  }

  if (act === 'raise') {
    const r = Math.floor(Number(amount));
    if (!r || r < 1) return;
    const newLevel = Math.max(p.level, o.level) + r;
    if (newLevel > maxLevel(room)) { send(p.ws, { type: 'error', msg: '레이즈 한도를 초과했습니다.' }); return; }
    const pay = (newLevel - p.level) * mult(p);
    p.coins -= pay; p.committed += pay; room.pot += pay;
    p.level = newLevel;
    room.checks = 0;
    addLog(room, `${p.name} 레이즈 +${r} (${pay}코인 지불)`);
    room.turn = 1 - idx;
    broadcast(room);
    return;
  }
}

function faceValue(p) { return p.side === 'white' ? p.card.white : p.card.black; }

function showdown(room) {
  const [a, b] = room.players;
  let winner = -1; // -1 무승부
  let bonusWinner = -1;

  const aBoth = a.side === 'both', bBoth = b.side === 'both';

  if (!aBoth && !bBoth) {
    const va = faceValue(a), vb = faceValue(b);
    if (va > vb) winner = 0; else if (vb > va) winner = 1;
  } else if (aBoth && !bBoth) {
    const vb = faceValue(b);
    if (a.card.white > vb && a.card.black > vb) { winner = 0; bonusWinner = 0; }
    else winner = 1;
  } else if (!aBoth && bBoth) {
    const va = faceValue(a);
    if (b.card.white > va && b.card.black > va) { winner = 1; bonusWinner = 1; }
    else winner = 0;
  } else {
    // 둘 다 양면: 높은 면끼리, 같으면 낮은 면끼리 비교
    const hiA = Math.max(a.card.white, a.card.black), hiB = Math.max(b.card.white, b.card.black);
    const loA = Math.min(a.card.white, a.card.black), loB = Math.min(b.card.white, b.card.black);
    if (hiA !== hiB) winner = hiA > hiB ? 0 : 1;
    else if (loA !== loB) winner = loA > loB ? 0 : 1;
    if (winner !== -1) bonusWinner = winner;
  }

  const reveal = room.players.map(p => ({ name: p.name, card: p.card, side: p.side }));

  if (winner === -1) {
    addLog(room, `무승부! 팟 ${room.pot}코인은 다음 게임으로 이월`);
    room.carry = room.pot;
    endRound(room, -1, -1, reveal, 0);
    return;
  }

  const w = room.players[winner], l = room.players[1 - winner];
  let bonus = 0;
  if (bonusWinner === winner) {
    bonus = Math.min(BOTH_BONUS, l.coins);
    l.coins -= bonus;
  }
  const gain = room.pot + bonus;
  w.coins += room.pot + bonus;
  addLog(room, `${w.name} 승리! 팟 ${room.pot}코인` + (bonus ? ` + 양면 보너스 ${bonus}코인` : ''));
  endRound(room, winner, 1 - winner, reveal, gain);
}

function endRound(room, winner, loser, reveal, gain) {
  room.pot = 0;
  if (loser !== -1) room.dealer = loser; // 진 사람이 다음 선
  room.phase = 'over';

  // 게임 종료 판정: 다음 라운드 앤티(1코인)도 못 내면 패배
  const broke = room.players.findIndex(p => p.coins < ANTE);
  if (broke !== -1) {
    room.phase = 'gameover';
    const champ = room.players[1 - broke];
    addLog(room, `🏆 ${champ.name} 최종 승리! (${room.players[broke].name} 코인 소진)`);
    broadcast(room, { reveal, winner, gain, gameWinner: 1 - broke });
    return;
  }
  broadcast(room, { reveal, winner, gain });
}

function nextRound(room, idx) {
  if (room.phase !== 'over') return;
  room.players[idx].ready = true;
  if (room.players.every(p => p.ready)) startRound(room);
  else broadcast(room);
}

function rematch(room, idx) {
  if (room.phase !== 'gameover') return;
  room.players[idx].ready = true;
  if (room.players.every(p => p.ready)) {
    for (const p of room.players) p.coins = START_COINS;
    room.carry = 0;
    room.dealer = Math.floor(Math.random() * 2);
    room.log = [];
    addLog(room, '재경기 시작!');
    startRound(room);
  } else broadcast(room);
}

// ---------- AI 봇 ----------
function botAct(room) {
  if (!room.isBot || room.players.length < 2) return;
  const bot = room.players[1];

  if (room.phase === 'side' && room.turn === 1 && !bot.side) {
    const { white, black } = bot.card;
    const opp = room.players[0];
    const best = Math.max(white, black);
    // 상대가 크게 걸었는데 패가 나쁘면 다이
    if (opp.level >= 3 && best <= 4 && Math.random() < 0.7) { action(room, 1, 'fold'); return; }
    let side = white >= black ? 'white' : 'black';
    if (Math.min(white, black) >= 7 && bot.coins >= 2 && Math.random() < 0.8) side = 'both';
    const v = side === 'both' ? Math.min(white, black) : best;
    let amt = 1;
    if (v >= 9 && Math.random() < 0.5) amt = 2 + Math.floor(Math.random() * 2);
    else if (v >= 7 && Math.random() < 0.3) amt = 2;
    chooseSide(room, 1, side, amt);
    return;
  }

  if (room.phase === 'betting' && room.turn === 1) {
    const opp = room.players[0];
    const v = bot.side === 'both' ? Math.min(bot.card.white, bot.card.black) : faceValue(bot);
    const maxAdd = Math.max(0, maxLevel(room) - Math.max(bot.level, opp.level));
    const behind = bot.level < opp.level;

    if (behind) {
      const diff = opp.level - bot.level;
      if (bot.side === 'both') { action(room, 1, 'call'); return; }
      if (v >= 8 && maxAdd >= 1 && Math.random() < 0.45) { action(room, 1, 'raise', Math.min(2, maxAdd)); return; }
      const winP = (v - 0.5) / 10;
      if (winP * (room.pot + diff) >= diff || v >= 6 || Math.random() < 0.15) action(room, 1, 'call');
      else action(room, 1, 'fold');
    } else {
      if (maxAdd >= 1 && (v >= 7 || Math.random() < 0.12)) action(room, 1, 'raise', Math.min(1 + Math.floor(Math.random() * 2), maxAdd));
      else action(room, 1, 'check');
    }
    return;
  }

  if (room.phase === 'over' && !bot.ready) { nextRound(room, 1); return; }
  if (room.phase === 'gameover' && !bot.ready) { rematch(room, 1); return; }
}

function scheduleBot(room) {
  if (!room.isBot) return;
  clearTimeout(room.botTimer);
  const fast = room.phase === 'over' || room.phase === 'gameover';
  room.botTimer = setTimeout(() => botAct(room), fast ? 400 : 700 + Math.random() * 900);
}

function broadcast(room, extra = {}) {
  room.players.forEach((p, i) => {
    const o = room.players[1 - i];
    send(p.ws, {
      type: 'state',
      youIdx: i,
      phase: room.phase,
      round: room.round,
      pot: room.pot,
      carry: room.carry,
      dealer: room.dealer === i ? 'you' : 'opp',
      turn: room.turn === i ? 'you' : 'opp',
      maxRaiseAdd: room.phase === 'betting' ? Math.max(0, maxLevel(room) - Math.max(p.level, o ? o.level : 0)) : 0,
      maxInitBet: room.phase === 'side' && o ? Math.max(1, Math.min(p.coins, affordableLevel(o))) : 0,
      you: { name: p.name, coins: p.coins, card: p.card, side: p.side, level: p.level, committed: p.committed, ready: p.ready },
      opp: o ? { name: o.name, coins: o.coins, sideChosen: !!o.side, level: o.level, committed: o.committed, ready: o.ready } : null,
      log: room.log,
      ...extra,
    });
  });
  scheduleBot(room);
}

// ---------- 연결 처리 ----------
wss.on('connection', (ws) => {
  let room = null, idx = -1;

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'create') {
      const code = makeCode();
      room = newRoom(code);
      rooms.set(code, room);
      idx = 0;
      room.players.push({ ws, name: (m.name || '플레이어1').slice(0, 12), coins: START_COINS });
      send(ws, { type: 'created', code });
      return;
    }

    if (m.type === 'createAI') {
      const code = makeCode();
      room = newRoom(code);
      room.isBot = true;
      rooms.set(code, room);
      idx = 0;
      room.players.push({ ws, name: (m.name || '플레이어').slice(0, 12), coins: START_COINS });
      room.players.push({ ws: null, name: '🤖 AI', coins: START_COINS });
      room.dealer = Math.floor(Math.random() * 2);
      addLog(room, `${room.players[0].name} vs 🤖 AI — 시작 코인 ${START_COINS}개`);
      startRound(room);
      return;
    }

    if (m.type === 'join') {
      const r = rooms.get((m.code || '').toUpperCase().trim());
      if (!r) { send(ws, { type: 'error', msg: '방을 찾을 수 없습니다.' }); return; }
      if (r.players.length >= 2) { send(ws, { type: 'error', msg: '방이 가득 찼습니다.' }); return; }
      room = r; idx = 1;
      room.players.push({ ws, name: (m.name || '플레이어2').slice(0, 12), coins: START_COINS });
      room.dealer = Math.floor(Math.random() * 2); // 첫 선은 랜덤
      send(ws, { type: 'joined', code: room.code });
      addLog(room, `${room.players[0].name} vs ${room.players[1].name} — 시작 코인 ${START_COINS}개`);
      startRound(room);
      return;
    }

    if (!room || idx === -1) return;
    if (m.type === 'side') chooseSide(room, idx, m.side, m.amount);
    else if (m.type === 'action') action(room, idx, m.action, m.amount);
    else if (m.type === 'next') nextRound(room, idx);
    else if (m.type === 'rematch') rematch(room, idx);
  });

  ws.on('close', () => {
    if (!room) return;
    clearTimeout(room.botTimer);
    const other = room.players[1 - idx];
    if (other) send(other.ws, { type: 'opponentLeft' });
    rooms.delete(room.code);
  });
});

server.listen(PORT, () => console.log(`양면 포커 서버 실행 중: http://localhost:${PORT}`));
