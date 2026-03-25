/**
 * Wordle Solver Engine — Entropy-based information-theoretic approach
 *
 * For each candidate guess, we compute the distribution of all 243 possible
 * feedback patterns (3^5) against the remaining answer pool. The guess with
 * the highest Shannon entropy (most evenly-distributed partitions) is optimal
 * because it maximally reduces uncertainty on average.
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
        this.wordFrequencies = {};                 // {word: timesAppeared} — boosts repeat words
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
     * In competition, tiebreakers are: 1) more greens, 2) more oranges — they're separate.
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
     * Get the best guess using entropy maximization with competition-aware tiebreaking.
     *
     * Competition tiebreaker order:
     *   1. Fewer attempts (entropy maximization)
     *   2. More green tiles across all guesses
     *   3. More orange tiles across all guesses
     *
     * Strategy: among words with similar entropy, aggressively prefer those that
     * produce more greens/oranges AND preserve confirmed green positions.
     */
    getBestGuess() {
        const remaining = this.remainingAnswers;
        const n = remaining.length;

        if (n === 0) return null;
        if (n === 1) return remaining[0];
        if (n === 2) return remaining[0];

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
            this._lastEntropy = 5.89;
            this._lastJackpotChance = 0;
            return 'salet';
        }

        let candidateWords;
        let candidateCodes;

        if (n === 2) {
            candidateWords = remaining;
            candidateCodes = remainingCodes;
        } else {
            candidateWords = this.allGuessWords;
            candidateCodes = this.guessCodes;
        }

        // Adaptive bonuses — tile optimization matters more as pool shrinks
        // (when pool is small, many words have similar entropy)
        const answerBonus = n <= 20 ? 0.08 : 0.04;   // strongly prefer answer-pool words
        const greenBonus  = n <= 20 ? 0.015 : 0.008;  // greens = first tiebreaker
        const orangeBonus = n <= 20 ? 0.005 : 0.003;  // oranges = second tiebreaker
        const freqBonus = 0.003;

        // Bonus for preserving confirmed green positions in the guess
        // This ensures we don't "waste" known greens by picking words without them
        const confirmedGreens = this._getConfirmedGreens();
        const greenPreserveBonus = 0.02;

        let bestWord = null;
        let bestScore = -Infinity;

        for (let i = 0; i < candidateWords.length; i++) {
            const word = candidateWords[i];
            const codes = candidateCodes[i];

            let score = this.computeEntropy(codes, remainingCodes);

            if (remainingSet.has(word)) {
                score += answerBonus;
                const freq = this.wordFrequencies[word] || 0;
                if (freq > 0 && this.totalGamesPlayed > 0) {
                    score += freq * freqBonus;
                }
            }

            // Separate green and orange tile scoring (they're separate tiebreakers)
            const tiles = this.computeExpectedTiles(codes, remainingCodes);
            score += tiles.greens * greenBonus;
            score += tiles.oranges * orangeBonus;

            // Bonus for preserving already-confirmed green positions
            if (confirmedGreens.length > 0) {
                let preserved = 0;
                for (const [pos, charCode] of confirmedGreens) {
                    if (codes[pos] === charCode) preserved++;
                }
                score += preserved * greenPreserveBonus;
            }

            if (score > bestScore) {
                bestScore = score;
                bestWord = word;
            }
        }

        this._lastComputeTime = performance.now() - startTime;
        this._lastEntropy = bestScore;
        this._lastJackpotChance = null;

        return bestWord;
    }

    /**
     * Compute best first guess restricted to answer pool words.
     * Gives jackpot chance while still maximizing entropy.
     * Deprioritizes previously-used words (they're unlikely repeats).
     */
    _computeBestFirstGuessFromAnswers(remainingCodes, remainingSet, startTime) {
        const n = remainingCodes.length;

        const answerBonus = 0.04;
        const greenBonus = 0.008;
        const orangeBonus = 0.003;
        const freqBonus = 0.003;

        // Score all answer-pool words
        const scored = [];
        for (let i = 0; i < this.answerWords.length; i++) {
            const word = this.answerWords[i];
            const codes = this.answerCodes[i];

            let score = this.computeEntropy(codes, remainingCodes);

            if (remainingSet.has(word)) {
                score += answerBonus;
            }

            // Boost words seen before — game repeats words
            const freq = this.wordFrequencies[word] || 0;
            if (freq > 0 && this.totalGamesPlayed > 0) {
                score += freq * freqBonus;
            }

            const tiles = this.computeExpectedTiles(codes, remainingCodes);
            score += tiles.greens * greenBonus;
            score += tiles.oranges * orangeBonus;

            scored.push({ word, score });
        }

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        // Pick from top candidates within 0.05 bits of best (negligible solve-speed difference)
        const topScore = scored[0].score;
        const threshold = topScore - 0.05;
        const topCandidates = scored.filter(s => s.score >= threshold);

        // Random pick from the pool
        const pick = topCandidates[Math.floor(Math.random() * topCandidates.length)];

        this._lastComputeTime = performance.now() - startTime;
        this._lastEntropy = pick.score;
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
