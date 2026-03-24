/**
 * Wordle Solver UI — Interactive application layer with Web Worker support
 */

let worker = null;
let currentGuessWord = '';
let currentPattern = [0, 0, 0, 0, 0]; // 0=absent, 1=present, 2=correct
let guessNumber = 1;
let isComputing = false;
let allRemainingWords = [];
let totalRemaining = 0;
let answerSet = new Set();
let knownGreens = [null, null, null, null, null]; // confirmed green letters per position

// Session stats
let sessionStats = { games: 0, wins: 0, totalGuesses: 0, distribution: {1:0, 2:0, 3:0, 4:0, 5:0, 6:0, fail:0} };

const PATTERN_CLASSES = ['absent', 'present', 'correct'];
const PATTERN_LABELS = ['absent', 'misplaced', 'correct'];

// ── Initialization ──────────────────────────────────────────────────────────

async function init() {
    showLoading('Loading word banks...');

    try {
        const [answersResp, wordsResp] = await Promise.all([
            fetch('nyt-answers.json'),
            fetch('wordle-words.json')
        ]);

        const answers = await answersResp.json();
        const allWords = await wordsResp.json();

        const wordSet = new Set(allWords.map(w => w.toLowerCase()));
        const answerList = answers.map(w => w.toLowerCase());
        answerList.forEach(w => wordSet.add(w));
        const fullGuessList = Array.from(wordSet);

        answerSet = new Set(answerList);

        showLoading('Initializing solver engine...');

        // Try Web Worker first, fall back to main thread
        try {
            await initWorker(answerList, fullGuessList);
        } catch (workerErr) {
            console.warn('Worker failed, falling back to main thread:', workerErr);
            await initMainThread(answerList, fullGuessList);
        }

        hideLoading();
        startNewGame();
    } catch (err) {
        console.error('Failed to load word banks:', err);
        hideLoading();
        document.getElementById('current-guess-section').innerHTML =
            '<p style="color: #e74c3c; text-align: center;">Failed to load word banks. Serve via HTTP (not file://). Use: python3 -m http.server</p>';
    }
}

function initWorker(answers, allWords) {
    return new Promise((resolve, reject) => {
        try {
            worker = new Worker('worker.js');
            worker.onmessage = function(e) {
                if (e.data.type === 'ready') {
                    resolve();
                }
            };
            worker.onerror = reject;
            worker.postMessage({ type: 'init', data: { answers, allWords } });
        } catch (err) {
            reject(err);
        }
    });
}

let mainThreadSolver = null;
async function initMainThread(answers, allWords) {
    mainThreadSolver = new WordleSolver(answers, allWords);
}

function startNewGame() {
    guessNumber = 1;
    currentPattern = [0, 0, 0, 0, 0];
    knownGreens = [null, null, null, null, null];

    document.getElementById('history').innerHTML = '';
    document.getElementById('solved-message').classList.add('hidden');
    document.getElementById('current-guess-section').classList.remove('hidden');
    document.getElementById('remaining-count').style.color = '';

    if (worker) {
        worker.postMessage({ type: 'reset' });
        worker.onmessage = function(e) {
            if (e.data.type === 'resetDone') {
                requestBestGuess();
            }
        };
    } else {
        mainThreadSolver.reset();
        requestBestGuessMainThread();
    }
}

// ── Compute next guess ──────────────────────────────────────────────────────

function requestBestGuess() {
    if (!worker) {
        requestBestGuessMainThread();
        return;
    }

    isComputing = true;
    setSubmitEnabled(false);
    showComputingIndicator();

    worker.onmessage = function(e) {
        if (e.data.type === 'bestGuess') {
            isComputing = false;
            const { guess, remaining, remainingWords, entropy, computeTime } = e.data.data;

            if (!guess) {
                showError('No matching words remain. Check your feedback.');
                return;
            }

            totalRemaining = remaining;
            allRemainingWords = remainingWords;
            currentGuessWord = guess;

            renderCurrentRow(guess);
            updateGuessLabel();
            updateCandidates();
            updateAlgoInfo(entropy, computeTime);
            setSubmitEnabled(true);
            hideComputingIndicator();
        }
    };

    worker.postMessage({ type: 'getBestGuess' });
}

function requestBestGuessMainThread() {
    const guess = mainThreadSolver.getBestGuess();

    if (!guess) {
        showError('No matching words remain. Check your feedback.');
        return;
    }

    totalRemaining = mainThreadSolver.remainingAnswers.length;
    allRemainingWords = mainThreadSolver.remainingAnswers.slice(0, 100);
    currentGuessWord = guess;

    renderCurrentRow(guess);
    updateGuessLabel();
    updateCandidates();
    updateAlgoInfo(mainThreadSolver._lastEntropy, mainThreadSolver._lastComputeTime);
    setSubmitEnabled(true);
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderCurrentRow(word) {
    const row = document.getElementById('current-row');
    row.innerHTML = '';

    for (let i = 0; i < 5; i++) {
        const tile = document.createElement('div');
        // Auto-set green if this letter matches a known green at this position
        const isKnownGreen = knownGreens[i] !== null && word[i] === knownGreens[i];
        if (isKnownGreen) {
            tile.className = 'tile correct';
            currentPattern[i] = 2;
        } else {
            tile.className = 'tile absent';
            currentPattern[i] = 0;
        }
        tile.textContent = word[i];
        tile.dataset.index = i;
        tile.setAttribute('role', 'button');
        const status = isKnownGreen ? 'correct' : 'absent';
        tile.setAttribute('aria-label', `Letter ${word[i].toUpperCase()}, position ${i + 1}: ${status}. Click to change.`);
        tile.addEventListener('click', () => toggleTile(i));
        row.appendChild(tile);
    }
}

function toggleTile(index) {
    if (isComputing) return;

    currentPattern[index] = (currentPattern[index] + 1) % 3;
    const tiles = document.getElementById('current-row').children;
    const tile = tiles[index];
    tile.className = 'tile ' + PATTERN_CLASSES[currentPattern[index]];
    tile.setAttribute('aria-label',
        `Letter ${tile.textContent.toUpperCase()}, position ${index + 1}: ${PATTERN_LABELS[currentPattern[index]]}. Click to change.`);
}

function addToHistory(word, pattern) {
    const history = document.getElementById('history');
    const row = document.createElement('div');
    row.className = 'tile-row';

    for (let i = 0; i < 5; i++) {
        const tile = document.createElement('div');
        tile.className = 'tile ' + PATTERN_CLASSES[pattern[i]];
        tile.textContent = word[i];
        row.appendChild(tile);
    }

    // Add a summary line showing letter info
    const summaryRow = document.createElement('div');
    summaryRow.className = 'guess-summary';
    const correctLetters = [];
    const misplacedLetters = [];
    const absentLetters = [];
    for (let i = 0; i < 5; i++) {
        const letter = word[i].toUpperCase();
        if (pattern[i] === 2) correctLetters.push(`${letter}(${i+1})`);
        else if (pattern[i] === 1) misplacedLetters.push(`${letter}`);
        else absentLetters.push(letter);
    }

    let summaryParts = [];
    if (correctLetters.length > 0) summaryParts.push(`<span class="summary-correct">✓ ${correctLetters.join(' ')}</span>`);
    if (misplacedLetters.length > 0) summaryParts.push(`<span class="summary-present">~ ${misplacedLetters.join(' ')}</span>`);
    if (absentLetters.length > 0) summaryParts.push(`<span class="summary-absent">✗ ${absentLetters.join(' ')}</span>`);

    summaryRow.innerHTML = summaryParts.join('  ');
    history.appendChild(row);
    history.appendChild(summaryRow);
}

function updateGuessLabel() {
    document.getElementById('guess-number').textContent = `Guess ${guessNumber}`;
    document.getElementById('remaining-count').textContent =
        `${totalRemaining} word${totalRemaining !== 1 ? 's' : ''} remaining`;
    document.getElementById('remaining-count').style.color = '';
}

function updateCandidates() {
    const remaining = allRemainingWords;
    const container = document.getElementById('candidates-list');
    const countEl = document.getElementById('candidate-count');

    countEl.textContent = `(${totalRemaining})`;

    const shown = remaining.slice().sort().slice(0, 60);
    container.innerHTML = '';

    shown.forEach(word => {
        const el = document.createElement('span');
        el.className = 'candidate-word';
        if (word === currentGuessWord) {
            el.classList.add('is-answer');
        }
        el.textContent = word;
        // Allow clicking a candidate to use it as the guess
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => useCustomGuess(word));
        container.appendChild(el);
    });

    if (totalRemaining > 60) {
        const more = document.createElement('span');
        more.className = 'candidate-word';
        more.textContent = `+${totalRemaining - 60} more`;
        more.style.color = 'var(--text-dim)';
        container.appendChild(more);
    }
}

function updateAlgoInfo(entropy, computeTime) {
    const entropyEl = document.getElementById('entropy-display');
    const timeEl = document.getElementById('computation-time');

    if (entropy !== undefined && entropy !== null) {
        entropyEl.innerHTML = `<strong>Entropy:</strong> ${entropy.toFixed(3)} bits`;
    }
    if (computeTime !== undefined && computeTime !== null) {
        timeEl.innerHTML = `<strong>Compute time:</strong> ${computeTime.toFixed(0)}ms`;
    }
}

// ── Custom guess ────────────────────────────────────────────────────────────

function useCustomGuess(word) {
    if (isComputing) return;
    if (word.length !== 5) return;

    currentGuessWord = word.toLowerCase();
    renderCurrentRow(currentGuessWord); // renderCurrentRow handles knownGreens and resets currentPattern
}

function handleManualInput(e) {
    const input = e.target;
    let val = input.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 5);
    input.value = val;

    if (val.length === 5) {
        useCustomGuess(val);
    }
}

// ── Submit feedback ─────────────────────────────────────────────────────────

function submitFeedback() {
    if (isComputing) return;

    const allCorrect = currentPattern.every(p => p === 2);

    addToHistory(currentGuessWord, currentPattern);

    // Record confirmed green letters for auto-highlighting next guess
    for (let i = 0; i < 5; i++) {
        if (currentPattern[i] === 2) {
            knownGreens[i] = currentGuessWord[i];
        }
    }

    if (worker) {
        worker.postMessage({ type: 'applyGuess', data: { word: currentGuessWord, pattern: currentPattern } });
    } else {
        mainThreadSolver.applyGuess(currentGuessWord, currentPattern);
    }

    if (allCorrect) {
        showSolved(currentGuessWord, guessNumber);
        return;
    }

    if (guessNumber >= 6) {
        showSolved(null, guessNumber);
        return;
    }

    guessNumber++;

    // Clear manual input
    const manualInput = document.getElementById('manual-word-input');
    if (manualInput) manualInput.value = '';

    setTimeout(() => {
        requestBestGuess();
    }, 150);
}

function markSolved() {
    if (isComputing) return;

    // Set all tiles to green
    currentPattern = [2, 2, 2, 2, 2];
    const tiles = document.getElementById('current-row').children;
    for (let i = 0; i < 5; i++) {
        tiles[i].className = 'tile correct';
    }

    // Record greens and submit
    addToHistory(currentGuessWord, currentPattern);
    for (let i = 0; i < 5; i++) {
        knownGreens[i] = currentGuessWord[i];
    }

    if (worker) {
        worker.postMessage({ type: 'applyGuess', data: { word: currentGuessWord, pattern: currentPattern } });
    } else {
        mainThreadSolver.applyGuess(currentGuessWord, currentPattern);
    }

    showSolved(currentGuessWord, guessNumber);
}

function showSolved(word, numGuesses) {
    document.getElementById('current-guess-section').classList.add('hidden');
    const solvedEl = document.getElementById('solved-message');
    solvedEl.classList.remove('hidden');

    // Log session stats
    sessionStats.games++;
    if (word) {
        sessionStats.wins++;
        sessionStats.totalGuesses += numGuesses;
        sessionStats.distribution[numGuesses] = (sessionStats.distribution[numGuesses] || 0) + 1;
        document.getElementById('solved-text').textContent =
            `Found "${word.toUpperCase()}" in ${numGuesses} guess${numGuesses !== 1 ? 'es' : ''}!`;
    } else {
        sessionStats.distribution.fail++;
        const rem = worker ? totalRemaining : mainThreadSolver.remainingAnswers.length;
        document.getElementById('solved-text').textContent =
            `Couldn't solve in 6 guesses. ${rem} words remaining.`;
    }

    updateSessionStats();
}

function showError(msg) {
    document.getElementById('remaining-count').textContent = msg;
    document.getElementById('remaining-count').style.color = '#e74c3c';
    setSubmitEnabled(true);
    hideComputingIndicator();
}

function setSubmitEnabled(enabled) {
    const btn = document.getElementById('submit-btn');
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? '1' : '0.5';
}

// ── Computing indicator ─────────────────────────────────────────────────────

function showComputingIndicator() {
    document.getElementById('remaining-count').textContent = 'Computing optimal guess...';
    document.getElementById('remaining-count').style.color = 'var(--present)';
}

function hideComputingIndicator() {
    document.getElementById('remaining-count').style.color = '';
}

// ── Loading overlay ─────────────────────────────────────────────────────────

function showLoading(msg) {
    let overlay = document.getElementById('loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.innerHTML = `<div class="spinner"></div><p>${msg}</p>`;
        document.body.appendChild(overlay);
    } else {
        overlay.querySelector('p').textContent = msg;
        overlay.classList.remove('hidden');
    }
}

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');
}

// ── Session stats ────────────────────────────────────────────────────────────

function updateSessionStats() {
    const el = document.getElementById('session-stats');
    if (!el) return;

    const { games, wins, totalGuesses, distribution } = sessionStats;
    if (games === 0) {
        el.classList.add('hidden');
        return;
    }

    el.classList.remove('hidden');
    const avg = wins > 0 ? (totalGuesses / wins).toFixed(2) : '-';
    const winPct = Math.round((wins / games) * 100);

    document.getElementById('stat-played').textContent = games;
    document.getElementById('stat-win-pct').textContent = winPct + '%';
    document.getElementById('stat-avg').textContent = avg;

    // Render distribution bars
    const distEl = document.getElementById('stat-distribution');
    distEl.innerHTML = '';
    const maxCount = Math.max(1, ...Object.values(distribution));

    for (let i = 1; i <= 6; i++) {
        const count = distribution[i] || 0;
        const row = document.createElement('div');
        row.className = 'dist-row';
        row.innerHTML = `<span class="dist-label">${i}</span>` +
            `<div class="dist-bar-track"><div class="dist-bar" style="width:${Math.max(count > 0 ? 8 : 0, (count / maxCount) * 100)}%">${count}</div></div>`;
        distEl.appendChild(row);
    }
    const failCount = distribution.fail || 0;
    if (failCount > 0) {
        const row = document.createElement('div');
        row.className = 'dist-row';
        row.innerHTML = `<span class="dist-label">X</span>` +
            `<div class="dist-bar-track"><div class="dist-bar dist-bar-fail" style="width:${Math.max(8, (failCount / maxCount) * 100)}%">${failCount}</div></div>`;
        distEl.appendChild(row);
    }
}

// ── Event listeners ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('submit-btn').addEventListener('click', submitFeedback);
    document.getElementById('solved-btn').addEventListener('click', markSolved);
    document.getElementById('reset-btn').addEventListener('click', startNewGame);
    document.getElementById('play-again-btn').addEventListener('click', startNewGame);

    // Keyboard shortcut: Enter to submit
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !document.getElementById('current-guess-section').classList.contains('hidden')) {
            e.preventDefault();
            submitFeedback();
        }
    });

    init();
});
