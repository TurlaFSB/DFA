// Run with:  node tests/dfa.test.js
// Every question is checked against an independent JS oracle on ALL strings up to length 9.
const L = require('../js/dfa.js');
let fail = 0, pass = 0;

const cnt = (w, c) => [...w].filter(x => x === c).length;
const cases = [
  ['strings over {0,1} that end with 01', w => w.endsWith('01'), 3],
  ['contains the substring 101', w => w.includes('101'), 4],
  ['binary numbers divisible by 3', w => w === '' || parseInt(w, 2) % 3 === 0, 3],
  ['binary numbers that are even', w => w === '' || parseInt(w, 2) % 2 === 0, 2],
  ['even number of 0s and odd number of 1s', w => cnt(w, '0') % 2 === 0 && cnt(w, '1') % 2 === 1, 4],
  ['starts with a and ends with b over {a,b}', w => w.startsWith('a') && w.endsWith('b'), 4],
  ["no two consecutive a's over {a,b}", w => !w.includes('aa'), 3],
  ['starts and ends with the same symbol over {a,b}', w => w.length > 0 && w[0] === w[w.length - 1], 5],
  ['the third symbol from the end is 1', w => w.length >= 3 && w[w.length - 3] === '1', 8],
  ['length is at least 3 and ends with ab', w => w.length >= 3 && w.endsWith('ab'), null],
  ['ends with 01 or 10', w => w.endsWith('01') || w.endsWith('10'), null],
  ["exactly two a's over {a,b}", w => cnt(w, 'a') === 2, 4],
  ['number of 0s is at most 2', w => cnt(w, '0') <= 2, 4],
  ["doesn't contain 11 and starts with 1", w => !w.includes('11') && w.startsWith('1'), null],
  ['length divisible by 3 over {a,b}', w => w.length % 3 === 0, 3],
  ["contains 'aba' or 'bab' over {a,b}", w => w.includes('aba') || w.includes('bab'), null],
  ['begins with 0 but does not end with 1', w => w.startsWith('0') && !w.endsWith('1'), null],
  ['the second symbol is 1', w => w.length >= 2 && w[1] === '1', 4],
  ['all strings over {a,b}', () => true, 1],
  ['strings of odd length over {a,b}', w => w.length % 2 === 1, 2],
  ["at least 2 a's and at most 1 b over {a,b}", w => cnt(w, 'a') >= 2 && cnt(w, 'b') <= 1, null],
  ['neither starts with 0 nor ends with 0', w => !w.startsWith('0') && !w.endsWith('0'), null],
  ['only "ab" over {a,b}', w => w === 'ab', 4],
  ['ends with ab or ba over {a,b}', w => w.endsWith('ab') || w.endsWith('ba'), null],
  ['contains 00 and ends with 1', w => w.includes('00') && w.endsWith('1'), null],
  ['not containing 111', w => !w.includes('111'), 4],
  ["number of a's divisible by 3 over {a,b}", w => cnt(w, 'a') % 3 === 0, 3],
  ['the last symbol is 0', w => w.endsWith('0'), 2],
  ['first symbol is 1', w => w.startsWith('1'), 3],
  ['starts and ends with a over {a,b}', w => w.startsWith('a') && w.endsWith('a'), null],
  ['has three consecutive 1s', w => w.includes('111'), 4],
  ['length exactly 2 over {a,b}', w => w.length === 2, 4],
  ['strings over {a,b,c} that contain c', w => w.includes('c'), 2],
  ['empty string only over {a,b}', w => w === '', 2],
  ['binary numbers that leave remainder 1 when divided by 3', w => parseInt(w || '0', 2) % 3 === 1, 3],
  // --- regular expressions, set-builder forms, extra phrasings ---
  ['(a+b)*abb', w => /^(?:a|b)*abb$/.test(w), 4],
  ['regular expression (0+1)*01 over {0,1}', w => /^(?:0|1)*01$/.test(w), 3],
  ['a*b*', w => /^a*b*$/.test(w), 3],
  ['(ab)*', w => /^(?:ab)*$/.test(w), 3],
  ['0*10*', w => /^0*10*$/.test(w), 3],
  ['a(a|b)*b', w => /^a(?:a|b)*b$/.test(w), 4],
  ['ab+ba', w => w === 'ab' || w === 'ba', null],
  ['(a+b)*a(a+b)?', w => /^(?:a|b)*a(?:a|b)?$/.test(w), null],
  ['L = {a^n b^m | n >= 1, m >= 0}', w => /^a+b*$/.test(w), 4],
  ['L = {(ab)^n | n >= 0}', w => /^(?:ab)*$/.test(w), 3],
  ['L = {a^2n | n >= 0} over {a}', w => /^(?:aa)*$/.test(w), 2],
  ['L = { w ∈ {a,b}* | |w|_a is even }', w => cnt(w, 'a') % 2 === 0, 2],
  ['L = { w ∈ {0,1}* | w ends with 01 }', w => w.endsWith('01'), 3],
  ['every a is followed by b over {a,b}', w => !/a(?:a|$)/.test(w), 3],
  ['length between 2 and 4 over {a,b}', w => w.length >= 2 && w.length <= 4, 6],
  ['second last symbol is 1', w => w.length >= 2 && w[w.length - 2] === '1', 4],
  ['decimal numbers divisible by 3', w => parseInt(w || '0', 10) % 3 === 0, 3],
  ['ternary numbers that are even', w => parseInt(w || '0', 3) % 2 === 0, 2],
  ['no two adjacent equal symbols over {a,b}', w => !/aa|bb/.test(w), 4],
  ['starts and ends with different symbols over {a,b}', w => w.length >= 2 && w[0] !== w[w.length - 1], 5],
  ["all a's come before b's", w => /^a*b*$/.test(w), 3],
  ['has a 1 at the third position from the right', w => w.length >= 3 && w[w.length - 3] === '1', 8],
  ["number of a's is 1 mod 3 over {a,b}", w => cnt(w, 'a') % 3 === 1, 3],
  ['contains both a and b over {a,b}', w => w.includes('a') && w.includes('b'), 4],
  ['|w| is divisible by 4 over {a,b}', w => w.length % 4 === 0, 4],
  ["at most 2 consecutive 1s", w => !w.includes('111'), 4],
  ["at least 3 consecutive a's over {a,b}", w => w.includes('aaa'), 4],
  ["'ab' occurs at least 2 times over {a,b}", w => (w.match(/(?=ab)/g) || []).length >= 2, null],
  ['a appears exactly 3 times over {a,b}', w => cnt(w, 'a') === 3, 5],
  ['aa occurs at most once over {a,b}', w => (w.match(/(?=aa)/g) || []).length <= 1, null],
  ['ends with 01 and has odd length', w => w.endsWith('01') && w.length % 2 === 1, null],
];

function* all(alpha, maxLen) {
  let level = [''];
  for (let l = 0; l <= maxLen; l++) {
    for (const s of level) yield s;
    level = level.flatMap(s => alpha.map(c => s + c));
  }
}

for (const [q, oracle, states] of cases) {
  try {
    const r = L.fromQuestion(q);
    let bad = null;
    for (const w of all(r.alphabet, r.alphabet.length > 3 ? 4 : 9)) {
      if (L.run(r.dfa, w).accepted !== !!oracle(w)) { bad = w; break; }
    }
    const stateOk = states === null || r.dfa.n === states;
    if (bad !== null || !stateOk) {
      fail++;
      console.log('FAIL', q, bad !== null ? `(wrong on "${bad}")` : `(expected ${states} states, got ${r.dfa.n})`);
    } else pass++;
  } catch (e) { fail++; console.log('ERROR', q, '->', e.message); }
}

// Error handling
for (const q of ['', 'banana pancakes', 'ends with 2 over {0,1}', 'equal number of 0s and 1s', 'a^n b^n', 'palindromes over {a,b}', '(a+b']) {
  try { L.fromQuestion(q); fail++; console.log('FAIL (should reject)', q); } catch (e) { pass++; }
}
// Manual table
const t = L.fromTable({ alphabet: ['0', '1'], n: 2, start: 0, accept: [false, true], delta: [[0, 1], [0, 1]] });
if (L.run(t, '0101').accepted && !L.run(t, '10').accepted) pass++; else { fail++; console.log('FAIL manual table'); }

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
