# DFA Studio

An interactive tool that turns a DFA question into a finished answer — **language, formal definition, state diagram and a step-by-step animation of any input string**.

Type the question the way it is given in class, e.g.

> Design a DFA over {0,1} that accepts strings ending with 01

and you get:

1. **The language** in set notation — `L = { w ∈ {0,1}* | w ends with “01” }`
2. **The minimal DFA**, drawn as a state diagram (double circle = final state, dashed = trap state)
3. **The formal definition** — `Q, Σ, q₀, F` and the full transition table δ
4. **Example accepted / rejected strings**
5. **An animation**: enter any string and watch the token move along the transitions, with the tape, the δ-trace and the final ACCEPT / REJECT verdict. Play, pause, step forward/back, adjustable speed.

Everything runs in the browser — no server, no build step, no dependencies.

## Run it

Just open `index.html` in a browser.

To host it for free: GitHub → *Settings → Pages → Deploy from branch → `main` / root*.

## What questions are understood

| Kind | Examples |
|---|---|
| Prefix / suffix / substring | `starts with 01`, `ends with ab`, `contains 101`, `does not contain 11`, `no two consecutive a's`, `only "abc"` |
| Counting | `exactly two a's`, `at least 3 b's`, `at most 1 zero`, `length at least 3`, `length exactly 4` |
| Parity / modular | `even number of 0s`, `odd length`, `length divisible by 3`, `number of a's divisible by 3` |
| Numbers | `binary numbers divisible by 3`, `binary numbers that are even`, `remainder 1 when divided by 3` |
| Positions | `third symbol from the end is 1`, `second symbol is 0`, `first symbol is 1`, `starts and ends with the same symbol` |
| Combinations | `and`, `or`, `but`, `not`, `neither … nor` — e.g. `starts with 0 but does not end with 1` |

Add `over {a,b}` to the question (or fill the Σ box) to set the alphabet. If omitted it is inferred.

Anything the text parser can't handle can be entered in the **Manual builder** tab (fill in the transition table) and still gets the diagram and animation.

## More input styles

* **Regular expressions** — `(a+b)*abb`, `0*10*`, `a(a|b)*b` (`+` or `|` = union, `*` star, `ε` empty string)
* **Set notation** — `{ w ∈ {a,b}* | |w|_a is even }`, `{ a^n b^m | n ≥ 1, m ≥ 0 }`
* **Non-regular languages** (equal numbers of 0s and 1s, aⁿbⁿ, palindromes …) are detected and explained — no DFA exists.

## How it works

* `js/dfa.js` — question parser → spec tree → DFA. Each condition is a small automaton (KMP-style for substrings, counters, modular counters …); `and` / `or` use the **product construction**, `not` uses **complement**, and the result is reduced with **Moore's partition-refinement minimisation**, so the answer is the textbook minimal DFA.
* `js/render.js` — SVG diagram: layered auto-layout, curved collision-avoiding edges, draggable states, SVG/PNG export.
* `js/app.js` — UI and the animation engine.

## Tests

```
node tests/dfa.test.js
```

Every supported question is checked against an independent oracle on **all strings up to length 9**, and state counts are checked against the known minimal sizes.

## Notes

* ε (empty string) is treated as the number 0 for "divisible by" questions, and is rejected for "starts and ends with the same symbol".
* Links can be shared: the question, Σ and test string are stored in the URL hash.
