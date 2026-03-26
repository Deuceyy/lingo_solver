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

// H2H session tracking
const ENTRY_COST = 2.10;
const WIN_PAYOUT = 4.10;
let h2hStats = { wins: 0, losses: 0, draws: 0, solos: 0, pnl: 0 };

const SOLVER_VERSION = '3.3.0';

// Current game's guess log (for detailed export)
let currentGameGuesses = [];

// Persistent game history
let gameHistory = [];

// Track when this browser session started (for copy-session feature)
const SESSION_START_TIME = new Date().toISOString();

// Word frequency tracking (persisted in localStorage)
// Format: {word: count} — tracks how many times each word has appeared as an answer
let wordFrequencies = {};
// Legacy flat list derived from frequencies for backward-compat UI
let usedWords = [];

const PATTERN_CLASSES = ['absent', 'present', 'correct'];
const PATTERN_LABELS = ['absent', 'misplaced', 'correct'];

// ── Persistence ─────────────────────────────────────────────────────────────

function loadUsedWords() {
    try {
        // Try new frequency format first
        const freqStored = localStorage.getItem('wordle-solver-word-frequencies');
        if (freqStored) {
            wordFrequencies = JSON.parse(freqStored);
        }
        // Migrate legacy flat array if frequencies are empty
        if (Object.keys(wordFrequencies).length === 0) {
            const stored = localStorage.getItem('wordle-solver-used-words');
            if (stored) {
                const oldList = JSON.parse(stored);
                oldList.forEach(w => {
                    wordFrequencies[w.toLowerCase()] = (wordFrequencies[w.toLowerCase()] || 0) + 1;
                });
            }
        }
        // Derive flat list from frequencies
        usedWords = Object.keys(wordFrequencies).sort();
    } catch (e) {
        wordFrequencies = {};
        usedWords = [];
    }
}

function saveUsedWords() {
    try {
        localStorage.setItem('wordle-solver-word-frequencies', JSON.stringify(wordFrequencies));
        // Also save legacy format for backward compat
        localStorage.setItem('wordle-solver-used-words', JSON.stringify(usedWords));
    } catch (e) {}
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
        worker.postMessage({ type: 'setWordFrequencies', data: { freqMap: wordFrequencies } });
        worker.postMessage({ type: 'setJackpotMode', data: { enabled: jackpotMode } });
    } else if (mainThreadSolver) {
        mainThreadSolver.setWordFrequencies(wordFrequencies);
        mainThreadSolver.jackpotMode = jackpotMode;
    }
}

function startNewGame() {
    guessNumber = 1;
    currentPattern = [0, 0, 0, 0, 0];
    knownGreens = [null, null, null, null, null];
    currentGameGuesses = [];

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

            // Auto-solve when only 1 word remains — no need to manually green tiles
            if (remaining === 1) {
                setTimeout(() => markSolved(), 300);
            }
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

    // Auto-solve when only 1 word remains
    if (totalRemaining === 1) {
        setTimeout(() => markSolved(), 300);
    }
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
    // Track for export
    const greens = pattern.filter(p => p === 2).length;
    const oranges = pattern.filter(p => p === 1).length;
    currentGameGuesses.push({ word, pattern: [...pattern], greens, oranges });

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

        // Auto-add solved word to used words list
        addUsedWord(word.toLowerCase());
    } else {
        sessionStats.distribution.fail++;
    }

    // Compute our tile totals from guess log
    const myGreens = currentGameGuesses.reduce((s, g) => s + g.greens, 0);
    const myOranges = currentGameGuesses.reduce((s, g) => s + g.oranges, 0);

    // Persist game to history (match result added later via Save Result button)
    const gameEntry = {
        date: new Date().toISOString(),
        word: word || null,
        guesses: word ? numGuesses : 7,
        won: !!word,
        jackpot: jackpotMode,
        solverVersion: SOLVER_VERSION,
        myGreens,
        myOranges,
        guessLog: currentGameGuesses.map(g => ({ word: g.word, pattern: g.pattern })),
        matchResult: null // filled by Save Result
    };
    gameHistory.push(gameEntry);
    saveGameHistory();

    // Show tile totals in solved text
    if (word) {
        document.getElementById('solved-text').textContent =
            `Found "${word.toUpperCase()}" in ${numGuesses} guess${numGuesses !== 1 ? 'es' : ''}! (${myGreens} green, ${myOranges} orange tiles)`;
    } else {
        const rem = worker ? totalRemaining : mainThreadSolver.remainingAnswers.length;
        document.getElementById('solved-text').textContent =
            `Couldn't solve in 6 guesses. ${rem} words remaining. (${myGreens} green, ${myOranges} orange tiles)`;
    }

    // Show match result form and reset fields
    const matchSection = document.getElementById('match-result-section');
    if (matchSection) {
        matchSection.classList.remove('hidden');
        const oppAttempts = document.getElementById('opp-attempts');
        const oppGreens = document.getElementById('opp-greens');
        const oppOranges = document.getElementById('opp-oranges');
        const oppName = document.getElementById('opp-name');
        if (oppAttempts) oppAttempts.value = '';
        if (oppGreens) oppGreens.value = '';
        if (oppOranges) oppOranges.value = '';
        if (oppName) oppName.value = '';
        document.getElementById('result-saved-msg').classList.add('hidden');
        const autoDisplay = document.getElementById('auto-outcome-display');
        if (autoDisplay) { autoDisplay.classList.add('hidden'); autoDisplay.textContent = ''; }
    }

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

function addUsedWord(word, incrementFrequency = true) {
    word = word.toLowerCase().trim();
    if (word.length !== 5) return;
    if (incrementFrequency) {
        wordFrequencies[word] = (wordFrequencies[word] || 0) + 1;
    } else if (wordFrequencies[word]) {
        return; // already tracked, no change needed
    } else {
        wordFrequencies[word] = 1;
    }
    usedWords = Object.keys(wordFrequencies).sort();
    saveUsedWords();
    renderUsedWordsUI();
    // Update solver with frequency data
    if (worker) {
        worker.postMessage({ type: 'setWordFrequencies', data: { freqMap: wordFrequencies } });
    } else if (mainThreadSolver) {
        mainThreadSolver.setWordFrequencies(wordFrequencies);
    }
}

function removeUsedWord(word) {
    delete wordFrequencies[word];
    usedWords = Object.keys(wordFrequencies).sort();
    saveUsedWords();
    renderUsedWordsUI();
    if (worker) {
        worker.postMessage({ type: 'setWordFrequencies', data: { freqMap: wordFrequencies } });
    } else if (mainThreadSolver) {
        mainThreadSolver.setWordFrequencies(wordFrequencies);
    }
}

function clearUsedWords() {
    if (!confirm(`Clear all ${usedWords.length} used words?`)) return;
    wordFrequencies = {};
    usedWords = [];
    saveUsedWords();
    renderUsedWordsUI();
    if (worker) {
        worker.postMessage({ type: 'setWordFrequencies', data: { freqMap: wordFrequencies } });
    } else if (mainThreadSolver) {
        mainThreadSolver.setWordFrequencies(wordFrequencies);
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

    // H2H win% (exclude solos and games with no match result yet)
    const h2hTotal = h2hStats.wins + h2hStats.losses + h2hStats.draws;
    const h2hWinPct = h2hTotal > 0 ? Math.round((h2hStats.wins / h2hTotal) * 100) : '-';
    const pnlStr = h2hStats.pnl >= 0
        ? `+$${h2hStats.pnl.toFixed(2)}`
        : `-$${Math.abs(h2hStats.pnl).toFixed(2)}`;
    const pnlColor = h2hStats.pnl >= 0 ? 'var(--correct)' : '#e74c3c';

    document.getElementById('stat-played').textContent = games;
    document.getElementById('stat-win-pct').textContent = h2hTotal > 0 ? h2hWinPct + '%' : '-';
    document.getElementById('stat-avg').textContent = avg;

    // Update H2H record and P&L
    const h2hRecordEl = document.getElementById('stat-h2h-record');
    if (h2hRecordEl) h2hRecordEl.textContent = `${h2hStats.wins}W-${h2hStats.losses}L` + (h2hStats.draws > 0 ? `-${h2hStats.draws}D` : '');

    const pnlEl = document.getElementById('stat-pnl');
    if (pnlEl) {
        pnlEl.textContent = pnlStr;
        pnlEl.style.color = pnlColor;
    }

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

    // Only show H2H matched games (not solo)
    const matchedGames = gameHistory.filter(g => g.matchResult && g.matchResult.outcome !== 'solo');
    if (matchedGames.length < 2) {
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

    // Compute cumulative H2H win rate and rolling win rate
    const windowSize = Math.min(10, Math.max(3, Math.floor(matchedGames.length / 3)));
    let cumWins = 0;
    const cumWinRate = [];
    const rollingWinRate = [];
    const outcomes = []; // 1=win, 0=loss, 0.5=draw

    for (let i = 0; i < matchedGames.length; i++) {
        const o = matchedGames[i].matchResult.outcome;
        const val = o === 'win' ? 1 : o === 'draw' ? 0.5 : 0;
        outcomes.push(val);
        cumWins += val;
        cumWinRate.push(cumWins / (i + 1));

        const start = Math.max(0, i - windowSize + 1);
        const slice = outcomes.slice(start, i + 1);
        const avg = slice.reduce((s, v) => s + v, 0) / slice.length;
        rollingWinRate.push(avg);
    }

    // Chart dimensions
    const padLeft = 38;
    const padRight = 12;
    const padTop = 20;
    const padBottom = 28;
    const chartW = cssWidth - padLeft - padRight;
    const chartH = cssHeight - padTop - padBottom;

    const minY = 0;
    const maxY = 1;

    function xPos(i) { return padLeft + (i / (matchedGames.length - 1)) * chartW; }
    function yPos(v) { return padTop + ((maxY - v) / (maxY - minY)) * chartH; }

    // Grid lines at 0%, 25%, 50%, 75%, 100%
    ctx.strokeStyle = '#3a3a3c';
    ctx.lineWidth = 0.5;
    for (const pct of [0, 0.25, 0.5, 0.75, 1.0]) {
        ctx.beginPath();
        ctx.moveTo(padLeft, yPos(pct));
        ctx.lineTo(padLeft + chartW, yPos(pct));
        ctx.stroke();
    }

    // 50% line highlighted (break-even)
    ctx.strokeStyle = '#818384';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, yPos(0.5));
    ctx.lineTo(padLeft + chartW, yPos(0.5));
    ctx.stroke();
    ctx.setLineDash([]);

    // Y-axis labels
    ctx.fillStyle = '#818384';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (const pct of [0, 0.25, 0.5, 0.75, 1.0]) {
        ctx.fillText(Math.round(pct * 100) + '%', padLeft - 6, yPos(pct) + 4);
    }

    // Individual game dots (green=win, red=loss, yellow=draw)
    for (let i = 0; i < matchedGames.length; i++) {
        const o = matchedGames[i].matchResult.outcome;
        ctx.fillStyle = o === 'win' ? 'rgba(83, 141, 78, 0.6)' : o === 'loss' ? 'rgba(231, 76, 60, 0.6)' : 'rgba(181, 159, 59, 0.6)';
        ctx.beginPath();
        ctx.arc(xPos(i), yPos(outcomes[i]), 3.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // Rolling win rate line
    ctx.strokeStyle = '#538d4e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < rollingWinRate.length; i++) {
        const x = xPos(i);
        const y = yPos(rollingWinRate[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Current rolling win rate label
    const currentRate = rollingWinRate[rollingWinRate.length - 1];
    ctx.fillStyle = currentRate >= 0.5 ? '#538d4e' : '#e74c3c';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    const lastX = xPos(matchedGames.length - 1);
    const lastY = yPos(currentRate);
    ctx.fillText(Math.round(currentRate * 100) + '%', Math.min(lastX + 6, cssWidth - 40), lastY + 4);

    // X-axis label
    ctx.fillStyle = '#818384';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${matchedGames.length} H2H games`, padLeft + chartW / 2, cssHeight - 4);

    // All-time H2H stats
    const allTimeWins = matchedGames.filter(g => g.matchResult.outcome === 'win').length;
    const allTimeLosses = matchedGames.filter(g => g.matchResult.outcome === 'loss').length;
    const allTimeDraws = matchedGames.length - allTimeWins - allTimeLosses;
    const allTimePnl = allTimeWins * (WIN_PAYOUT - ENTRY_COST) - allTimeLosses * ENTRY_COST;
    const pnlStr = allTimePnl >= 0 ? `+$${allTimePnl.toFixed(2)}` : `-$${Math.abs(allTimePnl).toFixed(2)}`;

    const statsEl = document.getElementById('perf-all-time');
    if (statsEl) {
        statsEl.innerHTML =
            `<span>All-time H2H: <strong>${allTimeWins}W-${allTimeLosses}L${allTimeDraws > 0 ? '-' + allTimeDraws + 'D' : ''}</strong></span>` +
            `<span>Win rate: <strong>${Math.round((allTimeWins / matchedGames.length) * 100)}%</strong></span>` +
            `<span>P&L: <strong style="color:${allTimePnl >= 0 ? 'var(--correct)' : '#e74c3c'}">${pnlStr}</strong></span>` +
            `<span>Rolling ${windowSize}: <strong style="color:${currentRate >= 0.5 ? 'var(--correct)' : '#e74c3c'}">${Math.round(currentRate * 100)}%</strong></span>`;
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

    // Save match result buttons
    const saveResultBtn = document.getElementById('save-result-btn');
    if (saveResultBtn) {
        saveResultBtn.addEventListener('click', saveMatchResult);
    }

    const saveSoloBtn = document.getElementById('save-solo-btn');
    if (saveSoloBtn) {
        saveSoloBtn.addEventListener('click', saveSoloResult);
    }

    // Export buttons
    const exportJsonBtn = document.getElementById('export-json-btn');
    if (exportJsonBtn) exportJsonBtn.addEventListener('click', exportJSON);

    const exportCsvBtn = document.getElementById('export-csv-btn');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportCSV);

    const copyLogBtn = document.getElementById('copy-log-btn');
    if (copyLogBtn) copyLogBtn.addEventListener('click', copyLogToClipboard);

    const copySessionBtn = document.getElementById('copy-session-btn');
    if (copySessionBtn) copySessionBtn.addEventListener('click', copySessionToClipboard);

    // Set version display
    const versionEl = document.getElementById('version-display');
    if (versionEl) versionEl.textContent = `Lingo Solver v${SOLVER_VERSION}`;

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

// ── Match result reporting ──────────────────────────────────────────────────

function computeH2HOutcome(myAttempts, myGreens, myOranges, oppAttempts, oppGreens, oppOranges) {
    // H2H tiebreakers: 1) fewer attempts, 2) more greens, 3) more oranges, 4) coin_flip
    if (myAttempts < oppAttempts) return { outcome: 'win', reason: 'fewer_attempts' };
    if (myAttempts > oppAttempts) return { outcome: 'loss', reason: 'fewer_attempts' };
    if (myGreens > oppGreens) return { outcome: 'win', reason: 'more_greens' };
    if (myGreens < oppGreens) return { outcome: 'loss', reason: 'more_greens' };
    if (myOranges > oppOranges) return { outcome: 'win', reason: 'more_oranges' };
    if (myOranges < oppOranges) return { outcome: 'loss', reason: 'more_oranges' };
    return { outcome: 'draw', reason: 'coin_flip' };
}

function saveMatchResult() {
    const lastGame = gameHistory[gameHistory.length - 1];
    if (!lastGame) return;

    const oppAttemptsVal = document.getElementById('opp-attempts').value;
    const oppGreensVal = document.getElementById('opp-greens').value;
    const oppOrangesVal = document.getElementById('opp-oranges').value;
    const oppName = document.getElementById('opp-name').value.trim();

    if (!oppAttemptsVal) return; // need at least opponent attempts

    const oppAttempts = parseInt(oppAttemptsVal);
    const oppGreens = parseInt(oppGreensVal) || 0;
    const oppOranges = parseInt(oppOrangesVal) || 0;

    const myAttempts = lastGame.guesses;
    const myGreens = lastGame.myGreens || 0;
    const myOranges = lastGame.myOranges || 0;

    const { outcome, reason } = computeH2HOutcome(myAttempts, myGreens, myOranges, oppAttempts, oppGreens, oppOranges);

    const result = {
        outcome,
        reason,
        oppAttempts,
        oppGreens,
        oppOranges
    };
    if (oppName) result.opponent = oppName;

    lastGame.matchResult = result;
    saveGameHistory();

    // Update H2H session stats
    if (outcome === 'win') { h2hStats.wins++; h2hStats.pnl += WIN_PAYOUT - ENTRY_COST; }
    else if (outcome === 'loss') { h2hStats.losses++; h2hStats.pnl -= ENTRY_COST; }
    else { h2hStats.draws++; }
    updateSessionStats();
    renderPerformanceGraph();

    // Show result
    document.getElementById('result-saved-msg').classList.remove('hidden');
    const autoDisplay = document.getElementById('auto-outcome-display');
    if (autoDisplay) {
        const label = outcome === 'win' ? 'WIN' : outcome === 'loss' ? 'LOSS' : 'DRAW';
        const color = outcome === 'win' ? 'var(--correct)' : outcome === 'loss' ? 'var(--absent)' : 'var(--present)';
        autoDisplay.textContent = `${label} (${reason.replace(/_/g, ' ')})`;
        autoDisplay.style.color = color;
        autoDisplay.classList.remove('hidden');
    }
    setTimeout(() => {
        document.getElementById('result-saved-msg').classList.add('hidden');
    }, 3000);
}

function saveSoloResult() {
    const lastGame = gameHistory[gameHistory.length - 1];
    if (!lastGame) return;

    lastGame.matchResult = { outcome: 'solo' };
    saveGameHistory();

    h2hStats.solos++;
    updateSessionStats();

    document.getElementById('result-saved-msg').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('result-saved-msg').classList.add('hidden');
    }, 2000);
}

// ── Export functions ─────────────────────────────────────────────────────────

function exportJSON() {
    const data = {
        exportDate: new Date().toISOString(),
        solverVersion: SOLVER_VERSION,
        totalGames: gameHistory.length,
        games: gameHistory
    };
    downloadFile(JSON.stringify(data, null, 2), `lingo-solver-log-${dateStamp()}.json`, 'application/json');
    showExportStatus('JSON exported!');
}

function exportCSV() {
    const headers = ['date', 'word', 'guesses', 'won', 'my_greens', 'my_oranges', 'match_outcome', 'opp_attempts', 'opp_greens', 'opp_oranges', 'opponent', 'reason', 'solver_version', 'guess_log'];
    const rows = gameHistory.map(g => {
        const m = g.matchResult || {};
        return [
            g.date, g.word || '', g.guesses, g.won ? 1 : 0,
            g.myGreens ?? '', g.myOranges ?? '',
            m.outcome || '', m.oppAttempts ?? '', m.oppGreens ?? '', m.oppOranges ?? '',
            m.opponent || '', m.reason || '',
            g.solverVersion || '',
            (g.guessLog || []).map(gl => gl.word + ':' + gl.pattern.join('')).join(';')
        ].map(v => `"${v}"`).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    downloadFile(csv, `lingo-solver-log-${dateStamp()}.csv`, 'text/csv');
    showExportStatus('CSV exported!');
}

function copyLogToClipboard() {
    const data = {
        exportDate: new Date().toISOString(),
        solverVersion: SOLVER_VERSION,
        totalGames: gameHistory.length,
        games: gameHistory
    };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
        showExportStatus('Copied all games to clipboard!');
    }).catch(() => {
        showExportStatus('Copy failed — try Export JSON instead.');
    });
}

function copySessionToClipboard() {
    const sessionGames = gameHistory.filter(g => g.date >= SESSION_START_TIME);
    const data = {
        exportDate: new Date().toISOString(),
        sessionStart: SESSION_START_TIME,
        solverVersion: SOLVER_VERSION,
        totalGames: sessionGames.length,
        games: sessionGames
    };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
        showExportStatus(`Copied ${sessionGames.length} session game(s) to clipboard!`);
    }).catch(() => {
        showExportStatus('Copy failed — try Export JSON instead.');
    });
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function dateStamp() {
    return new Date().toISOString().slice(0, 10);
}

function showExportStatus(msg) {
    const el = document.getElementById('export-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.color = 'var(--correct)';
    setTimeout(() => el.classList.add('hidden'), 2500);
}
