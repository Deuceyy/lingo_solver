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
        this.usedWords = new Set();                // previously seen answer words (deprioritized)

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
     * Set previously-seen answer words. These stay in the pool but are
     * deprioritized for jackpot first-guess selection since repeats are rare.
     */
    setUsedWords(words) {
        this.usedWords = new Set(words.map(w => w.toLowerCase()));
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
     * Compute expected colored tiles (greens + yellows) for a guess against remaining answers.
     * Used as tiebreaker — more colored tiles = better score in competition.
     * Greens weighted 1.5x since they're the first tiebreaker, yellows 1x.
     */
    computeExpectedColoredTiles(guessCodes, remainingCodes) {
        const n = remainingCodes.length;
        if (n === 0) return 0;

        let totalColored = 0;
        for (let i = 0; i < n; i++) {
            const pattern = this.computePatternFast(guessCodes, remainingCodes[i]);
            let p = pattern;
            for (let j = 0; j < 5; j++) {
                const v = p % 3;
                if (v === 2) totalColored += 1.5; // greens worth more (first tiebreaker)
                else if (v === 1) totalColored += 1; // yellows (second tiebreaker)
                p = Math.floor(p / 3);
            }
        }

        return totalColored / n;
    }

    /**
     * Get the best guess using entropy maximization.
     *
     * Scoring for competition optimization:
     * - Primary: entropy (solve fast = fewer attempts)
     * - Secondary: prefer possible answers (can win outright)
     * - Tertiary: expected colored tiles (green/yellow tiebreaker)
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

        // First guess handling
        if (this.guessHistory.length === 0) {
            if (this.jackpotMode) {
                // Jackpot mode: best first guess from answer pool only (can hit jackpot)
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

        let bestWord = null;
        let bestScore = -Infinity;

        const answerBonus = 0.02;
        const tileBonus = 0.001;
        // Deprioritize used words in answer selection — they're unlikely repeats
        const usedPenalty = 0.005;

        for (let i = 0; i < candidateWords.length; i++) {
            const word = candidateWords[i];
            const codes = candidateCodes[i];

            let score = this.computeEntropy(codes, remainingCodes);

            if (remainingSet.has(word)) {
                score += answerBonus;
                // Deprioritize previously-used answers (unlikely repeats)
                if (this.usedWords.has(word)) {
                    score -= usedPenalty;
                }
            }

            const coloredTiles = this.computeExpectedColoredTiles(codes, remainingCodes);
            score += coloredTiles * tileBonus;

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

        const answerBonus = 0.02;
        const tileBonus = 0.001;

        // Score all answer-pool words
        const scored = [];
        for (let i = 0; i < this.answerWords.length; i++) {
            const word = this.answerWords[i];
            const codes = this.answerCodes[i];

            let score = this.computeEntropy(codes, remainingCodes);

            if (remainingSet.has(word)) {
                score += answerBonus;
            }

            const coloredTiles = this.computeExpectedColoredTiles(codes, remainingCodes);
            score += coloredTiles * tileBonus;

            scored.push({ word, score, used: this.usedWords.has(word) });
        }

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        // Pick from top candidates within 0.05 bits of best (negligible solve-speed difference)
        const topScore = scored[0].score;
        const threshold = topScore - 0.05;
        const topCandidates = scored.filter(s => s.score >= threshold);

        // Filter to unused words if possible (unused = never been an answer before)
        const unusedCandidates = topCandidates.filter(s => !s.used);
        const pool = unusedCandidates.length > 0 ? unusedCandidates : topCandidates;

        // Random pick from the pool
        const pick = pool[Math.floor(Math.random() * pool.length)];

        const unusedCount = this.answerWords.filter(w => !this.usedWords.has(w)).length;
        this._lastComputeTime = performance.now() - startTime;
        this._lastEntropy = pick.score;
        this._lastJackpotChance = unusedCount > 0 ? (1 / unusedCount) : (1 / n);

        return pick.word;
    }

    applyGuess(word, pattern) {
        this.guessHistory.push({ word, pattern: [...pattern] });

        this.remainingAnswers = this.remainingAnswers.filter(answer => {
            const expectedPattern = this.computePattern(word, answer);
            const givenPattern = this.encodePattern(pattern);
            return expectedPattern === givenPattern;
        });
    }

    reset() {
        this.remainingAnswers = [...this.answerWords];
        this.guessHistory = [];
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
