/**
 * Web Worker for solver computation — keeps UI responsive
 */

let solver = null;

// Import solver class in worker context
importScripts('solver.js');

self.onmessage = function(e) {
    const { type, data } = e.data;

    switch (type) {
        case 'init': {
            solver = new WordleSolver(data.answers, data.allWords);
            self.postMessage({ type: 'ready' });
            break;
        }

        case 'setJackpotMode': {
            solver.jackpotMode = data.enabled;
            self.postMessage({ type: 'jackpotModeSet' });
            break;
        }

        case 'setUsedWords': {
            // Legacy support — convert flat list to frequency map
            const freqMap = {};
            data.words.forEach(w => { freqMap[w] = (freqMap[w] || 0) + 1; });
            solver.setWordFrequencies(freqMap);
            self.postMessage({ type: 'usedWordsSet', data: { poolSize: solver.answerWords.length } });
            break;
        }

        case 'setWordFrequencies': {
            solver.setWordFrequencies(data.freqMap);
            self.postMessage({ type: 'wordFrequenciesSet' });
            break;
        }

        case 'getBestGuess': {
            const guess = solver.getBestGuess();
            self.postMessage({
                type: 'bestGuess',
                data: {
                    guess,
                    remaining: solver.remainingAnswers.length,
                    remainingWords: solver.remainingAnswers.slice(0, 100),
                    entropy: solver._lastEntropy,
                    computeTime: solver._lastComputeTime,
                    jackpotChance: solver._lastJackpotChance
                }
            });
            break;
        }

        case 'applyGuess': {
            solver.applyGuess(data.word, data.pattern);
            self.postMessage({
                type: 'guessApplied',
                data: {
                    remaining: solver.remainingAnswers.length,
                    remainingWords: solver.remainingAnswers.slice(0, 100)
                }
            });
            break;
        }

        case 'reset': {
            solver.reset();
            self.postMessage({ type: 'resetDone' });
            break;
        }
    }
};
