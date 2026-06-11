// AI 대전 자동 테스트: 사람 역할 클라이언트가 AI와 라운드 진행
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');
let rounds = 0;

ws.on('open', () => ws.send(JSON.stringify({ type: 'createAI', name: 'Human' })));
ws.on('message', raw => {
  const s = JSON.parse(raw);
  if (s.type !== 'state') return;
  if (s.phase === 'side' && s.turn === 'you' && !s.you.side) {
    const side = s.you.card.white >= s.you.card.black ? 'white' : 'black';
    ws.send(JSON.stringify({ type: 'side', side }));
  } else if (s.phase === 'betting' && s.turn === 'you') {
    if (s.you.level < s.opp.level) ws.send(JSON.stringify({ type: 'action', action: 'call' }));
    else if (s.maxRaiseAdd >= 1 && Math.random() < 0.4) ws.send(JSON.stringify({ type: 'action', action: 'raise', amount: 1 }));
    else ws.send(JSON.stringify({ type: 'action', action: 'check' }));
  } else if (s.phase === 'over' && !s.you.ready) {
    rounds++;
    console.log(`[R${s.round}] Human=${s.you.coins} AI=${s.opp.coins} carry=${s.carry} 합=${s.you.coins + s.opp.coins + s.carry}`);
    console.log('   ' + s.log.slice(-2).join(' | '));
    if (rounds >= 8) { console.log('AI TEST DONE'); process.exit(0); }
    ws.send(JSON.stringify({ type: 'next' }));
  } else if (s.phase === 'gameover') {
    console.log(`GAME OVER. Human=${s.you.coins}`);
    console.log('AI TEST DONE (gameover)');
    process.exit(0);
  }
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 40000);
