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
        this.answerWords = answerWords;       // words that can be the answer
        this.allGuessWords = validWords;       // all valid guess words (superset)
        this.remainingAnswers = [...answerWords];
        this.guessHistory = [];                // [{word, pattern}]
        this.hardMode = false;

        // Precompute letter-position maps for answer words for fast filtering
        this._precomputePatternCache();
    }

    _precomputePatternCache() {
        // Convert words to char code arrays for faster pattern computation
        this.answerCodes = this.answerWords.map(w => this._wordToCodes(w));
        this.guessCodes = this.allGuessWords.map(w => this._wordToCodes(w));
    }

    _wordToCodes(word) {
        return [word.charCodeAt(0), word.charCodeAt(1), word.charCodeAt(2),
                word.charCodeAt(3), word.charCodeAt(4)];
    }

    /**
     * Compute the feedback pattern for a guess against an answer.
     * Returns a number 0-242 encoding the pattern.
     *
     * Algorithm handles duplicate letters correctly:
     * 1. First pass: mark exact matches (correct/green)
     * 2. Second pass: mark misplaced (present/yellow), respecting letter counts
     */
    computePattern(guess, answer) {
        const result = [0, 0, 0, 0, 0];
        const answerUsed = [false, false, false, false, false];
        const guessUsed = [false, false, false, false, false];

        // Pass 1: exact matches
        for (let i = 0; i < 5; i++) {
            if (guess[i] === answer[i]) {
                result[i] = 2;
                answerUsed[i] = true;
                guessUsed[i] = true;
            }
        }

        // Pass 2: misplaced letters
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
        let au0 = 0, au1 = 0, au2 = 0, au3 = 0, au4 = 0; // answer used flags
        let gu0 = 0, gu1 = 0, gu2 = 0, gu3 = 0, gu4 = 0; // guess used flags

        const g0 = guessCodes[0], g1 = guessCodes[1], g2 = guessCodes[2],
              g3 = guessCodes[3], g4 = guessCodes[4];
        const a0 = answerCodes[0], a1 = answerCodes[1], a2 = answerCodes[2],
              a3 = answerCodes[3], a4 = answerCodes[4];

        // Exact matches
        if (g0 === a0) { r0 = 2; au0 = 1; gu0 = 1; }
        if (g1 === a1) { r1 = 2; au1 = 1; gu1 = 1; }
        if (g2 === a2) { r2 = 2; au2 = 1; gu2 = 1; }
        if (g3 === a3) { r3 = 2; au3 = 1; gu3 = 1; }
        if (g4 === a4) { r4 = 2; au4 = 1; gu4 = 1; }

        // Misplaced - position 0
        if (!gu0) {
            if (!au0 && g0 === a0) { r0 = 1; au0 = 1; }
            else if (!au1 && g0 === a1) { r0 = 1; au1 = 1; }
            else if (!au2 && g0 === a2) { r0 = 1; au2 = 1; }
            else if (!au3 && g0 === a3) { r0 = 1; au3 = 1; }
            else if (!au4 && g0 === a4) { r0 = 1; au4 = 1; }
        }
        // Misplaced - position 1
        if (!gu1) {
            if (!au0 && g1 === a0) { r1 = 1; au0 = 1; }
            else if (!au1 && g1 === a1) { r1 = 1; au1 = 1; }
            else if (!au2 && g1 === a2) { r1 = 1; au2 = 1; }
            else if (!au3 && g1 === a3) { r1 = 1; au3 = 1; }
            else if (!au4 && g1 === a4) { r1 = 1; au4 = 1; }
        }
        // Misplaced - position 2
        if (!gu2) {
            if (!au0 && g2 === a0) { r2 = 1; au0 = 1; }
            else if (!au1 && g2 === a1) { r2 = 1; au1 = 1; }
            else if (!au2 && g2 === a2) { r2 = 1; au2 = 1; }
            else if (!au3 && g2 === a3) { r2 = 1; au3 = 1; }
            else if (!au4 && g2 === a4) { r2 = 1; au4 = 1; }
        }
        // Misplaced - position 3
        if (!gu3) {
            if (!au0 && g3 === a0) { r3 = 1; au0 = 1; }
            else if (!au1 && g3 === a1) { r3 = 1; au1 = 1; }
            else if (!au2 && g3 === a2) { r3 = 1; au2 = 1; }
            else if (!au3 && g3 === a3) { r3 = 1; au3 = 1; }
            else if (!au4 && g3 === a4) { r3 = 1; au4 = 1; }
        }
        // Misplaced - position 4
        if (!gu4) {
            if (!au0 && g4 === a0) { r4 = 1; au0 = 1; }
            else if (!au1 && g4 === a1) { r4 = 1; au1 = 1; }
            else if (!au2 && g4 === a2) { r4 = 1; au2 = 1; }
            else if (!au3 && g4 === a3) { r4 = 1; au3 = 1; }
            else if (!au4 && g4 === a4) { r4 = 1; au4 = 1; }
        }

        return r0 + r1 * 3 + r2 * 9 + r3 * 27 + r4 * 81;
    }

    /**
     * Decode a pattern number back to array of [0,1,2] values
     */
    decodePattern(patternNum) {
        const result = [];
        let p = patternNum;
        for (let i = 0; i < 5; i++) {
            result.push(p % 3);
            p = Math.floor(p / 3);
        }
        return result;
    }

    /**
     * Encode a pattern array [0,1,2,...] to a number
     */
    encodePattern(pattern) {
        return pattern[0] + pattern[1] * 3 + pattern[2] * 9 + pattern[3] * 27 + pattern[4] * 81;
    }

    /**
     * Compute entropy for a guess word against the current remaining answers.
     * Higher entropy = better guess (more information gained on average).
     */
    computeEntropy(guessCodes, remainingCodes) {
        const n = remainingCodes.length;
        if (n <= 1) return 0;

        // Count patterns
        const buckets = new Int32Array(243);
        for (let i = 0; i < n; i++) {
            const pattern = this.computePatternFast(guessCodes, remainingCodes[i]);
            buckets[pattern]++;
        }

        // Compute entropy: -sum(p * log2(p))
        let entropy = 0;
        const logN = Math.log2(n);
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
     * Get the best guess using entropy maximization.
     * When few candidates remain, we also give a small bonus to words
     * that are themselves possible answers (since they can win outright).
     */
    getBestGuess() {
        const remaining = this.remainingAnswers;
        const n = remaining.length;

        if (n === 0) return null;
        if (n === 1) return remaining[0];
        if (n === 2) return remaining[0]; // just guess one of them

        // Convert remaining to codes
        const remainingCodes = remaining.map(w => this._wordToCodes(w));
        const remainingSet = new Set(remaining);

        const startTime = performance.now();

        // For guess 1, use precomputed optimal: SALET
        if (this.guessHistory.length === 0) {
            this._lastComputeTime = 0;
            this._lastEntropy = 5.89; // known entropy for SALET
            return 'salet';
        }

        // Determine candidate guesses
        // If remaining <= 20, only consider remaining answers (one of them will be right)
        // Otherwise, consider all guess words for maximum information
        let candidateWords;
        let candidateCodes;

        if (n <= 3) {
            // Tiny pool: just try remaining answers
            candidateWords = remaining;
            candidateCodes = remainingCodes;
        } else if (n <= 300) {
            // Small/medium pool: use full guess vocabulary for best splits
            candidateWords = this.allGuessWords;
            candidateCodes = this.guessCodes;
        } else {
            // Large pool: use answer words for speed (still excellent results)
            candidateWords = this.answerWords;
            candidateCodes = this.answerCodes;
        }

        let bestWord = null;
        let bestScore = -Infinity;

        // Small bonus for words that are possible answers (can win the game)
        const answerBonus = 0.02;

        for (let i = 0; i < candidateWords.length; i++) {
            const word = candidateWords[i];
            const codes = candidateCodes[i];

            let score = this.computeEntropy(codes, remainingCodes);

            // Tie-break: prefer possible answers
            if (remainingSet.has(word)) {
                score += answerBonus;
            }

            if (score > bestScore) {
                bestScore = score;
                bestWord = word;
            }
        }

        this._lastComputeTime = performance.now() - startTime;
        this._lastEntropy = bestScore;

        return bestWord;
    }

    /**
     * Apply feedback and filter remaining answers.
     * pattern: array of 5 values, each 0 (absent), 1 (present), 2 (correct)
     */
    applyGuess(word, pattern) {
        this.guessHistory.push({ word, pattern: [...pattern] });

        // Filter remaining answers based on this feedback
        this.remainingAnswers = this.remainingAnswers.filter(answer => {
            const expectedPattern = this.computePattern(word, answer);
            const givenPattern = this.encodePattern(pattern);
            return expectedPattern === givenPattern;
        });
    }

    /**
     * Reset solver to initial state
     */
    reset() {
        this.remainingAnswers = [...this.answerWords];
        this.guessHistory = [];
    }

    /**
     * Check if a word is a valid guess
     */
    isValidGuess(word) {
        return this.allGuessWords.includes(word.toLowerCase());
    }

    /**
     * Get guess history with decoded patterns
     */
    getHistory() {
        return this.guessHistory.map(g => ({
            word: g.word,
            pattern: g.pattern
        }));
    }
}
