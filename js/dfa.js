/*
 * dfa.js — core logic for DFA Studio
 *   question text -> parsed spec tree -> DFA (product / complement / minimise)
 *   plus helpers for running strings, describing languages, sampling strings.
 *
 * DFA object:
 *   { alphabet: string[], n, start, accept: boolean[], delta: number[][], isDead: boolean[] }
 *   delta[state][symbolIndex] = next state   (always a *complete* DFA)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DFALib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class DFAError extends Error {}

  const NUMW = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, once: 1, twice: 2 };
  const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 };
  const ORD_NAME = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
  const MAX_STATES = 4000;

  /* ------------------------------------------------------------------ *
   *  Generic construction helpers
   * ------------------------------------------------------------------ */

  // Build a DFA by exploring reachable "keys" from a start key.
  function explore(alphabet, startKey, step, isAcc) {
    const ids = new Map([[startKey, 0]]);
    const keys = [startKey];
    const delta = [], accept = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      accept[i] = !!isAcc(key);
      delta[i] = alphabet.map(c => {
        const nk = step(key, c);
        if (!ids.has(nk)) {
          if (keys.length >= MAX_STATES) throw new DFAError('That question needs too many states (over ' + MAX_STATES + ').');
          ids.set(nk, keys.length);
          keys.push(nk);
        }
        return ids.get(nk);
      });
    }
    return { alphabet: alphabet.slice(), n: keys.length, start: 0, accept, delta };
  }

  // Build a DFA on integer states 0..n-1 from functions.
  function fromFn(alphabet, n, start, acceptFn, deltaFn) {
    const delta = [], accept = [];
    for (let s = 0; s < n; s++) {
      accept[s] = !!acceptFn(s);
      delta[s] = alphabet.map(c => deltaFn(s, c));
    }
    return { alphabet: alphabet.slice(), n, start, accept, delta };
  }

  function complement(d) {
    return { alphabet: d.alphabet, n: d.n, start: d.start, accept: d.accept.map(x => !x), delta: d.delta };
  }

  function product(a, b, op) {
    const alphabet = a.alphabet;
    return explore(
      alphabet,
      a.start + ',' + b.start,
      (key, c) => {
        const [i, j] = key.split(',').map(Number);
        const ci = alphabet.indexOf(c);
        return a.delta[i][ci] + ',' + b.delta[j][ci];
      },
      key => {
        const [i, j] = key.split(',').map(Number);
        return op === 'and' ? a.accept[i] && b.accept[j] : a.accept[i] || b.accept[j];
      }
    );
  }

  // Compute which states can still reach an accepting state (others are "trap" states).
  function finalize(d) {
    const rev = Array.from({ length: d.n }, () => []);
    for (let s = 0; s < d.n; s++) for (const t of d.delta[s]) rev[t].push(s);
    const co = Array(d.n).fill(false);
    const q = [];
    d.accept.forEach((a, s) => { if (a) { co[s] = true; q.push(s); } });
    for (let i = 0; i < q.length; i++) for (const p of rev[q[i]]) if (!co[p]) { co[p] = true; q.push(p); }
    d.isDead = co.map(x => !x);
    return d;
  }

  // Remove unreachable states, merge equivalent ones (Moore), renumber in BFS order.
  function minimize(d) {
    const seen = [d.start], idx = new Map([[d.start, 0]]);
    for (let i = 0; i < seen.length; i++)
      for (const t of d.delta[seen[i]]) if (!idx.has(t)) { idx.set(t, seen.length); seen.push(t); }
    const n = seen.length;
    const delta = seen.map(s => d.delta[s].map(t => idx.get(t)));
    const acc = seen.map(s => d.accept[s]);

    let cls = acc.map(a => (a ? 1 : 0));
    let count = new Set(cls).size;
    for (;;) {
      const sig = new Map(), next = [];
      for (let s = 0; s < n; s++) {
        const key = cls[s] + '|' + delta[s].map(t => cls[t]).join(',');
        if (!sig.has(key)) sig.set(key, sig.size);
        next[s] = sig.get(key);
      }
      const stable = sig.size === count;
      cls = next; count = sig.size;
      if (stable) break;
    }

    const qd = [], qa = [];
    for (let s = 0; s < n; s++) {
      if (!qd[cls[s]]) { qd[cls[s]] = delta[s].map(t => cls[t]); qa[cls[s]] = acc[s]; }
    }
    // BFS renumber (alphabet order) so q0 is start and states appear in discovery order
    const order = [cls[0]], map = new Map([[cls[0], 0]]);
    for (let i = 0; i < order.length; i++)
      for (const t of qd[order[i]]) if (!map.has(t)) { map.set(t, order.length); order.push(t); }
    return finalize({
      alphabet: d.alphabet.slice(),
      n: order.length,
      start: 0,
      accept: order.map(c => qa[c]),
      delta: order.map(c => qd[c].map(t => map.get(t))),
    });
  }

  /* ------------------------------------------------------------------ *
   *  Basic language automata
   * ------------------------------------------------------------------ */

  function patternDFA(alphabet, w, mode) { // mode: 'contains' | 'ends'
    const m = w.length;
    const step = (s, c) => {
      if (mode === 'contains' && s === m) return m;
      const t = w.slice(0, s) + c;
      for (let k = Math.min(m, t.length); k >= 0; k--) if (t.endsWith(w.slice(0, k))) return k;
      return 0;
    };
    return fromFn(alphabet, m + 1, 0, s => s === m, step);
  }

  function startsDFA(alphabet, w) {
    const m = w.length, dead = m + 1;
    return fromFn(alphabet, m + 2, 0, s => s === m, (s, c) => (s === m ? m : s === dead ? dead : c === w[s] ? s + 1 : dead));
  }

  function equalsDFA(alphabet, w) {
    const m = w.length, dead = m + 1;
    return fromFn(alphabet, m + 2, 0, s => s === m, (s, c) => (s < m && c === w[s] ? s + 1 : dead));
  }

  function countDFA(alphabet, syms, op, n) {
    const cap = n + 1;
    const inS = c => syms === null || syms.includes(c);
    const test = k => ({ eq: k === n, ne: k !== n, ge: k >= n, gt: k > n, le: k <= n, lt: k < n }[op]);
    return fromFn(alphabet, cap + 1, 0, test, (s, c) => (inS(c) ? Math.min(s + 1, cap) : s));
  }

  function cmpOp(op, k, n) { return { eq: k === n, ne: k !== n, ge: k >= n, gt: k > n, le: k <= n, lt: k < n }[op]; }

  function occDFA(alphabet, w, op, n) {
    if (!w.length) throw new DFAError('Which substring should be counted?');
    const m = w.length, cap = n + 1;
    const kmp = patternDFA(alphabet, w, 'ends');
    return explore(alphabet, '0,0', (key, c) => {
      const [st, k] = key.split(',').map(Number);
      const t = kmp.delta[st][alphabet.indexOf(c)];
      return t + ',' + (t === m ? Math.min(k + 1, cap) : k);
    }, key => cmpOp(op, +key.split(',')[1], n));
  }

  function modDFA(alphabet, syms, m, r) {
    const inS = c => syms === null || syms.includes(c);
    return fromFn(alphabet, m, 0, s => s === r % m, (s, c) => (inS(c) ? (s + 1) % m : s));
  }

  const BASENAME = { 2: 'binary', 3: 'ternary', 8: 'octal', 10: 'decimal' };
  function baseOf(alphabet) {
    if (!alphabet.length || !alphabet.every(c => /^\d$/.test(c))) return null;
    return Math.max(2, Math.max(...alphabet.map(Number)) + 1);
  }

  function numDFA(alphabet, m, r) {
    const base = baseOf(alphabet);
    if (!base) throw new DFAError('"Divisible by" on a number needs a digit alphabet such as {0,1}. For letters, use "length divisible by n" or "number of a\'s divisible by n".');
    return fromFn(alphabet, m, 0, s => s === r % m, (s, c) => (s * base + Number(c)) % m);
  }

  function sameEndsDFA(alphabet) {
    return explore(
      alphabet, '',
      (key, c) => (key === '' ? c + '=' : key[0] === c ? key[0] + '=' : key[0] + '!'),
      key => key.endsWith('=')
    );
  }

  function nthEndDFA(alphabet, k, x) {
    if (Math.pow(alphabet.length, k) > 3000) throw new DFAError('That needs too many states — try a smaller position or alphabet.');
    return explore(alphabet, '', (key, c) => (key + c).slice(-k), key => key.length === k && key[0] === x);
  }

  function nthStartDFA(alphabet, k, x) {
    return explore(
      alphabet, 'p0',
      (key, c) => {
        if (key === 'ok' || key === 'no') return key;
        const i = Number(key.slice(1));
        if (i === k - 1) return c === x ? 'ok' : 'no';
        return 'p' + (i + 1);
      },
      key => key === 'ok'
    );
  }

  /* ---------- regular expressions (Thompson NFA -> subset construction) ---------- */
  function parseRegex(src) {
    const toks = [...src.replace(/\s+/g, '')];
    let i = 0;
    const isStart = t => t !== undefined && /[A-Za-z0-9.ελ∅(]/.test(t);
    const bad = m => { throw new DFAError('Regular expression problem: ' + m); };
    function union() {
      const alts = [concat()];
      while (toks[i] === '|' || toks[i] === '+') { i++; alts.push(concat()); }
      return alts.length === 1 ? alts[0] : { k: 'alt', a: alts };
    }
    function concat() {
      const parts = [];
      while (isStart(toks[i])) parts.push(postfix());
      if (!parts.length) return { k: 'eps' };
      return parts.length === 1 ? parts[0] : { k: 'cat', a: parts };
    }
    function postfix() {
      let n = atom();
      for (;;) {
        const t = toks[i];
        if (t === '*') { i++; n = { k: 'star', a: n }; }
        else if (t === '?') { i++; n = { k: 'opt', a: n }; }
        else if (t === '+' && !isStart(toks[i + 1])) { i++; n = { k: 'plus', a: n }; }
        else break;
      }
      return n;
    }
    function atom() {
      const t = toks[i++];
      if (t === '(') { const n = union(); if (toks[i++] !== ')') bad('missing “)”'); return n; }
      if (t === 'ε' || t === 'λ') return { k: 'eps' };
      if (t === '∅') return { k: 'empty' };
      if (t === '.') return { k: 'any' };
      return { k: 'sym', c: t };
    }
    if (!toks.length) bad('it is empty');
    const ast = union();
    if (i < toks.length) bad('unexpected “' + toks[i] + '”');
    return ast;
  }

  function regexDFA(src, alphabet) {
    const ast = parseRegex(src);
    const st = [];
    const nw = () => (st.push({ e: [], t: {} }), st.length - 1);
    const add = (a, c, b) => { (st[a].t[c] = st[a].t[c] || []).push(b); };
    const build = n => {
      let s0, e0;
      switch (n.k) {
        case 'sym': s0 = nw(); e0 = nw(); add(s0, n.c, e0); return [s0, e0];
        case 'any': s0 = nw(); e0 = nw(); alphabet.forEach(c => add(s0, c, e0)); return [s0, e0];
        case 'eps': s0 = nw(); e0 = nw(); st[s0].e.push(e0); return [s0, e0];
        case 'empty': return [nw(), nw()];
        case 'cat': {
          const f = n.a.map(build);
          for (let j = 0; j + 1 < f.length; j++) st[f[j][1]].e.push(f[j + 1][0]);
          return [f[0][0], f[f.length - 1][1]];
        }
        case 'alt': { s0 = nw(); e0 = nw(); n.a.map(build).forEach(f => { st[s0].e.push(f[0]); st[f[1]].e.push(e0); }); return [s0, e0]; }
        case 'star': { s0 = nw(); e0 = nw(); const f = build(n.a); st[s0].e.push(f[0], e0); st[f[1]].e.push(f[0], e0); return [s0, e0]; }
        case 'plus': { s0 = nw(); e0 = nw(); const f = build(n.a); st[s0].e.push(f[0]); st[f[1]].e.push(f[0], e0); return [s0, e0]; }
        case 'opt': { s0 = nw(); e0 = nw(); const f = build(n.a); st[s0].e.push(f[0], e0); st[f[1]].e.push(e0); return [s0, e0]; }
      }
    };
    const [start, fin] = build(ast);
    const closure = set => {
      const seen = new Set(set), stack = [...set];
      while (stack.length) { const x = stack.pop(); for (const y of st[x].e) if (!seen.has(y)) { seen.add(y); stack.push(y); } }
      return [...seen].sort((a, b) => a - b);
    };
    return explore(
      alphabet, closure([start]).join(','),
      (key, c) => {
        const out = new Set();
        for (const x of key ? key.split(',') : []) (st[+x].t[c] || []).forEach(y => out.add(y));
        return closure([...out]).join(',');
      },
      key => key !== '' && key.split(',').includes(String(fin))
    );
  }

  function followedDFA(alphabet, x, y) {
    return explore(alphabet, 'ok', (key, c) => {
      if (key === 'bad') return 'bad';
      if (key === 'pend' && c !== y) return 'bad';
      return c === x ? 'pend' : 'ok';
    }, key => key === 'ok');
  }

  function buildSpec(spec, alphabet) {
    switch (spec.type) {
      case 'all': return fromFn(alphabet, 1, 0, () => true, () => 0);
      case 'starts': return startsDFA(alphabet, spec.w);
      case 'ends': return patternDFA(alphabet, spec.w, 'ends');
      case 'contains': return patternDFA(alphabet, spec.w, 'contains');
      case 'equals': return equalsDFA(alphabet, spec.w);
      case 'count': return countDFA(alphabet, spec.syms, spec.op, spec.n);
      case 'mod': return modDFA(alphabet, spec.syms, spec.m, spec.r);
      case 'num': return numDFA(alphabet, spec.m, spec.r);
      case 'sameEnds': return sameEndsDFA(alphabet);
      case 'nthEnd': return nthEndDFA(alphabet, spec.k, spec.x);
      case 'nthStart': return nthStartDFA(alphabet, spec.k, spec.x);
      case 'regex': return regexDFA(spec.src, alphabet);
      case 'occ': return occDFA(alphabet, spec.w, spec.op, spec.n);
      case 'diffEnds': return buildSpec({ type: 'and', args: [{ type: 'count', syms: null, op: 'ge', n: 2 }, { type: 'not', arg: { type: 'sameEnds' } }] }, alphabet);
      case 'followed': return followedDFA(alphabet, spec.x, spec.y);
      case 'hasRepeat': return buildSpec({ type: 'or', args: alphabet.map(c => ({ type: 'contains', w: c + c })) }, alphabet);
      case 'not': return complement(buildSpec(spec.arg, alphabet));
      case 'and':
      case 'or':
        return spec.args.map(a => minimize(buildSpec(a, alphabet)))
          .reduce((x, y) => minimize(product(x, y, spec.type)));
      default: throw new DFAError('Unknown condition: ' + spec.type);
    }
  }

  /* ------------------------------------------------------------------ *
   *  Running / analysing a DFA
   * ------------------------------------------------------------------ */

  function run(d, str) {
    const path = [d.start];
    let s = d.start;
    for (let i = 0; i < str.length; i++) {
      const ci = d.alphabet.indexOf(str[i]);
      if (ci < 0) return { error: i, path, accepted: false };
      s = d.delta[s][ci];
      path.push(s);
    }
    return { error: -1, path, accepted: d.accept[s] };
  }

  function accessStrings(d) {
    const acc = Array(d.n).fill(null);
    acc[d.start] = '';
    const q = [d.start];
    for (let i = 0; i < q.length; i++) {
      d.delta[q[i]].forEach((t, ci) => {
        if (acc[t] === null) { acc[t] = acc[q[i]] + d.alphabet[ci]; q.push(t); }
      });
    }
    return acc;
  }

  // First few accepted (or rejected) strings in shortlex order.
  function samples(d, wantAccept, count, maxLen) {
    count = count || 6; maxLen = maxLen || 8;
    const out = [];
    let level = [[d.start, '']];
    for (let len = 0; len <= maxLen && out.length < count; len++) {
      for (const [s, str] of level) {
        if (d.accept[s] === wantAccept) { out.push(str); if (out.length >= count) break; }
      }
      if (out.length >= count || level.length > 40000) break;
      const next = [];
      for (const [s, str] of level) d.delta[s].forEach((t, ci) => next.push([t, str + d.alphabet[ci]]));
      level = next;
    }
    return out;
  }

  // Build a validated DFA from a hand-made table.
  function fromTable(t) {
    const k = t.alphabet.length;
    if (!k) throw new DFAError('Alphabet is empty.');
    if (!(t.n >= 1)) throw new DFAError('Need at least one state.');
    for (let s = 0; s < t.n; s++) {
      if (!t.delta[s] || t.delta[s].length !== k) throw new DFAError('Transition table is incomplete.');
      for (const x of t.delta[s]) if (!(x >= 0 && x < t.n)) throw new DFAError('Bad transition target.');
    }
    return finalize({
      alphabet: t.alphabet.slice(), n: t.n, start: t.start,
      accept: t.accept.map(Boolean), delta: t.delta.map(r => r.slice()),
    });
  }

  /* ------------------------------------------------------------------ *
   *  Describing a spec in words
   * ------------------------------------------------------------------ */

  const OPW = { eq: 'exactly', ne: 'not equal to', ge: 'at least', gt: 'more than', le: 'at most', lt: 'fewer than' };
  const FLIP = { eq: 'ne', ne: 'eq', ge: 'lt', gt: 'le', le: 'gt', lt: 'ge' };
  const q = w => (w === '' ? 'ε' : '“' + w + '”');
  const plural = (x, n) => x + (n === 1 ? '' : '’s');
  const LEAF = new Set(['occ', 'diffEnds', 'regex', 'followed', 'hasRepeat', 'all', 'starts', 'ends', 'contains', 'equals', 'count', 'mod', 'num', 'sameEnds', 'nthEnd', 'nthStart']);

  function describe(s, alphabet, neg) {
    neg = !!neg;
    switch (s.type) {
      case 'all': return neg ? 'no string (the language is empty)' : 'w is any string';
      case 'starts': return `w ${neg ? 'does not start' : 'starts'} with ${q(s.w)}`;
      case 'ends': return `w ${neg ? 'does not end' : 'ends'} with ${q(s.w)}`;
      case 'contains': return `w ${neg ? 'does not contain' : 'contains'} the substring ${q(s.w)}`;
      case 'equals': return s.w === '' ? (neg ? 'w is not the empty string' : 'w is the empty string ε') : `w ${neg ? '≠' : '='} ${q(s.w)}`;
      case 'count': {
        const op = neg ? FLIP[s.op] : s.op;
        return s.syms === null
          ? `the length of w is ${OPW[op]} ${s.n}`
          : `the number of ${s.syms.map(x => plural(x, 2)).join('/')} in w is ${OPW[op]} ${s.n}`;
      }
      case 'mod': {
        const what = s.syms === null ? 'the length of w' : `the number of ${s.syms.map(x => plural(x, 2)).join('/')} in w`;
        if (s.m === 2) { const even = (s.r === 0) !== neg; return `${what} is ${even ? 'even' : 'odd'}`; }
        if (s.r === 0) return `${what} is ${neg ? 'not ' : ''}divisible by ${s.m}`;
        return `${what} ${neg ? '≢' : '≡'} ${s.r} (mod ${s.m})`;
      }
      case 'num': {
        const bb = baseOf(alphabet || ['0', '1']) || 2;
        const b = BASENAME[bb] || 'base-' + bb;
        if (s.r === 0) return `w, read as a ${b} number, is ${neg ? 'not ' : ''}divisible by ${s.m}`;
        return `w, read as a ${b} number, ${neg ? 'does not leave' : 'leaves'} remainder ${s.r} when divided by ${s.m}`;
      }
      case 'occ': {
        const op = neg ? FLIP[s.op] : s.op;
        return `the substring ${q(s.w)} occurs ${OPW[op]} ${s.n} time${s.n === 1 ? '' : 's'} in w`;
      }
      case 'diffEnds': return neg ? 'w is shorter than 2 or starts and ends with the same symbol' : 'w starts and ends with different symbols';
      case 'regex': return `w ${neg ? 'does not match' : 'matches'} the regular expression ${s.src}`;
      case 'followed': return neg ? `some ${s.x} in w is not immediately followed by ${s.y}` : `every ${s.x} in w is immediately followed by ${s.y}`;
      case 'hasRepeat': return neg ? 'no two adjacent symbols of w are equal' : 'w has two adjacent equal symbols';
      case 'sameEnds': return neg ? 'w does not start and end with the same symbol' : 'w starts and ends with the same symbol';
      case 'nthEnd': return `the ${ORD_NAME[s.k] || s.k + 'th'} symbol from the end of w ${neg ? 'is not' : 'is'} ${s.x}`;
      case 'nthStart': return `the ${ORD_NAME[s.k] || s.k + 'th'} symbol of w ${neg ? 'is not' : 'is'} ${s.x}`;
      case 'not':
        if (LEAF.has(s.arg.type)) return describe(s.arg, alphabet, !neg);
        if (s.arg.type === 'not') return describe(s.arg.arg, alphabet, neg);
        return (neg ? '' : 'it is not true that ') + '(' + describe(s.arg, alphabet, false) + ')';
      case 'and':
        return s.args.map(a => { const d = describe(a, alphabet, false); return a.type === 'or' ? '(' + d + ')' : d; }).join(' and ');
      case 'or':
        return s.args.map(a => describe(a, alphabet, false)).join(' or ');
    }
    return '?';
  }

  function symbolsUsed(s, set) {
    set = set || new Set();
    const add = str => { for (const ch of str || '') set.add(ch); };
    if (s.w !== undefined) add(s.w);
    if (s.x !== undefined) add(s.x);
    if (s.y !== undefined) add(s.y);
    if (s.src) for (const ch of s.src) if (/[A-Za-z0-9]/.test(ch)) set.add(ch);
    if (s.syms) s.syms.forEach(add);
    if (s.arg) symbolsUsed(s.arg, set);
    if (s.args) s.args.forEach(a => symbolsUsed(a, set));
    return set;
  }

  function hasType(s, type) {
    if (s.type === type) return true;
    if (s.arg && hasType(s.arg, type)) return true;
    if (s.args && s.args.some(a => hasType(a, type))) return true;
    return false;
  }

  /* ------------------------------------------------------------------ *
   *  Natural-language question parser
   * ------------------------------------------------------------------ */

  const STOP = new Set(['the', 'an', 'at', 'no', 'not', 'even', 'odd', 'same', 'all', 'any', 'only', 'more', 'less', 'fewer', 'least', 'most',
    'exactly', 'length', 'number', 'equal', 'symbol', 'symbols', 'letter', 'letters', 'digit', 'digits', 'bit', 'bits', 'string', 'strings',
    'substring', 'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'twice', 'once', 'end', 'start',
    'empty', 'of', 'and', 'or', 'with', 'than', 'from', 'to', 'is', 'are', 'has', 'have', 'which', 'that', 'its', 'it']);

  const NUMRE = '(\\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|once|twice)';
  const QUANT = '(exactly|at\\s+least|at\\s+most|more\\s+than|greater\\s+than|less\\s+than|fewer\\s+than)';
  const SYM = '["\']?([A-Za-z0-9])(?:\'s|’s|s)?["\']?(?![A-Za-z0-9])';
  const TOK = '(?:["\'“‘]([^"\'”’]*)["\'”’]|([A-Za-z0-9]+))';
  const PFX = '(?:the\\s+)?(?:(?:substring|sub-string|subsequence|pattern|prefix|suffix|symbols?|letters?|digits?|bits?|characters?|string)\\s+)?';

  const numOf = s => { s = s.toLowerCase(); return /^\d+$/.test(s) ? +s : NUMW[s]; };
  const ordNum = w => {
    w = w.toLowerCase();
    if (ORD[w]) return ORD[w];
    const m = w.match(/^(\d+)(?:st|nd|rd|th)$/);
    if (m) return +m[1];
    return null;
  };
  function opFrom(s) {
    s = s.toLowerCase();
    if (/at\s+least|>=|≥|minimum|no\s+fewer|no\s+less/.test(s)) return 'ge';
    if (/at\s+most|<=|≤|maximum|no\s+more/.test(s)) return 'le';
    if (/more\s+than|greater\s+than|longer\s+than|exceeds?|>/.test(s)) return 'gt';
    if (/less\s+than|fewer\s+than|shorter\s+than|</.test(s)) return 'lt';
    return 'eq';
  }

  function parseClause(raw, prevType) {
    const orig = raw.trim();
    let c = ' ' + orig.replace(/[.;!?]+$/, '') + ' ';
    c = c.replace(/\b(?:no|not)\s+more\s+than\b/gi, 'at most')
      .replace(/\b(?:no|not)\s+(?:fewer|less)\s+than\b/gi, 'at least')
      .replace(/\bnon-?empty\b/gi, 'not empty');

    let neg = false, dflt = null, base = null;
    const NEG = /\b(?:does\s+not|doesn'?t|do\s+not|don'?t|is\s+not|isn'?t|are\s+not|aren'?t|cannot|can'?t|never|not)\b/i;
    if (NEG.test(c)) { neg = !neg; c = c.replace(NEG, ' '); }
    if (/\bwithout\b/i.test(c)) { neg = !neg; dflt = 'contains'; c = c.replace(/\bwithout\b/i, ' '); }
    const NO = /(^|\s)no\s+(?!more\b|fewer\b|less\b)/i;
    if (NO.test(c)) { neg = !neg; dflt = 'contains'; c = c.replace(NO, ' '); }

    const wrap = s => (neg ? { type: 'not', arg: s } : s);
    const tk = m => (m[1] !== undefined ? { w: m[1], quoted: true } : { w: m[2], quoted: false });
    const fail = () => { throw new DFAError('I couldn’t understand “' + orig + '”. Open “What can I type?” above for supported wording, or use “Build by hand” at the bottom.'); };
    const mk = (type, t) => {
      if (!t.quoted && t.w.length > 1 && STOP.has(t.w.toLowerCase())) fail();
      if (!t.quoted && t.w.length === 1 && /^[A-Za-z0-9]$/.test(t.w) === false) fail();
      base = type;
      return { spec: wrap({ type, w: t.w }), type };
    };
    const out = spec => ({ spec, type: null });
    const symCtx = () => {
      const mm = c.match(new RegExp('number\\s+of\\s+' + SYM, 'i'));
      return mm ? [mm[1]] : null;
    };
    let m;

    // empty string
    if (/\bempty\b|\bepsilon\b|\blambda\b|ε/i.test(c)) return out(wrap({ type: 'equals', w: '' }));

    // first and last symbols different
    if ((/(?:starts?|begins?)\s*&\s*ends?/i.test(c) || /first\s*&\s*last/i.test(c)) && /\bdifferent\b|\bdistinct\b/i.test(c)) {
      return out(wrap({ type: 'diffEnds' }));
    }
    // adjacent equal symbols / alternating
    if (/\b(?:consecutive|adjacent|successive)\b[^.]*\b(?:same|equal|identical|alike|repeated)\b|\b(?:same|equal|identical|repeated)\b[^.]*\b(?:consecutive|adjacent|successive)\b/i.test(c)) {
      return out(wrap({ type: 'hasRepeat' }));
    }
    if (/\balternat(?:e|es|ing)\b/i.test(c)) return out(neg ? { type: 'hasRepeat' } : { type: 'not', arg: { type: 'hasRepeat' } });
    // every x is followed by y  /  all x's before y's
    m = c.match(/\bevery\s+["']?([A-Za-z0-9])(?:'s|’s|s)?["']?\s+(?:is\s+|are\s+|must\s+be\s+)?(?:immediately\s+|directly\s+)?followed\s+by\s+(?:an?\s+)?["']?([A-Za-z0-9])["']?(?![A-Za-z0-9])/i);
    if (m) return out(wrap({ type: 'followed', x: m[1], y: m[2] }));
    m = c.match(/\ball\s+["']?([A-Za-z0-9])(?:'s|’s|s)?["']?\s+(?:come\s+|appear\s+|occur\s+|are\s+)?(?:before|precede|precedes)\s+(?:all\s+)?(?:the\s+)?["']?([A-Za-z0-9])(?:'s|’s|s)?["']?(?![A-Za-z0-9])/i);
    if (m) return out(wrap({ type: 'regex', src: m[1] + '*' + m[2] + '*' }));

    // starts-and-ends (protected form "starts&ends")
    if (/(?:starts?|begins?)\s*&\s*ends?/i.test(c) || /first\s*&\s*last/i.test(c)) {
      if (/\bsame\b|\bequal\b|\bidentical\b|\balike\b/i.test(c)) return out(wrap({ type: 'sameEnds' }));
      m = c.match(new RegExp('(?:starts?|begins?)\\s*&\\s*ends?\\s+with\\s+(?:the\\s+)?(?:symbols?\\s+|letters?\\s+|digits?\\s+|bits?\\s+)?' + TOK, 'i'));
      if (m) {
        const t = tk(m);
        return out(wrap({ type: 'and', args: [{ type: 'starts', w: t.w }, { type: 'ends', w: t.w }] }));
      }
    }

    // at least / at most k consecutive x's
    m = c.match(new RegExp('\\b(at\\s+least|at\\s+most|more\\s+than|fewer\\s+than|less\\s+than)\\s+' + NUMRE + '\\s+(?:consecutive|successive|continuous)\\s+' + SYM, 'i'));
    if (m) {
      const kind = opFrom(m[1]), k = numOf(m[2]), run = n => ({ type: 'contains', w: m[3].repeat(Math.max(1, n)) });
      let sp;
      if (kind === 'ge') sp = run(k);
      else if (kind === 'gt') sp = run(k + 1);
      else if (kind === 'le') sp = { type: 'not', arg: run(k + 1) };
      else sp = { type: 'not', arg: run(k) };
      return out(wrap(sp));
    }
    // substring / symbol occurrences:  "ab occurs at least 2 times"
    m = c.match(new RegExp(TOK + '\\s+(?:appears?\\s+|occurs?\\s+)?' + QUANT + '\\s+' + NUMRE + '(?:\\s+times?\\b|(?<=once|twice)\\b)', 'i'));
    if (m) {
      const t0 = tk(m);
      if (t0.quoted || !STOP.has(t0.w.toLowerCase())) return out(wrap({ type: 'occ', w: t0.w, op: opFrom(m[3]), n: numOf(m[4]) }));
    }

    // consecutive symbols
    m = c.match(/(?:\b(\w+)\s+)?consecutive\s+["']?([A-Za-z0-9])(?:'s|’s|s)?["']?(?![A-Za-z0-9])/i);
    if (m) {
      let n = 2;
      const w1 = (m[1] || '').toLowerCase();
      if (/^\d+$/.test(w1)) n = +w1; else if (NUMW[w1] !== undefined) n = NUMW[w1];
      return out(wrap({ type: 'contains', w: m[2].repeat(Math.max(1, n)) }));
    }

    // k-th symbol from the end / start
    m = c.match(/\b(\w+)\s+(?:(?:symbol|character|letter|bit|char|digit)s?\s+)?from\s+the\s+(end|right|last|back|start|left|beginning|front)\s+(?:is|=|equals?)\s+["']?([A-Za-z0-9])["']?/i);
    if (m) {
      const k = ordNum(m[1]);
      if (k) return out(wrap({ type: /end|right|last|back/i.test(m[2]) ? 'nthEnd' : 'nthStart', k, x: m[3] }));
    }
    m = c.match(/\b(second|third|fourth|fifth|sixth|2nd|3rd|4th|5th|6th)\s*(?:-|\s)\s*(?:to\s*-?\s*)?last\s+(?:symbol|character|letter|bit|char|digit)\s+(?:is|=|equals?)\s+["']?([A-Za-z0-9])["']?/i);
    if (m && ordNum(m[1])) return out(wrap({ type: 'nthEnd', k: ordNum(m[1]), x: m[2] }));
    m = c.match(/(?:^|\s)["']?([A-Za-z0-9])["']?\s+(?:at|in|on)\s+(?:the\s+)?(\w+)\s+(?:position|place|spot|symbol)(?:\s+from\s+the\s+(\w+))?/i);
    if (m && ordNum(m[2])) {
      const fromEnd = m[3] && /end|right|last|back/i.test(m[3]);
      return out(wrap({ type: fromEnd ? 'nthEnd' : 'nthStart', k: ordNum(m[2]), x: m[1] }));
    }
    m = c.match(/(?:^|\s)["']?([A-Za-z0-9])["']?\s+(?:at|in|on)\s+the\s+(end|beginning|start)\b/i);
    if (m) return out(wrap({ type: /end/i.test(m[2]) ? 'ends' : 'starts', w: m[1] }));
    m = c.match(/\blast\s+(?:symbol|character|letter|bit|char|digit)\s+(?:is|=|equals?)\s+["']?([A-Za-z0-9])["']?/i);
    if (m) return out(wrap({ type: 'ends', w: m[1] }));
    m = c.match(/\bfirst\s+(?:symbol|character|letter|bit|char|digit)\s+(?:is|=|equals?)\s+["']?([A-Za-z0-9])["']?/i);
    if (m) return out(wrap({ type: 'starts', w: m[1] }));
    m = c.match(/\b(\w+)\s+(?:symbol|character|letter|bit|char|digit)\s+(?:is|=|equals?)\s+["']?([A-Za-z0-9])["']?/i);
    if (m && ordNum(m[1])) return out(wrap({ type: 'nthStart', k: ordNum(m[1]), x: m[2] }));

    // modular conditions
    m = c.match(/length\s*(?:mod|%)\s*(\d+)\s*(?:=|==|is|equals?|≡)\s*(\d+)/i);
    if (m) return out(wrap({ type: 'mod', syms: null, m: +m[1], r: +m[2] }));
    m = c.match(new RegExp('number\\s+of\\s+' + SYM + '\\s*(?:mod|%)\\s*(\\d+)\\s*(?:=|==|is|equals?|≡)\\s*(\\d+)', 'i'));
    if (m) return out(wrap({ type: 'mod', syms: [m[1]], m: +m[2], r: +m[3] }));
    m = c.match(/(\d+)\s*(?:mod|modulo)\s*(\d+)/i);
    if (m && +m[2] >= 1 && (symCtx() || /\blength\b/i.test(c))) return out(wrap({ type: 'mod', syms: symCtx(), m: +m[2], r: +m[1] % +m[2] }));
    m = c.match(/(?:divisible|multiples?)\s+(?:by|of)\s+(\d+)/i);
    if (m) {
      const mod = +m[1];
      if (mod < 1) fail();
      const sc = symCtx();
      if (sc) return out(wrap({ type: 'mod', syms: sc, m: mod, r: 0 }));
      if (/\blength\b/i.test(c)) return out(wrap({ type: 'mod', syms: null, m: mod, r: 0 }));
      return out(wrap({ type: 'num', m: mod, r: 0 }));
    }
    m = c.match(/remainder\s+(?:of\s+)?(\d+)\s+(?:when|on|upon|after)?\s*(?:being\s+)?(?:divided|division)\s+by\s+(\d+)/i);
    if (m && +m[2] >= 1) return out(wrap({ type: 'num', m: +m[2], r: +m[1] }));
    m = c.match(/\b(even|odd)\b/i);
    if (m) {
      const r = m[1].toLowerCase() === 'even' ? 0 : 1;
      const sc = symCtx();
      if (sc) return out(wrap({ type: 'mod', syms: sc, m: 2, r }));
      if (/\bnumber\s+of\b|\blength\b|\bsymbols\b|\bcharacters\b|\bletters\b/i.test(c)) return out(wrap({ type: 'mod', syms: null, m: 2, r }));
      if (/\b(?:numbers?|values?|integers?)\b/i.test(c)) return out(wrap({ type: 'num', m: 2, r }));
      return out(wrap({ type: 'mod', syms: null, m: 2, r }));
    }

    // between lo and hi
    m = c.match(/between\s+(\d+)\s*&\s*(\d+)/i);
    if (m && (symCtx() || /\b(?:length|symbols|characters|letters|bits|digits)\b/i.test(c))) {
      const syms = symCtx();
      return out(wrap({ type: 'and', args: [{ type: 'count', syms, op: 'ge', n: +m[1] }, { type: 'count', syms, op: 'le', n: +m[2] }] }));
    }
    // explicit regular expression inside a clause
    m = c.match(/\bmatch(?:es)?\s+(?:the\s+)?(?:regex|regular\s+expression|pattern)?\s*[:=]?\s*(\S.*?)\s*$/i);
    if (m) { parseRegex(m[1]); return out(wrap({ type: 'regex', src: m[1].trim() })); }

    // counts
    m = c.match(new RegExp('\\b' + QUANT + '\\s+' + NUMRE + '\\s+(?:symbols?|characters?|letters?|bits?|digits?|chars?)\\b', 'i'));
    if (m) return out(wrap({ type: 'count', syms: null, op: opFrom(m[1]), n: numOf(m[2]) }));
    m = c.match(new RegExp('\\b' + QUANT + '\\s+' + NUMRE + '\\s+(?:occurrences?\\s+of\\s+|instances?\\s+of\\s+|copies\\s+of\\s+)?(?:the\\s+(?:symbol|letter|digit|bit)\\s+)?' + SYM, 'i'));
    if (m) return out(wrap({ type: 'count', syms: [m[3]], op: opFrom(m[1]), n: numOf(m[2]) }));
    m = c.match(new RegExp('number\\s+of\\s+' + SYM + '\\s*((?:is|are|=|==|equals?|>=|<=|>|<|≥|≤|exactly|at\\s+least|at\\s+most|more\\s+than|less\\s+than|fewer\\s+than|greater\\s+than|equal\\s+to|\\s)*)' + NUMRE + '\\b', 'i'));
    if (m) return out(wrap({ type: 'count', syms: [m[1]], op: opFrom(m[2]), n: numOf(m[3]) }));
    if (/\b(?:length|size)\b/i.test(c)) {
      m = c.match(/\b(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
      if (m) return out(wrap({ type: 'count', syms: null, op: opFrom(c), n: numOf(m[1]) }));
    }
    m = c.match(/\b(longer|shorter)\s+than\s+(\d+)/i);
    if (m) return out(wrap({ type: 'count', syms: null, op: m[1].toLowerCase() === 'longer' ? 'gt' : 'lt', n: +m[2] }));

    // exact (quoted) string
    m = c.match(/(?:\bonly\b|\bexactly\b|\bequals?\b|\bequal\s+to\b|\bis\b)\s+(?:the\s+)?(?:string\s+)?["'“‘]([^"'”’]*)["'”’]/i);
    if (m) return out(wrap({ type: 'equals', w: m[1] }));

    // prefix / suffix / substring
    m = c.match(new RegExp('\\b(?:starts?|starting|begins?|beginning)\\s+(?:with|from)\\s+' + PFX + TOK, 'i'));
    if (m) return mk('starts', tk(m));
    m = c.match(new RegExp('\\b(?:ends?|ending|terminates?|terminating|finish(?:es)?)\\s+(?:with|in|on)\\s+' + PFX + TOK, 'i'));
    if (m) return mk('ends', tk(m));
    m = c.match(new RegExp('\\b(?:contains?|containing|has|have|having|includes?|including|with|substring)\\s+' + PFX + TOK, 'i'));
    if (m) return mk('contains', tk(m));

    // bare token (e.g. the "10" in "ends with 01 or 10")
    m = c.match(new RegExp('^\\s*' + TOK + '\\s*$', 'i'));
    if (m) {
      const t = prevType || dflt;
      if (t) return mk(t, tk(m));
    }
    return fail();
  }

  function extractAlphabet(t) {
    const am = t.match(/(?:\bover\b|\balphabet\b|[Σ∑]|\bsigma\b)\s*(?:of|is)?\s*(?:=|:)?\s*\{?\s*([A-Za-z0-9](?:\s*,\s*[A-Za-z0-9])*)(?![A-Za-z0-9])\s*\}?/i);
    if (!am) return { text: t, explicit: null };
    return { text: t.replace(am[0], ' '), explicit: Array.from(new Set(am[1].split(/\s*,\s*/))) };
  }

  function parseQuestion(text) {
    if (!text || !text.trim()) throw new DFAError('Type a question first, e.g. “strings over {0,1} that end with 01”.');
    const ex = extractAlphabet(' ' + text.trim() + ' ');
    let t = ex.text;
    const explicit = ex.explicit;
    const base = /\bbinary\b/i.test(t) ? 2 : /\bternary\b/i.test(t) ? 3 : /\boctal\b/i.test(t) ? 8 : /\bdecimal\b/i.test(t) ? 10 : null;

    t = t.replace(/\b(?:please|design|construct|draw|build|make|create|give\s+me|write|find)\b/gi, ' ')
      .replace(/\b(?:an?\s+)?(?:dfa|nfa|deterministic\s+finite\s+(?:state\s+)?(?:automaton|automata|machine)|finite\s+(?:state\s+)?(?:automaton|automata|machine)|automaton|automata)\b/gi, ' ')
      .replace(/\b(?:such\s+that|in\s+which|so\s+that|that|which|where)\b/gi, ' ')
      .replace(/\b(?:accepts?|accepting|accepted|recogni[sz]es?|recogni[sz]ing|generates?|language\s+of|language|set\s+of)\b/gi, ' ')
      .replace(/\b(?:all|every|any)\s+(?=(?:strings?|words?|inputs?|sequences?)\b)/gi, ' ')
      .replace(/\b(?:strings?|words?|inputs?|sequences?)\b/gi, ' ')
      .replace(/\b(?:over|using|binary|ternary|octal|decimal|both)\b/gi, ' ')
      .replace(/(^|\s)L\s*=\s*/g, ' ')
      .replace(/(^|\s)w(?=\s)/g, ' ')
      .replace(/\bbetween\s+(\d+)\s+(?:and|to)\s+(\d+)/gi, 'between $1&$2')
      .replace(/\bneither\b/gi, ' not ')
      .replace(/\bnor\b/gi, ' and not ')
      .replace(/\beither\b/gi, ' ')
      .replace(/\b(starts?|begins?)\s+and\s+(ends?)\b/gi, '$1&$2')
      .replace(/\bfirst\s+and\s+last\b/gi, 'first&last')
      .replace(/\s+/g, ' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '');

    if (!t) return { spec: { type: 'all' }, explicit, base };

    const parts = t.split(/\s+(and|or|but)\s+|\s*[,;]\s*/i);
    const clauses = [], ops = [];
    for (let i = 0; i < parts.length; i += 2) {
      if (parts[i] === undefined || /^\s*$/.test(parts[i])) continue;
      clauses.push(parts[i]);
      ops.push(i + 1 < parts.length ? ((parts[i + 1] || 'and').toLowerCase() === 'or' ? 'or' : 'and') : null);
    }
    if (!clauses.length) return { spec: { type: 'all' }, explicit, base };

    const specs = [];
    let prevType = null;
    clauses.forEach(cl => {
      const r = parseClause(cl, prevType);
      if (r.type) prevType = r.type;
      specs.push(r.spec);
    });

    // AND binds tighter than OR
    const groups = [[specs[0]]];
    for (let i = 1; i < specs.length; i++) {
      if (ops[i - 1] === 'or') groups.push([specs[i]]);
      else groups[groups.length - 1].push(specs[i]);
    }
    const g = groups.map(a => (a.length === 1 ? a[0] : { type: 'and', args: a }));
    const spec = g.length === 1 ? g[0] : { type: 'or', args: g };
    return { spec, explicit, base };
  }

  function inferAlphabet(used, base, needNum) {
    const u = Array.from(used);
    const range = n => Array.from({ length: n }, (_, i) => String(i));
    if (base && u.every(c => /^\d$/.test(c) && +c < base)) return range(base);
    if (!u.length) return needNum ? ['0', '1'] : ['a', 'b'];
    if (u.every(c => c === '0' || c === '1')) return ['0', '1'];
    if (u.every(c => /^\d$/.test(c))) {
      const mx = Math.max(...u.map(Number));
      return Array.from({ length: mx + 1 }, (_, i) => String(i));
    }
    const s = u.sort();
    if (s.length === 1) s.push(s[0] === 'a' ? 'b' : 'a');
    return s.sort();
  }

  /* ------------------------------------------------------------------ *
   *  Special input forms: non-regular languages, a^n b^m, regular expressions
   * ------------------------------------------------------------------ */

  function nonRegular(reason) {
    const e = new DFAError('No DFA exists for this language — it is not regular. ' + reason +
      ' A DFA has only finitely many states, so it cannot remember an unbounded amount. ' +
      'This is the classic case for the Pumping Lemma proof.');
    e.nonRegular = true;
    return e;
  }

  function nonRegularReason(t) {
    if (/\b(?:equal|same)\s+(?:number|count|amount|no\.?)\s+of\b/i.test(t) && !/\bmod(?:ulo)?\b/i.test(t)) return 'Comparing two unbounded counts (e.g. equal numbers of 0s and 1s) needs unbounded memory.';
    if (/number\s+of\s+["']?\w["']?(?:'s|’s|s)?\s*(?:is|are|=|==|equals?)\s*(?:the\s+)?number\s+of/i.test(t)) return 'Comparing two unbounded counts needs unbounded memory.';
    if (/\bpalindrom/i.test(t)) return 'A palindrome check must remember the whole first half of the string.';
    if (/\b(?:prime|perfect\s+square|power\s+of\s+(?:2|two)|factorial|fibonacci)\b/i.test(t)) return 'Lengths like that are not eventually periodic.';
    return null;
  }

  function regexParsed(str) {
    const ex = extractAlphabet(' ' + str + ' ');
    const src = ex.text.trim().replace(/[.]+$/, '').trim();
    parseRegex(src); // throws a friendly error on bad syntax
    return { spec: { type: 'regex', src }, explicit: ex.explicit, base: null };
  }

  // "{ a^n b^m | n ≥ 1, m ≥ 0 }"  ->  regular expression (or a non-regular error)
  function powersToRegex(t) {
    if (!/\^/.test(t)) return null;
    const ex = extractAlphabet(' ' + t + ' ');
    let body = ex.text.trim().replace(/^\s*(?:L\s*=\s*)?\{?/i, '').replace(/\}\s*\.?\s*$/, '').trim();
    let left = body, cond = '';
    const bar = body.search(/[|:]/);
    if (bar >= 0) { left = body.slice(0, bar); cond = body.slice(bar + 1); }
    left = left.replace(/^\s*w\s*=\s*/, '').trim();
    const tokRe = /\s*(\([^()]*\)|[A-Za-z0-9])(?:\^\s*(?:\{([^}]*)\}|([A-Za-z0-9+*]+)))?/y;
    const parts = [];
    let pos = 0;
    while (pos < left.length) {
      tokRe.lastIndex = pos;
      const mm = tokRe.exec(left);
      if (!mm) return null;
      parts.push({ base: mm[1].replace(/^\(|\)$/g, ''), exp: (mm[2] !== undefined ? mm[2] : mm[3] || '').replace(/\s+/g, '') });
      pos = tokRe.lastIndex;
      if (/^\s*$/.test(left.slice(pos))) break;
    }
    if (!parts.length || !parts.some(p => p.exp)) return null;

    const mins = {}, fixed = {};
    const cre = /([a-z](?:\s*,\s*[a-z])*)\s*(≥|>=|>|≤|<=|<|=|==)\s*(\d+)/g;
    let cm;
    while ((cm = cre.exec(cond))) {
      cm[1].split(/\s*,\s*/).forEach(v => {
        const k = +cm[3];
        if (cm[2] === '≥' || cm[2] === '>=') mins[v] = k;
        else if (cm[2] === '>') mins[v] = k + 1;
        else if (cm[2] === '=' || cm[2] === '==') fixed[v] = k;
        else throw new DFAError('An upper bound on the exponent makes the language finite — write the strings out or use a regular expression.');
      });
    }
    const uses = {};
    const info = parts.map(p => {
      let m;
      if (!p.exp) return { p, kind: 'once' };
      if (/^\d+$/.test(p.exp)) return { p, kind: 'num', k: +p.exp };
      if ((m = p.exp.match(/^([a-z])$/))) { uses[m[1]] = (uses[m[1]] || 0) + 1; return { p, kind: 'var', v: m[1], c: 1 }; }
      if ((m = p.exp.match(/^(\d+)\*?([a-z])$/))) { uses[m[2]] = (uses[m[2]] || 0) + 1; return { p, kind: 'var', v: m[2], c: +m[1] }; }
      throw new DFAError('I can read exponents like n, 2n or a number — not “' + p.exp + '”. Try a regular expression instead.');
    });
    for (const v in uses) if (uses[v] > 1 && fixed[v] === undefined) throw nonRegular('The same exponent “' + v + '” appears twice (like aⁿbⁿ), so the machine would have to count ' + v + '.');
    const unit = (b, c) => { const u = b.length === 1 ? b : '(' + b + ')'; return c === 1 ? u : '(' + u.repeat(c) + ')'; };
    const rep = (u, k) => (k === 0 ? '' : u.repeat(k));
    let src = '';
    for (const it of info) {
      const b = it.p.base;
      if (it.kind === 'once') src += unit(b, 1);
      else if (it.kind === 'num') src += rep(unit(b, 1), it.k);
      else {
        const u = unit(b, it.c);
        if (fixed[it.v] !== undefined) src += rep(u, fixed[it.v]);
        else src += rep(u, mins[it.v] || 0) + u + '*';
      }
    }
    return { src: src || 'ε', explicit: ex.explicit };
  }

  function tryRegexParsed(t) {
    const ex = extractAlphabet(' ' + t + ' ');
    const s = ex.text
      .replace(/\b(?:please|design|construct|draw|build|make|create|give\s+me|write|find)\b/gi, ' ')
      .replace(/\b(?:an?\s+)?(?:dfa|deterministic\s+finite\s+(?:state\s+)?(?:automaton|automata|machine)|automaton)\b/gi, ' ')
      .replace(/\b(?:for|to\s+accept|that\s+accepts?|accepting|the\s+language|the\s+set|language|accepts?)\b/gi, ' ')
      .replace(/(^|\s)L\s*(?:\([^)]*\))?\s*=\s*/g, ' ')
      .trim().replace(/[.]+$/, '').trim();
    if (!/^[A-Za-z0-9()+*|?.ελ∅\s]+$/.test(s) || !/[()+*|?.]/.test(s)) return null;
    try { parseRegex(s); } catch (e) { return null; }
    return { spec: { type: 'regex', src: s }, explicit: ex.explicit, base: null };
  }

  // Main entry: question text -> { dfa, spec, alphabet, cond, lang, notes }
  function fromQuestion(text, forcedAlphabet) {
    if (!text || !text.trim()) throw new DFAError('Type a question first, e.g. “strings over {0,1} that end with 01”.');
    let t = text.trim();
    // { w ∈ {a,b}* | condition }
    const sb = t.match(/\{\s*w\s*(?:∈|in|\\in)\s*\{([^}]*)\}\s*\*?\s*(?:\||:|such\s+that)\s*([\s\S]*?)\s*\}\s*\.?\s*$/i);
    if (sb) t = sb[2] + ' over {' + sb[1] + '}';
    // |w|, |w|_a, n_a(w), #a(w)  ->  words
    t = t.replace(/\|\s*w\s*\|\s*_\s*\{?([A-Za-z0-9])\}?/g, 'number of $1')
      .replace(/\bn_?\{?([A-Za-z0-9])\}?\s*\(\s*w\s*\)/g, 'number of $1')
      .replace(/#\s*([A-Za-z0-9])\s*\(\s*w\s*\)/g, 'number of $1')
      .replace(/\|\s*w\s*\|/g, 'length');

    const reason = nonRegularReason(t);
    if (reason) throw nonRegular(reason);

    let parsed = null, nlErr = null;
    const pw = powersToRegex(t);
    if (pw) parsed = { spec: { type: 'regex', src: pw.src }, explicit: pw.explicit, base: null };
    if (!parsed) {
      const rm = t.match(/\b(?:regular\s+expression|regex)\b\s*(?:for|is|of|[:=])?\s*([\s\S]+)$/i);
      if (rm) parsed = regexParsed(rm[1]);
    }
    if (!parsed) {
      try { parsed = parseQuestion(t); } catch (e) { if (!(e instanceof DFAError)) throw e; nlErr = e; }
    }
    if (!parsed) { parsed = tryRegexParsed(t); if (!parsed) throw nlErr; }

    const used = symbolsUsed(parsed.spec);
    const needNum = hasType(parsed.spec, 'num');
    const notes = [];
    let alphabet = forcedAlphabet && forcedAlphabet.length ? forcedAlphabet : parsed.explicit;
    if (!alphabet) {
      alphabet = inferAlphabet(used, parsed.base, needNum);
      notes.push('Σ was not given, so I assumed Σ = {' + alphabet.join(', ') + '}. You can change it under “Options”.');
    }
    for (const c of used) {
      if (!alphabet.includes(c)) {
        throw new DFAError('The question uses the symbol “' + c + '”, which is not in Σ = {' + alphabet.join(', ') + '}. Add it to Σ or fix the question.');
      }
    }
    if (needNum) notes.push('The empty string ε is treated as the number 0.');
    if (hasType(parsed.spec, 'sameEnds')) notes.push('ε is rejected (it has no first/last symbol).');
    const dfa = minimize(buildSpec(parsed.spec, alphabet));
    const cond = describe(parsed.spec, alphabet);
    const set = '{' + alphabet.join(', ') + '}';
    return {
      dfa, spec: parsed.spec, alphabet, cond, notes,
      lang: 'L = { w ∈ ' + set + '* | ' + cond + ' }',
    };
  }

  return {
    DFAError, fromQuestion, parseQuestion, buildSpec, minimize, run, accessStrings, samples,
    fromTable, finalize, describe, symbolsUsed, baseOf,
  };
});
