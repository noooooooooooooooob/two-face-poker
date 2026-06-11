// 자동 시뮬레이션 테스트: 두 클라이언트가 여러 라운드 플레이
const WebSocket = require('ws');
const URL = 'ws://localhost:3000';

function mk(name) {
  const ws = new WebSocket(URL);
  const c = { name, ws, state: null };
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    c.onMsg && c.onMsg(m);
  });
  return c;
}

const A = mk('Alice'), B = mk('Bob');
let rounds = 0, done = false;

function act(c, m) {
  if (m.type !== 'state' || done) return;
  c.state = m;
  const s = m;
  if (s.phase === 'side' && s.turn === 'you' && !s.you.side) {
    // 양면이 둘 다 7 이상이면 both, 아니면 높은 면
    const { white, black } = s.you.card;
    let side = white >= black ? 'white' : 'black';
    if (Math.min(white, black) >= 7 && s.you.coins >= 2) side = 'both';
    c.ws.send(JSON.stringify({ type: 'side', side }));
  } else if (s.phase === 'betting' && s.turn === 'you') {
    if (s.you.level < s.opp.level) {
      c.ws.send(JSON.stringify({ type: 'action', action: 'call' }));
    } else if (c.name === 'Alice' && s.maxRaiseAdd >= 2 && Math.random() < 0.5) {
      c.ws.send(JSON.stringify({ type: 'action', action: 'raise', amount: 2 }));
    } else {
      c.ws.send(JSON.stringify({ type: 'action', action: 'check' }));
    }
  } else if (s.phase === 'over') {
    if (!s.you.ready) {
      if (c.name === 'Alice') {
        rounds++;
        console.log(`[R${s.round}] pot이월=${s.carry} | Alice=${s.you.coins} Bob=${s.opp.coins} | 합=${s.you.coins + s.opp.coins + s.carry}`);
        if (s.reveal) s.reveal.forEach(r => console.log(`   ${r.name}: W${r.card.white}/B${r.card.black} side=${r.side}`));
        console.log('   ' + s.log.slice(-3).join(' | '));
        if (rounds >= 12) { done = true; console.log('TEST DONE: 12 rounds OK'); process.exit(0); }
      }
      c.ws.send(JSON.stringify({ type: 'next' }));
    }
  } else if (s.phase === 'gameover') {
    console.log(`GAME OVER: ${c.name} coins=${s.you.coins}`);
    if (c.name === 'Alice') { done = true; console.log('TEST DONE: gameover reached'); process.exit(0); }
  }
}

A.onMsg = m => {
  if (m.type === 'created') B.ws.send(JSON.stringify({ type: 'join', code: m.code, name: 'Bob' }));
  act(A, m);
};
B.onMsg = m => act(B, m);

A.ws.on('open', () => A.ws.send(JSON.stringify({ type: 'create', name: 'Alice' })));
setTimeout(() => { console.log('TIMEOUT - 진행 멈춤'); process.exit(1); }, 15000);
