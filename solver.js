/**
 * Wordle Solver Engine — H2H competition-optimized
 *
 * Two-stage decision: attempt-safe frontier + tiebreaker reranking.
 *
 * H2H scoring: 1) fewer attempts, 2) more greens, 3) more oranges.
 * The solver uses expectedRemaining as the primary metric to minimize
 * attempts, then reranks the near-optimal frontier by solveProb,
 * expectedGreens, expectedOranges, and answer-pool membership.
 *
 * Pattern encoding: each position is 0 (absent), 1 (present/misplaced), 2 (correct).
 * A pattern is encoded as a base-3 number: p0*1 + p1*3 + p2*9 + p3*27 + p4*81
 * giving values 0..242 (243 total patterns).
 */

class WordleSolver {
    constructor(answerWords, validWords) {
        this.answerWords = answerWords;           // words that can be the answer
        this.allGuessWords = validWords;           // all valid guess words (superset)
        this.remainingAnswers = [...answerWords];
        this.guessHistory = [];                    // [{word, pattern}]
        this.hardMode = false;
        this.jackpotMode = false;                  // first guess from answer pool only
        this.wordFrequencies = {};                 // {word: timesAppeared}
        this.totalGamesPlayed = 0;

        this._precomputePatternCache();
    }

    _precomputePatternCache() {
        this.answerCodes = this.answerWords.map(w => this._wordToCodes(w));
        this.guessCodes = this.allGuessWords.map(w => this._wordToCodes(w));
    }

    _wordToCodes(word) {
        return [word.charCodeAt(0), word.charCodeAt(1), word.charCodeAt(2),
                word.charCodeAt(3), word.charCodeAt(4)];
    }

    /**
     * Set word frequency map from game history.
     * Words with higher frequency get a small boost since the game does repeat words.
     * @param {Object} freqMap - {word: count} e.g. {"mince": 2, "crown": 2, "crane": 1}
     */
    setWordFrequencies(freqMap) {
        this.wordFrequencies = {};
        for (const [w, count] of Object.entries(freqMap)) {
            this.wordFrequencies[w.toLowerCase()] = count;
        }
        this.totalGamesPlayed = Object.values(this.wordFrequencies).reduce((a, b) => a + b, 0);
    }

    /**
     * Compute the feedback pattern for a guess against an answer.
     * Returns a number 0-242 encoding the pattern.
     */
    computePattern(guess, answer) {
        const result = [0, 0, 0, 0, 0];
        const answerUsed = [false, false, false, false, false];
        const guessUsed = [false, false, false, false, false];

        for (let i = 0; i < 5; i++) {
            if (guess[i] === answer[i]) {
                result[i] = 2;
                answerUsed[i] = true;
                guessUsed[i] = true;
            }
        }

        for (let i = 0; i < 5; i++) {
            if (guessUsed[i]) continue;
            for (let j = 0; j < 5; j++) {
                if (answerUsed[j]) continue;
                if (guess[i] === answer[j]) {
                    result[i] = 1;
                    answerUsed[j] = true;
                    break;
                }
            }
        }

        return result[0] + result[1] * 3 + result[2] * 9 + result[3] * 27 + result[4] * 81;
    }

    /**
     * Fast pattern computation using char codes
     */
    computePatternFast(guessCodes, answerCodes) {
        let r0 = 0, r1 = 0, r2 = 0, r3 = 0, r4 = 0;
        let au0 = 0, au1 = 0, au2 = 0, au3 = 0, au4 = 0;
        let gu0 = 0, gu1 = 0, gu2 = 0, gu3 = 0, gu4 = 0;

        const g0 = guessCodes[0], g1 = guessCodes[1], g2 = guessCodes[2],
              g3 = guessCodes[3], g4 = guessCodes[4];
        const a0 = answerCodes[0], a1 = answerCodes[1], a2 = answerCodes[2],
              a3 = answerCodes[3], a4 = answerCodes[4];

        if (g0 === a0) { r0 = 2; au0 = 1; gu0 = 1; }
        if (g1 === a1) { r1 = 2; au1 = 1; gu1 = 1; }
        if (g2 === a2) { r2 = 2; au2 = 1; gu2 = 1; }
        if (g3 === a3) { r3 = 2; au3 = 1; gu3 = 1; }
        if (g4 === a4) { r4 = 2; au4 = 1; gu4 = 1; }

        if (!gu0) {
            if (!au0 && g0 === a0) { r0 = 1; au0 = 1; }
            else if (!au1 && g0 === a1) { r0 = 1; au1 = 1; }
            else if (!au2 && g0 === a2) { r0 = 1; au2 = 1; }
            else if (!au3 && g0 === a3) { r0 = 1; au3 = 1; }
            else if (!au4 && g0 === a4) { r0 = 1; au4 = 1; }
        }
        if (!gu1) {
            if (!au0 && g1 === a0) { r1 = 1; au0 = 1; }
            else if (!au1 && g1 === a1) { r1 = 1; au1 = 1; }
            else if (!au2 && g1 === a2) { r1 = 1; au2 = 1; }
            else if (!au3 && g1 === a3) { r1 = 1; au3 = 1; }
            else if (!au4 && g1 === a4) { r1 = 1; au4 = 1; }
        }
        if (!gu2) {
            if (!au0 && g2 === a0) { r2 = 1; au0 = 1; }
            else if (!au1 && g2 === a1) { r2 = 1; au1 = 1; }
            else if (!au2 && g2 === a2) { r2 = 1; au2 = 1; }
            else if (!au3 && g2 === a3) { r2 = 1; au3 = 1; }
            else if (!au4 && g2 === a4) { r2 = 1; au4 = 1; }
        }
        if (!gu3) {
            if (!au0 && g3 === a0) { r3 = 1; au0 = 1; }
            else if (!au1 && g3 === a1) { r3 = 1; au1 = 1; }
            else if (!au2 && g3 === a2) { r3 = 1; au2 = 1; }
            else if (!au3 && g3 === a3) { r3 = 1; au3 = 1; }
            else if (!au4 && g3 === a4) { r3 = 1; au4 = 1; }
        }
        if (!gu4) {
            if (!au0 && g4 === a0) { r4 = 1; au0 = 1; }
            else if (!au1 && g4 === a1) { r4 = 1; au1 = 1; }
            else if (!au2 && g4 === a2) { r4 = 1; au2 = 1; }
            else if (!au3 && g4 === a3) { r4 = 1; au3 = 1; }
            else if (!au4 && g4 === a4) { r4 = 1; au4 = 1; }
        }

        return r0 + r1 * 3 + r2 * 9 + r3 * 27 + r4 * 81;
    }

    decodePattern(patternNum) {
        const result = [];
        let p = patternNum;
        for (let i = 0; i < 5; i++) {
            result.push(p % 3);
            p = Math.floor(p / 3);
        }
        return result;
    }

    encodePattern(pattern) {
        return pattern[0] + pattern[1] * 3 + pattern[2] * 9 + pattern[3] * 27 + pattern[4] * 81;
    }

    /**
     * Compute entropy for a guess word against the current remaining answers.
     * Kept for backward compatibility / reporting.
     */
    computeEntropy(guessCodes, remainingCodes) {
        const n = remainingCodes.length;
        if (n <= 1) return 0;

        const buckets = new Int32Array(243);
        for (let i = 0; i < n; i++) {
            const pattern = this.computePatternFast(guessCodes, remainingCodes[i]);
            buckets[pattern]++;
        }

        let entropy = 0;
        for (let i = 0; i < 243; i++) {
            const count = buckets[i];
            if (count > 0) {
                const p = count / n;
                entropy -= p * Math.log2(p);
            }
        }

        return entropy;
    }

    /**
     * Compute expected green and orange tiles separately for a guess against remaining answers.
     * Kept for backward compatibility.
     */
    computeExpectedTiles(guessCodes, remainingCodes) {
        const n = remainingCodes.length;
        if (n === 0) return { greens: 0, oranges: 0 };

        let totalGreens = 0;
        let totalOranges = 0;
        for (let i = 0; i < n; i++) {
            const pattern = this.computePatternFast(guessCodes, remainingCodes[i]);
            let p = pattern;
            for (let j = 0; j < 5; j++) {
                const v = p % 3;
                if (v === 2) totalGreens++;
                else if (v === 1) totalOranges++;
                p = Math.floor(p / 3);
            }
        }

        return { greens: totalGreens / n, oranges: totalOranges / n };
    }

    /**
     * Compute all H2H-relevant stats for a guess in a single pass.
     * Returns: entropy, expectedRemaining, solveProb, expectedGreens, expectedOranges
     */
    computeGuessStats(guessCodes, remainingCodes) {
        const n = remainingCodes.length;
        if (n === 0) return { entropy: 0, expectedRemaining: 0, solveProb: 0, expectedGreens: 0, expectedOranges: 0 };

        const buckets = new Int32Array(243);
        let greenSum = 0;
        let orangeSum = 0;
        let solveCount = 0;

        for (let i = 0; i < n; i++) {
            const p = this.computePatternFast(guessCodes, remainingCodes[i]);
            buckets[p]++;

            if (p === 242) solveCount++;

            let x = p;
            for (let k = 0; k < 5; k++) {
                const d = x % 3;
                if (d === 2) greenSum++;
                else if (d === 1) orangeSum++;
                x = (x / 3) | 0;
            }
        }

        let entropy = 0;
        let expectedRemaining = 0;

        for (let i = 0; i < 243; i++) {
            const c = buckets[i];
            if (!c) continue;

            const prob = c / n;
            entropy -= prob * Math.log2(prob);
            expectedRemaining += prob * c;  // sum(c^2)/n
        }

        return {
            entropy,
            expectedRemaining,
            solveProb: solveCount / n,
            expectedGreens: greenSum / n,
            expectedOranges: orangeSum / n
        };
    }

    /**
     * Get set of confirmed green positions from guess history.
     * Returns array of [position, charCode] pairs.
     */
    _getConfirmedGreens() {
        if (this._confirmedGreensCache) return this._confirmedGreensCache;
        const greens = [];
        const seen = new Set();
        for (const { word, pattern } of this.guessHistory) {
            for (let i = 0; i < 5; i++) {
                if (pattern[i] === 2 && !seen.has(i)) {
                    greens.push([i, word.charCodeAt(i)]);
                    seen.add(i);
                }
            }
        }
        this._confirmedGreensCache = greens;
        return greens;
    }

    /**
     * H2H-optimized guess selection using two-stage frontier approach.
     *
     * Stage 1: Build an attempt-safe frontier — keep only guesses within
     *          epsilon of the best expectedRemaining (lower = fewer attempts).
     * Stage 2: Rerank the frontier by tiebreaker value:
     *          solveProb > expectedGreens > expectedOranges > isAnswer > entropy
     *
     * Epsilon is state-dependent: tight when pool is large (attempts matter most),
     * looser when pool is small (tiles matter more because attempts converge).
     */
    getBestGuess() {
        const remaining = this.remainingAnswers;
        const n = remaining.length;

        if (n === 0) return null;
        if (n === 1) return remaining[0];

        const remainingCodes = remaining.map(w => this._wordToCodes(w));
        const remainingSet = new Set(remaining);

        const startTime = performance.now();

        // Clear cached confirmed greens for this computation
        this._confirmedGreensCache = null;

        // First guess handling
        if (this.guessHistory.length === 0) {
            if (this.jackpotMode) {
                return this._computeBestFirstGuessFromAnswers(remainingCodes, remainingSet, startTime);
            }
            this._lastComputeTime = 0;
            this._lastEntropy = 5.86;
            this._lastJackpotChance = 0;
            return 'slate';
        }

        // For n=2, pick the answer with more expected greens (for tiebreaker farming)
        if (n === 2) {
            const stats0 = this.computeGuessStats(this._wordToCodes(remaining[0]), remainingCodes);
            const stats1 = this.computeGuessStats(this._wordToCodes(remaining[1]), remainingCodes);
            // Both solve with prob 0.5, so pick by greens then oranges
            const pick = (stats0.expectedGreens > stats1.expectedGreens ||
                         (stats0.expectedGreens === stats1.expectedGreens &&
                          stats0.expectedOranges >= stats1.expectedOranges))
                ? remaining[0] : remaining[1];
            this._lastComputeTime = performance.now() - startTime;
            this._lastEntropy = Math.max(stats0.entropy, stats1.entropy);
            this._lastJackpotChance = null;
            return pick;
        }

        // Use answer-list words only as guess candidates.
        // Answer words use common letters in common positions, matching what
        // strong human players do. The full 14k guess list picks obscure words
        // (rimon, porno, pronk, womby) that waste attempts.
        let candidateWords = this.answerWords;
        let candidateCodes = this.answerCodes;

        // State-dependent epsilon for frontier width
        // Large pool: tight frontier (attempts dominate H2H outcomes)
        // Small pool: wider frontier (attempts converge, tiles decide)
        let epsilon;
        if (n > 100) {
            epsilon = 1.02;     // 2% tolerance — very tight, protect attempts
        } else if (n > 20) {
            epsilon = 1.05;     // 5% tolerance — start allowing tile-rich picks
        } else if (n > 5) {
            epsilon = 1.10;     // 10% tolerance — tiles are decisive here
        } else {
            epsilon = 1.20;     // 20% tolerance — very small pool, farm tiles aggressively
        }

        // Compute stats for all candidates
        const allStats = new Array(candidateWords.length);
        let bestExpRemaining = Infinity;

        for (let i = 0; i < candidateWords.length; i++) {
            const stats = this.computeGuessStats(candidateCodes[i], remainingCodes);
            const isAnswer = remainingSet.has(candidateWords[i]) ? 1 : 0;
            allStats[i] = {
                idx: i,
                word: candidateWords[i],
                expectedRemaining: stats.expectedRemaining,
                entropy: stats.entropy,
                solveProb: stats.solveProb,
                expectedGreens: stats.expectedGreens,
                expectedOranges: stats.expectedOranges,
                isAnswer
            };

            if (stats.expectedRemaining < bestExpRemaining) {
                bestExpRemaining = stats.expectedRemaining;
            }
        }

        // Stage 1: Build attempt-safe frontier
        const frontierThreshold = bestExpRemaining * epsilon;
        const frontier = [];
        for (let i = 0; i < allStats.length; i++) {
            if (allStats[i].expectedRemaining <= frontierThreshold) {
                frontier.push(allStats[i]);
            }
        }

        // Stage 2: Rerank frontier by H2H tiebreaker value
        // Priority: solveProb (finish fast) > greens > oranges > isAnswer > entropy
        frontier.sort((a, b) => {
            // 1. Solve probability — finishing this turn is always best for attempts
            const solveDiff = b.solveProb - a.solveProb;
            if (Math.abs(solveDiff) > 1e-9) return solveDiff;

            // 2. Expected greens — first H2H tiebreaker
            const greenDiff = b.expectedGreens - a.expectedGreens;
            if (Math.abs(greenDiff) > 1e-9) return greenDiff;

            // 3. Expected oranges — second H2H tiebreaker
            const orangeDiff = b.expectedOranges - a.expectedOranges;
            if (Math.abs(orangeDiff) > 1e-9) return orangeDiff;

            // 4. Prefer answer-pool words (can solve AND produce greens)
            if (a.isAnswer !== b.isAnswer) return b.isAnswer - a.isAnswer;

            // 5. Lower expectedRemaining (tighter solve)
            const remDiff = a.expectedRemaining - b.expectedRemaining;
            if (Math.abs(remDiff) > 1e-9) return remDiff;

            // 6. Higher entropy as final tiebreaker
            return b.entropy - a.entropy;
        });

        const best = frontier[0];

        this._lastComputeTime = performance.now() - startTime;
        this._lastEntropy = best.entropy;
        this._lastJackpotChance = null;

        return best.word;
    }

    /**
     * Compute best first guess restricted to answer pool words.
     * Uses frontier approach: near-best expectedRemaining, rerank by tiles.
     */
    _computeBestFirstGuessFromAnswers(remainingCodes, remainingSet, startTime) {
        const n = remainingCodes.length;

        const scored = [];
        let bestExpRemaining = Infinity;

        for (let i = 0; i < this.answerWords.length; i++) {
            const word = this.answerWords[i];
            const codes = this.answerCodes[i];

            const stats = this.computeGuessStats(codes, remainingCodes);

            if (stats.expectedRemaining < bestExpRemaining) {
                bestExpRemaining = stats.expectedRemaining;
            }

            scored.push({
                word,
                expectedRemaining: stats.expectedRemaining,
                entropy: stats.entropy,
                solveProb: stats.solveProb,
                expectedGreens: stats.expectedGreens,
                expectedOranges: stats.expectedOranges
            });
        }

        // Frontier: within 3% of best expectedRemaining (tight for opener)
        const threshold = bestExpRemaining * 1.03;
        const frontier = scored.filter(s => s.expectedRemaining <= threshold);

        // Rerank by H2H value
        frontier.sort((a, b) => {
            const solveDiff = b.solveProb - a.solveProb;
            if (Math.abs(solveDiff) > 1e-9) return solveDiff;

            const greenDiff = b.expectedGreens - a.expectedGreens;
            if (Math.abs(greenDiff) > 1e-9) return greenDiff;

            const orangeDiff = b.expectedOranges - a.expectedOranges;
            if (Math.abs(orangeDiff) > 1e-9) return orangeDiff;

            return a.expectedRemaining - b.expectedRemaining;
        });

        // Pick randomly from top 5 candidates for coverage
        const topN = Math.min(5, frontier.length);
        const pick = frontier[Math.floor(Math.random() * topN)];

        this._lastComputeTime = performance.now() - startTime;
        this._lastEntropy = pick.entropy;
        this._lastJackpotChance = n > 0 ? (1 / n) : 0;

        return pick.word;
    }

    applyGuess(word, pattern) {
        this.guessHistory.push({ word, pattern: [...pattern] });
        this._confirmedGreensCache = null; // invalidate cache

        this.remainingAnswers = this.remainingAnswers.filter(answer => {
            const expectedPattern = this.computePattern(word, answer);
            const givenPattern = this.encodePattern(pattern);
            return expectedPattern === givenPattern;
        });
    }

    reset() {
        this.remainingAnswers = [...this.answerWords];
        this.guessHistory = [];
        this._confirmedGreensCache = null;
    }

    isValidGuess(word) {
        return this.allGuessWords.includes(word.toLowerCase());
    }

    getHistory() {
        return this.guessHistory.map(g => ({
            word: g.word,
            pattern: g.pattern
        }));
    }
}
