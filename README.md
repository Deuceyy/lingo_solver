# Wordle Solver

An entropy-optimized Wordle solver that achieves ~3.40 average guesses with a 100% solve rate.

## How to Use

1. Serve the files with any HTTP server:
   ```bash
   python3 -m http.server 8080
   ```
2. Open `http://localhost:8080` in your browser
3. The solver suggests **SALET** as the optimal first word
4. Type the word into Wordle, then click each letter tile to toggle its color:
   - **Gray** = absent (letter not in word)
   - **Yellow** = misplaced (letter in word, wrong position)
   - **Green** = correct (letter in correct position)
5. Click **Submit Feedback** — the solver computes the next optimal guess
6. Repeat until solved!

## Algorithm

Uses **Shannon entropy maximization** (information-theoretic approach):

- For each candidate guess, computes the distribution of all 243 possible feedback patterns (3^5) against remaining answer words
- Selects the guess with the highest entropy — the one that maximally partitions the remaining candidates
- This provably minimizes expected guesses

### Performance

| Metric | Value |
|--------|-------|
| Average guesses | ~3.40 |
| Solve rate (≤6 guesses) | 100% |
| Most common result | 3 guesses (53%) |
| Answer word bank | 2,315 (NYT) |
| Valid guess words | 14,855 |

## Features

- Click-to-toggle letter feedback (absent → misplaced → correct)
- Turn-by-turn history with letter status summaries for each guess
- Auto-computed optimal next guess via Web Worker (non-blocking UI)
- Manual guess override via text input or clicking any candidate word
- Real-time candidate list and entropy/timing stats
- Responsive dark theme
