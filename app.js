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
let jackpotMode = false;

// Session stats
let sessionStats = { games: 0, wins: 0, totalGuesses: 0, distribution: {1:0, 2:0, 3:0, 4:0, 5:0, 6:0, fail:0} };

// Persistent game history
let gameHistory = [];

// Used words (persisted in localStorage)
let usedWords = [];

const PATTERN_CLASSES = ['absent', 'present', 'correct'];
const PATTERN_LABELS = ['absent', 'misplaced', 'correct'];

// ── Persistence ─────────────────────────────────────────────────────────────

function loadUsedWords() {
    try {
        const stored = localStorage.getItem('wordle-solver-used-words');
        if (stored) {
            usedWords = JSON.parse(stored);
        }
    } catch (e) {
        usedWords = [];
    }
}

function saveUsedWords() {
    try {
        localStorage.setItem('wordle-solver-used-words', JSON.stringify(usedWords));
    } catch (e) {
        // localStorage may be unavailable
    }
}

function loadGameHistory() {
    try {
        const stored = localStorage.getItem('wordle-solver-game-history');
        if (stored) {
            gameHistory = JSON.parse(stored);
        }
    } catch (e) {
        gameHistory = [];
    }
}

function saveGameHistory() {
    try {
        localStorage.setItem('wordle-solver-game-history', JSON.stringify(gameHistory));
    } catch (e) {}
}

function loadJackpotMode() {
    try {
        const stored = localStorage.getItem('wordle-solver-jackpot-mode');
        jackpotMode = stored === 'true';
    } catch (e) {
        jackpotMode = false;
    }
}

function saveJackpotMode() {
    try {
        localStorage.setItem('wordle-solver-jackpot-mode', jackpotMode ? 'true' : 'false');
    } catch (e) {}
}

// ── Initialization ──────────────────────────────────────────────────────────

async function init() {
    showLoading('Loading word banks...');
    loadUsedWords();
    loadJackpotMode();
    loadGameHistory();

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

        try {
            await initWorker(answerList, fullGuessList);
        } catch (workerErr) {
            console.warn('Worker failed, falling back to main thread:', workerErr);
            await initMainThread(answerList, fullGuessList);
        }

        // Send saved state to solver
        syncSolverSettings();

        hideLoading();
        renderUsedWordsUI();
        renderJackpotToggle();
        renderPerformanceGraph();
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

function syncSolverSettings() {
    if (worker) {
        worker.postMessage({ type: 'setUsedWords', data: { words: usedWords } });
        worker.postMessage({ type: 'setJackpotMode', data: { enabled: jackpotMode } });
    } else if (mainThreadSolver) {
        mainThreadSolver.setUsedWords(usedWords);
        mainThreadSolver.jackpotMode = jackpotMode;
    }
}

function startNewGame() {
    guessNumber = 1;
    currentPattern = [0, 0, 0, 0, 0];
    knownGreens = [null, null, null, null, null];

    document.getElementById('history').innerHTML = '';
    document.getElementById('solved-message').classList.add('hidden');
    document.getElementById('current-guess-section').classList.remove('hidden');
    document.getElementById('remaining-count').style.color = '';

    // Sync settings before reset
    syncSolverSettings();

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
            const { guess, remaining, remainingWords, entropy, computeTime, jackpotChance } = e.data.data;

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
            updateAlgoInfo(entropy, computeTime, jackpotChance);
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
    updateAlgoInfo(mainThreadSolver._lastEntropy, mainThreadSolver._lastComputeTime, mainThreadSolver._lastJackpotChance);
    setSubmitEnabled(true);
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderCurrentRow(word) {
    const row = document.getElementById('current-row');
    row.innerHTML = '';

    for (let i = 0; i < 5; i++) {
        const tile = document.createElement('div');
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
        if (usedWords.includes(word)) {
            el.classList.add('is-used');
        }
        el.textContent = word;
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

function updateAlgoInfo(entropy, computeTime, jackpotChance) {
    const entropyEl = document.getElementById('entropy-display');
    const timeEl = document.getElementById('computation-time');
    const jackpotEl = document.getElementById('jackpot-display');
    const firstWordEl = document.getElementById('first-word-display');

    if (firstWordEl && guessNumber === 1) {
        if (jackpotMode) {
            firstWordEl.innerHTML = `<strong>First word:</strong> ${currentGuessWord.toUpperCase()} (jackpot pick)`;
        } else {
            firstWordEl.innerHTML = `<strong>First word:</strong> SALET (optimal opener)`;
        }
    }

    if (entropy !== undefined && entropy !== null) {
        entropyEl.innerHTML = `<strong>Entropy:</strong> ${entropy.toFixed(3)} bits`;
    }
    if (computeTime !== undefined && computeTime !== null) {
        timeEl.innerHTML = `<strong>Compute time:</strong> ${computeTime.toFixed(0)}ms`;
    }
    if (jackpotEl) {
        if (jackpotChance !== undefined && jackpotChance !== null && jackpotChance > 0) {
            const pct = (jackpotChance * 100).toFixed(2);
            jackpotEl.innerHTML = `<strong>Jackpot chance:</strong> ${pct}% (1 in ${Math.round(1/jackpotChance)})`;
            jackpotEl.classList.remove('hidden');
        } else {
            jackpotEl.classList.add('hidden');
        }
    }
}

// ── Custom guess ────────────────────────────────────────────────────────────

function useCustomGuess(word) {
    if (isComputing) return;
    if (word.length !== 5) return;

    currentGuessWord = word.toLowerCase();
    renderCurrentRow(currentGuessWord);
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

    const manualInput = document.getElementById('manual-word-input');
    if (manualInput) manualInput.value = '';

    setTimeout(() => {
        requestBestGuess();
    }, 150);
}

function markSolved() {
    if (isComputing) return;

    currentPattern = [2, 2, 2, 2, 2];
    const tiles = document.getElementById('current-row').children;
    for (let i = 0; i < 5; i++) {
        tiles[i].className = 'tile correct';
    }

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

        // Auto-add solved word to used words list
        addUsedWord(word.toLowerCase());
    } else {
        sessionStats.distribution.fail++;
        const rem = worker ? totalRemaining : mainThreadSolver.remainingAnswers.length;
        document.getElementById('solved-text').textContent =
            `Couldn't solve in 6 guesses. ${rem} words remaining.`;
    }

    // Persist game to history
    gameHistory.push({
        date: new Date().toISOString(),
        word: word || null,
        guesses: word ? numGuesses : 7, // 7 = fail
        won: !!word,
        jackpot: jackpotMode
    });
    saveGameHistory();

    updateSessionStats();
    renderPerformanceGraph();
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

// ── Used words management ───────────────────────────────────────────────────

function addUsedWord(word) {
    word = word.toLowerCase().trim();
    if (word.length !== 5 || usedWords.includes(word)) return;
    usedWords.push(word);
    usedWords.sort();
    saveUsedWords();
    renderUsedWordsUI();
    // Update solver with new used words list
    if (worker) {
        worker.postMessage({ type: 'setUsedWords', data: { words: usedWords } });
    } else if (mainThreadSolver) {
        mainThreadSolver.setUsedWords(usedWords);
    }
}

function removeUsedWord(word) {
    usedWords = usedWords.filter(w => w !== word);
    saveUsedWords();
    renderUsedWordsUI();
    if (worker) {
        worker.postMessage({ type: 'setUsedWords', data: { words: usedWords } });
    } else if (mainThreadSolver) {
        mainThreadSolver.setUsedWords(usedWords);
    }
}

function clearUsedWords() {
    if (!confirm(`Clear all ${usedWords.length} used words?`)) return;
    usedWords = [];
    saveUsedWords();
    renderUsedWordsUI();
    if (worker) {
        worker.postMessage({ type: 'setUsedWords', data: { words: usedWords } });
    } else if (mainThreadSolver) {
        mainThreadSolver.setUsedWords(usedWords);
    }
}

function handleAddUsedWord() {
    const input = document.getElementById('add-used-word-input');
    const val = input.value.toLowerCase().replace(/[^a-z]/g, '').trim();
    if (val.length === 5) {
        addUsedWord(val);
        input.value = '';
    }
}

function handleBulkImport() {
    const input = document.getElementById('bulk-import-input');
    const text = input.value.toLowerCase();
    // Accept comma, space, newline separated words
    const words = text.split(/[\s,]+/).map(w => w.replace(/[^a-z]/g, '').trim()).filter(w => w.length === 5);
    let added = 0;
    words.forEach(w => {
        if (!usedWords.includes(w)) {
            usedWords.push(w);
            added++;
        }
    });
    if (added > 0) {
        usedWords.sort();
        saveUsedWords();
        renderUsedWordsUI();
        if (worker) {
            worker.postMessage({ type: 'setUsedWords', data: { words: usedWords } });
        } else if (mainThreadSolver) {
            mainThreadSolver.setUsedWords(usedWords);
        }
    }
    input.value = '';
    // Show feedback
    const countEl = document.getElementById('used-words-count');
    if (countEl && added > 0) {
        const orig = countEl.textContent;
        countEl.textContent = `+${added} added!`;
        countEl.style.color = 'var(--correct)';
        setTimeout(() => {
            countEl.textContent = `${usedWords.length} words tracked`;
            countEl.style.color = '';
        }, 1500);
    }
}

function renderUsedWordsUI() {
    const countEl = document.getElementById('used-words-count');
    if (countEl) {
        countEl.textContent = `${usedWords.length} words tracked`;
        countEl.style.color = '';
    }

    const listEl = document.getElementById('used-words-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (usedWords.length === 0) {
        listEl.innerHTML = '<span class="used-words-empty">No words tracked yet. Solved words are added automatically.</span>';
        return;
    }

    // Show all used words as removable tags
    usedWords.forEach(word => {
        const tag = document.createElement('span');
        tag.className = 'used-word-tag';
        tag.innerHTML = `${word.toUpperCase()} <span class="remove-word" title="Remove">&times;</span>`;
        tag.querySelector('.remove-word').addEventListener('click', (e) => {
            e.stopPropagation();
            removeUsedWord(word);
        });
        listEl.appendChild(tag);
    });
}

// ── Jackpot mode toggle ─────────────────────────────────────────────────────

function toggleJackpotMode() {
    jackpotMode = !jackpotMode;
    saveJackpotMode();
    renderJackpotToggle();
    syncSolverSettings();
}

function renderJackpotToggle() {
    const toggle = document.getElementById('jackpot-toggle');
    if (!toggle) return;
    toggle.checked = jackpotMode;

    const label = document.getElementById('jackpot-mode-label');
    if (label) {
        label.textContent = jackpotMode ? 'ON — first guess from answer pool (jackpot eligible)' : 'OFF — using SALET (pure info gain)';
    }
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

// ── Performance graph ────────────────────────────────────────────────────────

function renderPerformanceGraph() {
    const container = document.getElementById('performance-graph');
    if (!container) return;

    const wins = gameHistory.filter(g => g.won);
    if (wins.length < 2) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');

    const canvas = document.getElementById('perf-canvas');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const cssWidth = canvas.parentElement.clientWidth || 500;
    const cssHeight = 180;
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // Compute rolling average (window of 10 games)
    const windowSize = Math.min(10, Math.max(3, Math.floor(wins.length / 3)));
    const rollingAvg = [];
    for (let i = 0; i < wins.length; i++) {
        const start = Math.max(0, i - windowSize + 1);
        const slice = wins.slice(start, i + 1);
        const avg = slice.reduce((sum, g) => sum + g.guesses, 0) / slice.length;
        rollingAvg.push(avg);
    }

    // Chart dimensions
    const padLeft = 32;
    const padRight = 12;
    const padTop = 20;
    const padBottom = 28;
    const chartW = cssWidth - padLeft - padRight;
    const chartH = cssHeight - padTop - padBottom;

    const minY = 1;
    const maxY = 6;
    const yRange = maxY - minY;

    function xPos(i) { return padLeft + (i / (wins.length - 1)) * chartW; }
    function yPos(v) { return padTop + ((maxY - v) / yRange) * chartH; }

    // Grid lines
    ctx.strokeStyle = '#3a3a3c';
    ctx.lineWidth = 0.5;
    for (let y = 1; y <= 6; y++) {
        ctx.beginPath();
        ctx.moveTo(padLeft, yPos(y));
        ctx.lineTo(padLeft + chartW, yPos(y));
        ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = '#818384';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (let y = 1; y <= 6; y++) {
        ctx.fillText(y.toString(), padLeft - 6, yPos(y) + 4);
    }

    // Individual game dots
    ctx.fillStyle = 'rgba(83, 141, 78, 0.4)';
    for (let i = 0; i < wins.length; i++) {
        ctx.beginPath();
        ctx.arc(xPos(i), yPos(wins[i].guesses), 3, 0, Math.PI * 2);
        ctx.fill();
    }

    // Rolling average line
    ctx.strokeStyle = '#538d4e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < rollingAvg.length; i++) {
        const x = xPos(i);
        const y = yPos(rollingAvg[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Current average label
    const currentAvg = rollingAvg[rollingAvg.length - 1];
    ctx.fillStyle = '#538d4e';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    const lastX = xPos(wins.length - 1);
    const lastY = yPos(currentAvg);
    ctx.fillText(currentAvg.toFixed(2), Math.min(lastX + 6, cssWidth - 40), lastY + 4);

    // X-axis label
    ctx.fillStyle = '#818384';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${wins.length} games`, padLeft + chartW / 2, cssHeight - 4);

    // All-time stats
    const allTimeAvg = wins.reduce((s, g) => s + g.guesses, 0) / wins.length;
    const totalGames = gameHistory.length;
    const totalWins = wins.length;

    const statsEl = document.getElementById('perf-all-time');
    if (statsEl) {
        statsEl.innerHTML =
            `<span>All-time: <strong>${allTimeAvg.toFixed(2)}</strong> avg</span>` +
            `<span>${totalWins}/${totalGames} won</span>` +
            `<span>Rolling ${windowSize}-game avg: <strong>${currentAvg.toFixed(2)}</strong></span>`;
    }
}

// ── Event listeners ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('submit-btn').addEventListener('click', submitFeedback);
    document.getElementById('solved-btn').addEventListener('click', markSolved);
    document.getElementById('reset-btn').addEventListener('click', startNewGame);
    document.getElementById('play-again-btn').addEventListener('click', startNewGame);

    const jackpotToggle = document.getElementById('jackpot-toggle');
    if (jackpotToggle) {
        jackpotToggle.addEventListener('change', toggleJackpotMode);
    }

    const addWordBtn = document.getElementById('add-used-word-btn');
    if (addWordBtn) {
        addWordBtn.addEventListener('click', handleAddUsedWord);
    }

    const addWordInput = document.getElementById('add-used-word-input');
    if (addWordInput) {
        addWordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleAddUsedWord();
        });
    }

    const bulkImportBtn = document.getElementById('bulk-import-btn');
    if (bulkImportBtn) {
        bulkImportBtn.addEventListener('click', handleBulkImport);
    }

    const clearBtn = document.getElementById('clear-used-words-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearUsedWords);
    }

    // Keyboard shortcut: Enter to submit
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !document.getElementById('current-guess-section').classList.contains('hidden')) {
            // Don't submit if focus is in used-words inputs
            if (document.activeElement && (
                document.activeElement.id === 'add-used-word-input' ||
                document.activeElement.id === 'bulk-import-input'
            )) return;
            e.preventDefault();
            submitFeedback();
        }
    });

    init();
});
