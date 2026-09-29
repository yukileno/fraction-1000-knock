/**
 * 分数計算および問題生成エンジン (小学5年生対応)
 * UMD形式（ブラウザ直接読み込み・Node.js両対応）
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.FractionEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  // 最大公約数 (GCD)
  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) {
      const t = b;
      b = a % b;
      a = t;
    }
    return a;
  }

  // 最小公倍数 (LCM)
  function lcm(a, b) {
    if (a === 0 || b === 0) return 0;
    return Math.abs(a * b) / gcd(a, b);
  }

  // 分数クラス
  class Fraction {
    constructor(whole = 0, num = 0, den = 1) {
      this.whole = Number(whole) || 0;
      this.num = Number(num) || 0;
      this.den = Number(den) || 1;
      if (this.den === 0) throw new Error("分母は0にできません");
    }

    toImproperNumerator() {
      return this.whole * this.den + this.num;
    }

    valueOf() {
      return this.whole + (this.num / this.den);
    }

    reduce() {
      const totalNum = this.toImproperNumerator();
      if (totalNum === 0) {
        return new Fraction(0, 0, 1);
      }
      const g = gcd(totalNum, this.den);
      const redTotalNum = totalNum / g;
      const redDen = this.den / g;

      const newWhole = Math.floor(redTotalNum / redDen);
      const newNum = redTotalNum % redDen;

      return new Fraction(newWhole, newNum, newNum === 0 ? 1 : redDen);
    }

    isReduced() {
      if (this.num === 0) return true;
      return gcd(this.num, this.den) === 1;
    }

    toString() {
      if (this.num === 0) return `${this.whole}`;
      if (this.whole === 0) return `${this.num}/${this.den}`;
      return `${this.whole}と${this.num}/${this.den}`;
    }
  }

  // 小5で扱いやすい分母の候補ペア
  const DENOMINATOR_PAIRS = [
    [2, 3], [2, 4], [2, 5], [2, 6], [2, 7], [2, 8], [2, 9], [2, 10],
    [3, 4], [3, 5], [3, 6], [3, 9],
    [4, 5], [4, 6], [4, 8], [4, 10],
    [5, 6], [5, 10],
    [6, 8], [6, 9], [6, 10],
    [8, 12], [9, 12]
  ];

  function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function choice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function buildProblemData(frac1, frac2, op, preferReduce, attempts) {
    const commonDen = lcm(frac1.den, frac2.den);
    const mult1 = commonDen / frac1.den;
    const mult2 = commonDen / frac2.den;

    const impNum1 = frac1.toImproperNumerator() * mult1;
    const impNum2 = frac2.toImproperNumerator() * mult2;

    let resImpNum = 0;
    if (op === '+') {
      resImpNum = impNum1 + impNum2;
    } else {
      resImpNum = impNum1 - impNum2;
    }

    if (resImpNum <= 0) return null;

    const g = gcd(resImpNum, commonDen);
    const canReduce = g > 1;

    if (preferReduce && !canReduce && attempts < 80) {
      if (Math.random() < 0.7) {
        return null;
      }
    }

    const redImpNum = resImpNum / g;
    const redDen = commonDen / g;
    const ansWhole = Math.floor(redImpNum / redDen);
    const ansNum = redImpNum % redDen;
    const correctAns = new Fraction(ansWhole, ansNum, ansNum === 0 ? 1 : redDen);

    let hasRegrouping = false;
    if (op === '+') {
      const sumFracNum = frac1.num * mult1 + frac2.num * mult2;
      if (sumFracNum >= commonDen) {
        hasRegrouping = true;
      }
    } else {
      const diffFracNum = frac1.num * mult1 - frac2.num * mult2;
      if (diffFracNum < 0) {
        hasRegrouping = true;
      }
    }

    let category = '';
    const hasMixed = frac1.whole > 0 || frac2.whole > 0;
    if (op === '+') {
      category = hasMixed ? (hasRegrouping ? '帯分数の足し算（繰り上がりあり）' : '帯分数の足し算') : '真分数の足し算';
    } else {
      category = hasMixed ? (hasRegrouping ? '帯分数の引き算（繰り下がりあり）' : '帯分数の引き算') : '真分数の引き算';
    }
    if (canReduce) {
      category += '【約分あり】';
    }

    return {
      frac1,
      frac2,
      op,
      commonDen,
      canReduce,
      hasRegrouping,
      category,
      answer: {
        whole: correctAns.whole,
        num: correctAns.num,
        den: correctAns.den,
        isInteger: correctAns.num === 0,
        isProper: correctAns.whole === 0 && correctAns.num > 0
      },
      unreduced: {
        whole: Math.floor(resImpNum / commonDen),
        num: resImpNum % commonDen,
        den: commonDen
      }
    };
  }

  function generateProblem(options = {}) {
    const {
      mode = 'mix',
      opType = 'all',
      preferReduce = true
    } = options;

    let attempts = 0;
    while (attempts < 100) {
      attempts++;

      const op = opType === 'all' ? (Math.random() < 0.5 ? '+' : '-') : (opType === 'add' ? '+' : '-');

      const pair = choice(DENOMINATOR_PAIRS);
      const swap = Math.random() < 0.5;
      const d1 = swap ? pair[0] : pair[1];
      const d2 = swap ? pair[1] : pair[0];

      let w1 = 0, w2 = 0;
      if (mode === 'mixed_only') {
        const pattern = choice(['both', 'first', 'second']);
        if (pattern === 'both') {
          w1 = getRandomInt(1, 3);
          w2 = getRandomInt(1, 2);
        } else if (pattern === 'first') {
          w1 = getRandomInt(1, 3);
          w2 = 0;
        } else {
          w1 = 0;
          w2 = getRandomInt(1, 2);
        }
      } else if (mode === 'mix') {
        if (Math.random() < 0.65) {
          const pattern = choice(['both', 'first', 'second']);
          if (pattern === 'both') {
            w1 = getRandomInt(1, 2);
            w2 = getRandomInt(1, 2);
          } else if (pattern === 'first') {
            w1 = getRandomInt(1, 3);
            w2 = 0;
          } else {
            w1 = 0;
            w2 = getRandomInt(1, 2);
          }
        }
      }

      const n1 = getRandomInt(1, d1 - 1);
      const n2 = getRandomInt(1, d2 - 1);

      const frac1 = new Fraction(w1, n1, d1);
      const frac2 = new Fraction(w2, n2, d2);

      if (op === '-') {
        if (frac1.valueOf() <= frac2.valueOf()) {
          if (frac2.valueOf() > frac1.valueOf()) {
            const tmpF = frac1;
            if (frac2.valueOf() - tmpF.valueOf() <= 0) continue;
            const prob = buildProblemData(frac2, frac1, op, preferReduce, attempts);
            if (prob) return prob;
            continue;
          } else {
            continue;
          }
        }
      }

      const prob = buildProblemData(frac1, frac2, op, preferReduce, attempts);
      if (prob) return prob;
    }

    // フォールバック
    const f1 = new Fraction(1, 1, 3);
    const f2 = new Fraction(0, 1, 4);
    return buildProblemData(f1, f2, '+', false, 999);
  }

  // =========================================================================
  // スモールステップ出題（段階0〜8）と計測球
  // =========================================================================
  const MAX_LEVEL = 8;
  const LEVEL_LABELS = [
    '同分母・答えが1より小さい',
    '同分母・答えが1以上/帯分数',
    '異分母・真分数・約分なし',
    '異分母・真分数・約分あり',
    '異分母・答えが1をこえる',
    '帯分数・繰り上がり下がりなし・約分なし',
    '帯分数・約分あり',
    '帯分数・繰り上がり下がりあり',
    'ミックス（全単元）'
  ];

  // 分母 d と互いに素な分子（＝最初から約分済みの分数）を選ぶ
  function reducedNumerator(d, min = 1, max = d - 1) {
    const cands = [];
    for (let n = min; n <= max; n++) if (gcd(n, d) === 1) cands.push(n);
    return cands.length ? choice(cands) : null;
  }

  // 引き算は大きい方を先にして問題データを組み立てる
  function buildOrdered(f1, f2, op) {
    if (op === '-' && f1.valueOf() < f2.valueOf()) { const t = f1; f1 = f2; f2 = t; }
    if (op === '-' && f1.valueOf() === f2.valueOf()) return null;
    return buildProblemData(f1, f2, op, false, 999);
  }

  // 段階0・1: 同分母（通分なし・小学4年生レベル）
  function generateSameDenominator(level) {
    for (let i = 0; i < 300; i++) {
      const op = Math.random() < 0.5 ? '+' : '-';
      const d = getRandomInt(3, 10);
      let w1 = 0, w2 = 0, n1, n2;
      if (level === 0) {
        n1 = getRandomInt(1, d - 1);
        n2 = getRandomInt(1, d - 1);
        if (op === '+' && n1 + n2 >= d) continue;         // 答えは1より小さく
      } else if (Math.random() < 0.5) {
        if (op === '-') continue;
        n1 = getRandomInt(1, d - 1);
        n2 = getRandomInt(1, d - 1);
        if (n1 + n2 <= d) continue;                        // 答えが1をこえる（帯分数に直す）
      } else {
        w1 = getRandomInt(1, 2);
        w2 = op === '-' ? getRandomInt(0, w1) : getRandomInt(0, 1);
        n1 = getRandomInt(1, d - 1);
        n2 = getRandomInt(1, d - 1);
        if (op === '+' && n1 + n2 >= d) continue;          // 繰り上がりなし
        if (op === '-' && n1 <= n2) continue;              // 繰り下がりなし
      }
      const prob = buildOrdered(new Fraction(w1, n1, d), new Fraction(w2, n2, d), op);
      if (!prob || prob.canReduce) continue;               // 答えに約分が出ないもの
      prob.category = `同分母の${op === '+' ? '足し算' : '引き算'}${level === 1 ? '（1以上・帯分数）' : ''}`;
      return prob;
    }
    return buildProblemData(new Fraction(0, 1, 5), new Fraction(0, 2, 5), '+', false, 999);
  }

  // 段階2〜7と計測球: 異分母。条件 accept(prob, w1, w2) を満たすまで生成
  function generateDifferentDenominator(wholePattern, accept) {
    for (let i = 0; i < 2000; i++) {
      const op = Math.random() < 0.5 ? '+' : '-';
      const pair = choice(DENOMINATOR_PAIRS);
      const swap = Math.random() < 0.5;
      const d1 = swap ? pair[0] : pair[1];
      const d2 = swap ? pair[1] : pair[0];
      const n1 = reducedNumerator(d1);
      const n2 = reducedNumerator(d2);
      if (!n1 || !n2) continue;
      const [w1, w2] = wholePattern();
      const prob = buildOrdered(new Fraction(w1, n1, d1), new Fraction(w2, n2, d2), op);
      if (prob && accept(prob)) return prob;
    }
    return null;
  }

  const noWhole = () => [0, 0];
  const someWhole = () => choice([[getRandomInt(1, 2), 0], [0, getRandomInt(1, 2)], [getRandomInt(1, 2), getRandomInt(1, 2)]]);
  const hasMixed = (p) => p.frac1.whole > 0 || p.frac2.whole > 0;

  function generateLeveledProblem(level) {
    level = Math.max(0, Math.min(MAX_LEVEL, Number(level) || 0));
    let prob = null;
    if (level <= 1) {
      prob = generateSameDenominator(level);
    } else if (level === 2) {
      prob = generateDifferentDenominator(noWhole, p => !p.canReduce && p.answer.whole === 0);
    } else if (level === 3) {
      prob = generateDifferentDenominator(noWhole, p => p.canReduce && p.answer.whole === 0);
    } else if (level === 4) {
      prob = generateDifferentDenominator(noWhole, p => p.op === '+' && p.answer.whole >= 1);
    } else if (level === 5) {
      prob = generateDifferentDenominator(someWhole, p => hasMixed(p) && !p.hasRegrouping && !p.canReduce);
    } else if (level === 6) {
      prob = generateDifferentDenominator(someWhole, p => hasMixed(p) && !p.hasRegrouping && p.canReduce);
    } else if (level === 7) {
      prob = generateDifferentDenominator(someWhole, p => hasMixed(p) && p.hasRegrouping);
    }
    if (!prob) prob = generateProblem({ mode: 'mix' }); // 段階8、または生成できなかった場合
    prob.level = level;
    prob.kind = 'practice';
    return prob;
  }

  // 計測球: 全員共通・難しさ固定（帯分数の引き算・約分あり・繰り下がりなし。第1期の1発正解率 約67%）
  function generateProbeProblem() {
    const prob = generateDifferentDenominator(
      () => [getRandomInt(1, 3), getRandomInt(0, 1)],
      p => p.op === '-' && p.frac1.whole > 0 && !p.hasRegrouping && p.canReduce
    ) || generateProblem({ mode: 'mix' });
    prob.kind = 'probe';
    return prob;
  }

  function checkAnswer(inputOrProblem, problemOrWhole, numArg, denArg) {
    let input = {};
    let problemData = null;

    if (inputOrProblem && inputOrProblem.answer) {
      // パターンB: checkAnswer(problemData, whole, num, den)
      problemData = inputOrProblem;
      input = {
        whole: problemOrWhole,
        num: numArg,
        den: denArg
      };
    } else {
      // パターンA: checkAnswer({ whole, num, den }, problemData)
      input = inputOrProblem || {};
      problemData = problemOrWhole;
    }

    if (!problemData || !problemData.answer) {
      return {
        isCorrect: false,
        status: 'error',
        message: '問題データの照合エラー'
      };
    }

    const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
    const numBlank = isBlank(input.num);
    const denBlank = isBlank(input.den);

    // 分子だけ・分母だけの入力や分母0は、分母1として扱わず入力やり直しにする
    if (!numBlank && Number(input.num) > 0 && (denBlank || !(Number(input.den) > 0))) {
      return {
        isCorrect: false,
        status: 'invalid',
        message: '分母（下の数字）を正しく入力してね'
      };
    }
    if (numBlank && !denBlank) {
      return {
        isCorrect: false,
        status: 'invalid',
        message: '分子（上の数字）も入力してね'
      };
    }

    const inWhole = Number(input.whole) || 0;
    const inNum = Number(input.num) || 0;
    const inDen = Number(input.den) || 1;

    const ans = problemData.answer;

    if (ans.isInteger) {
      // 整数として入力された場合（例: 1）
      if (inWhole === ans.whole && inNum === 0) {
        return { isCorrect: true, status: 'correct', message: '大正解！すばらしい！' };
      }

      // ユーザー要望対応: 答えが1のときに 1/1 とした場合（分母1の仮分数）も正解とする
      if (inWhole === 0 && inNum === ans.whole && inDen === 1) {
        return {
          isCorrect: true,
          status: 'correct',
          message: `大正解！すばらしい！✨（整数の ${ans.whole} でも正解だよ）`
        };
      }

      // 整数＋分母1（例: 1と0/1）
      if (inWhole === ans.whole && inNum === 0 && inDen === 1) {
        return { isCorrect: true, status: 'correct', message: '大正解！すばらしい！' };
      }

      const inTotal = inWhole * inDen + inNum;
      if (inTotal === ans.whole * inDen && inDen > 1) {
        return {
          isCorrect: false,
          status: 'unreduced',
          message: '約分して整数になおせるよ！'
        };
      }
      return { isCorrect: false, status: 'wrong', message: 'ちがうよ、もう一度計算してみよう！' };
    }

    const inputTotalNum = inWhole * inDen + inNum;
    const correctTotalNum = ans.whole * ans.den + ans.num;
    const isValueEqual = (inputTotalNum * ans.den === correctTotalNum * inDen);

    if (!isValueEqual) {
      return {
        isCorrect: false,
        status: 'wrong',
        message: 'おしい！もう一度計算を見直してみよう'
      };
    }

    // 正解の既約な仮分数（分子と分母）
    const correctImpNum = ans.whole * ans.den + ans.num;
    const correctImpDen = ans.den;

    // パターン1: 既約な帯分数として入力された場合
    if (inWhole === ans.whole && inNum === ans.num && inDen === ans.den) {
      return {
        isCorrect: true,
        status: 'correct',
        message: '大正解！バッチリだね！✨'
      };
    }

    // パターン2: 既約な仮分数として入力された場合 (例: 1と2/3 に対する 5/3)
    if (inWhole === 0 && inNum === correctImpNum && inDen === correctImpDen) {
      const hint = ans.whole > 0 ? `（帯分数なら ${ans.whole}と${ans.num}/${ans.den} だね）` : '';
      return {
        isCorrect: true,
        status: 'correct',
        message: `大正解！仮分数でもバッチリ！✨${hint}`
      };
    }

    // パターン3: 整数部があるのに分数部が仮分数になっている場合 (例: 1と5/3 など)
    if (inWhole > 0 && inNum >= inDen && inDen > 1) {
      return {
        isCorrect: false,
        status: 'improper',
        message: '分数の上の数字が大きくなっているよ！整数に繰り上げよう'
      };
    }

    // パターン4: 約分がまだできる場合 (値は合っているが既約でない)
    return {
      isCorrect: false,
      status: 'unreduced',
      message: 'まだ約分できるよ！できるだけ小さく約分しよう'
    };
  }

  return {
    gcd,
    lcm,
    Fraction,
    generateProblem,
    generateLeveledProblem,
    generateProbeProblem,
    MAX_LEVEL,
    LEVEL_LABELS,
    checkAnswer
  };
});
