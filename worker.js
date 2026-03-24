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

        case 'getBestGuess': {
            const guess = solver.getBestGuess();
            self.postMessage({
                type: 'bestGuess',
                data: {
                    guess,
                    remaining: solver.remainingAnswers.length,
                    remainingWords: solver.remainingAnswers.slice(0, 100),
                    entropy: solver._lastEntropy,
                    computeTime: solver._lastComputeTime
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
