export type Player = "X" | "O";
export type Cell = Player | null;
export type BotLevel = "none" | "easy" | "smart" | "hard";
export type RpsChoice = "rock" | "paper" | "scissors" | "lizard" | "spock";

export type RpsState = {
  picks: Partial<Record<Player, RpsChoice>>;
  lastOutcome?: Player | "tie";
};

export type FinalRpsState = {
  picks: Partial<Record<Player, RpsChoice>>;
  lastOutcome?: Player | "tie";
  score: Record<Player, number>;
  rounds: number;
};

export type MicroBoardState = {
  cells: Cell[]; // length 9
  winner: Player | "CAT" | null;
  rps?: RpsState | null;
};

export type GameState = {
  boards: MicroBoardState[]; // 9 micro boards
  macroWinner: Player | null;
  currentPlayer: Player;
  nextBoard: number | null; // which micro board index must be played next; null = any open
  pendingRpsBoard: number | null;
  pendingFinalRps: boolean;
  finalRps: FinalRpsState | null;
  names: Record<Player, string>;
  bots: Record<Player, BotLevel>;
};

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

export const defaultNames: Record<Player, string> = {
  X: "Player X",
  O: "Player O"
};

export function createEmptyBoard(): MicroBoardState {
  return {
    cells: Array<Cell>(9).fill(null),
    winner: null,
    rps: null
  };
}

export function createInitialState(): GameState {
  return {
    boards: Array.from({ length: 9 }, () => createEmptyBoard()),
    macroWinner: null,
    currentPlayer: "X",
    nextBoard: null,
    pendingRpsBoard: null,
    pendingFinalRps: false,
    finalRps: null,
    names: { ...defaultNames },
    bots: { X: "none", O: "none" }
  };
}

export function boardIsFull(cells: Cell[]): boolean {
  return cells.every(Boolean);
}

export function detectWinner(cells: Cell[]): Player | null {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) {
      return cells[a];
    }
  }
  return null;
}

export function determineMacroWinner(boards: MicroBoardState[]): Player | null {
  const macroCells: Cell[] = boards.map((b) =>
    b.winner === "CAT" ? null : b.winner
  );
  return detectWinner(macroCells);
}

export function getAllowedBoards(state: GameState): number[] {
  if (state.pendingRpsBoard !== null || state.pendingFinalRps) return [];

  if (state.nextBoard === null) {
    return state.boards
      .map((board, idx) => ({ board, idx }))
      .filter(({ board }) => board.winner === null)
      .map(({ idx }) => idx);
  }

  const target = state.boards[state.nextBoard];
  if (target.winner === null) return [state.nextBoard];

  return state.boards
    .map((board, idx) => ({ board, idx }))
    .filter(({ board }) => board.winner === null)
    .map(({ idx }) => idx);
}

export function playMove(
  state: GameState,
  boardIndex: number,
  cellIndex: number
): { state: GameState; error?: string } {
  if (state.pendingRpsBoard !== null) {
    return { state, error: "Finish Rock-Paper-Scissors first." };
  }

  const allowed = getAllowedBoards(state);
  if (!allowed.includes(boardIndex)) {
    return { state, error: "You cannot play in that board right now." };
  }

  const board = state.boards[boardIndex];
  if (board.winner !== null) {
    return { state, error: "That board is already decided." };
  }
  if (board.cells[cellIndex] !== null) {
    return { state, error: "That square is already taken." };
  }

  const updatedBoard: MicroBoardState = {
    ...board,
    cells: [...board.cells]
  };
  updatedBoard.cells[cellIndex] = state.currentPlayer;

  let pendingRpsBoard: number | null = state.pendingRpsBoard;
  let nextBoard: number | null = cellIndex;
  let macroWinner = state.macroWinner;

  const microWinner = detectWinner(updatedBoard.cells);
  if (microWinner) {
    updatedBoard.winner = microWinner;
  } else if (boardIsFull(updatedBoard.cells)) {
    updatedBoard.winner = "CAT";
    updatedBoard.rps = { picks: {}, lastOutcome: undefined };
    pendingRpsBoard = boardIndex;
  }

  const updatedBoards = state.boards.map((b, idx) =>
    idx === boardIndex ? updatedBoard : b
  );

  macroWinner = determineMacroWinner(updatedBoards);
  if (
    nextBoard !== null &&
    updatedBoards[nextBoard] &&
    updatedBoards[nextBoard].winner !== null
  ) {
    nextBoard = null; // target board is closed; next player chooses any open board
  }

  const allBoardsClosed = updatedBoards.every((b) => b.winner !== null);
  if (!macroWinner && allBoardsClosed && pendingRpsBoard === null) {
    pendingFinalRps = true;
    macroWinner = null;
  }

  const nextPlayer: Player = state.currentPlayer === "X" ? "O" : "X";

  return {
    state: {
      ...state,
      boards: updatedBoards,
      macroWinner,
      currentPlayer: nextPlayer,
      nextBoard,
      pendingRpsBoard,
      pendingFinalRps,
      finalRps:
        pendingFinalRps && !state.finalRps
          ? {
              picks: {},
              lastOutcome: undefined,
              score: { X: 0, O: 0 },
              rounds: 0
            }
          : state.finalRps
    }
  };
}

const RPS_RULES: Record<RpsChoice, RpsChoice[]> = {
  rock: ["scissors", "lizard"],
  paper: ["rock", "spock"],
  scissors: ["paper", "lizard"],
  lizard: ["spock", "paper"],
  spock: ["scissors", "rock"]
};

function compareRps(a: RpsChoice, b: RpsChoice): "a" | "b" | "tie" {
  if (a === b) return "tie";
  if (RPS_RULES[a].includes(b)) return "a";
  return "b";
}

const RPS_VERBS: Partial<
  Record<RpsChoice, Partial<Record<RpsChoice, string>>>
> = {
  rock: { scissors: "crushes", lizard: "crushes" },
  paper: { rock: "covers", spock: "disproves" },
  scissors: { paper: "cuts", lizard: "decapitates" },
  lizard: { spock: "poisons", paper: "eats" },
  spock: { scissors: "smashes", rock: "vaporizes" }
};

function rpsVerb(a: RpsChoice, b: RpsChoice): string {
  return RPS_VERBS[a]?.[b] ?? "beats";
}

export function submitRpsChoice(
  state: GameState,
  player: Player,
  choice: RpsChoice
): {
  state: GameState;
  error?: string;
  resolvedRps?: {
    boardIndex: number;
    winner: Player;
    picks: Record<Player, RpsChoice>;
    verb: string;
  };
} {
  if (state.pendingRpsBoard === null) return { state, error: "No RPS pending." };

  const boardIndex = state.pendingRpsBoard;
  const board = state.boards[boardIndex];
  const existing = board.rps ?? { picks: {}, lastOutcome: undefined };

  const picks = { ...existing.picks, [player]: choice };
  const nextTurn = state.currentPlayer;
  let pendingRpsBoard: number | null = state.pendingRpsBoard;
  let updatedBoard: MicroBoardState = { ...board, rps: { ...existing, picks } };
  let macroWinner = state.macroWinner;
  let currentPlayer: Player = state.currentPlayer;
  let resolvedRps:
    | {
        boardIndex: number;
        winner: Player;
        picks: Record<Player, RpsChoice>;
        verb: string;
      }
    | undefined;

  if (picks.X && picks.O) {
    const outcome = compareRps(picks.X, picks.O);
    if (outcome === "tie") {
      updatedBoard = {
        ...updatedBoard,
        rps: { picks: {}, lastOutcome: "tie" }
      };
      currentPlayer = player === "X" ? "O" : "X";
    } else {
      const winningPlayer: Player = outcome === "a" ? "X" : "O";
      updatedBoard = {
        ...updatedBoard,
        winner: winningPlayer,
        rps: { picks, lastOutcome: winningPlayer }
      };
      const picksFull = picks as Record<Player, RpsChoice>;
      resolvedRps = {
        boardIndex,
        winner: winningPlayer,
        picks: picksFull,
        verb:
          outcome === "a"
            ? rpsVerb(picksFull.X, picksFull.O)
            : rpsVerb(picksFull.O, picksFull.X)
      };
      pendingRpsBoard = null;
      const updatedBoards = state.boards.map((b, idx) =>
        idx === boardIndex ? updatedBoard : b
      );
      macroWinner = determineMacroWinner(updatedBoards);

      if (
        !macroWinner &&
        pendingRpsBoard === null &&
        updatedBoards.every((b) => b.winner !== null)
      ) {
        return {
          state: {
            ...state,
            boards: updatedBoards,
            pendingRpsBoard,
            macroWinner,
            currentPlayer: nextTurn,
            pendingFinalRps: true,
            finalRps:
              state.finalRps ?? {
                picks: {},
                lastOutcome: undefined,
                score: { X: 0, O: 0 },
                rounds: 0
              }
          },
          resolvedRps
        };
      }

      return {
        state: {
          ...state,
          boards: updatedBoards,
          pendingRpsBoard,
          macroWinner,
          currentPlayer: nextTurn
        },
        resolvedRps
      };
    }
  } else {
    currentPlayer = player === "X" ? "O" : "X";
  }

  const updatedBoards = state.boards.map((b, idx) =>
    idx === boardIndex ? updatedBoard : b
  );

  if (
    !macroWinner &&
    pendingRpsBoard === null &&
    updatedBoards.every((b) => b.winner !== null)
  ) {
    return {
      state: {
        ...state,
        boards: updatedBoards,
        pendingRpsBoard,
        macroWinner,
        currentPlayer,
        pendingFinalRps: true,
        finalRps:
          state.finalRps ?? {
            picks: {},
            lastOutcome: undefined,
            score: { X: 0, O: 0 },
            rounds: 0
          }
      },
      resolvedRps
    };
  }

  return {
    state: {
      ...state,
      boards: updatedBoards,
      pendingRpsBoard,
      macroWinner,
      currentPlayer
    },
    resolvedRps
  };
}

export function availableMoves(state: GameState): Array<{
  board: number;
  cell: number;
}> {
  const allowedBoards = getAllowedBoards(state);
  const moves: Array<{ board: number; cell: number }> = [];

  for (const boardIndex of allowedBoards) {
    state.boards[boardIndex].cells.forEach((cell, idx) => {
      if (cell === null) moves.push({ board: boardIndex, cell: idx });
    });
  }

  return moves;
}

export function chooseAIMove(
  state: GameState,
  level: BotLevel
): { board: number; cell: number } | null {
  const moves = availableMoves(state);
  if (moves.length === 0) return null;

  if (level === "easy") {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  if (state.pendingRpsBoard !== null) {
    return null;
  }

  // Heuristic minimax: prefer quick wins, block losses, favor strong macro lines.
  const depth = level === "hard" ? 3 : 2;
  const self = state.currentPlayer;

  let bestMove: { board: number; cell: number } | null = null;
  let bestScore = -Infinity;

  for (const move of moves) {
    const clone = cloneState(state);
    const result = playMove(clone, move.board, move.cell);
    const score = minimax(result.state, depth - 1, false, self);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  if (bestMove) return bestMove;

  // Fallback: prefer winning moves, then blocking moves, otherwise center -> corner -> random.
  const opponent: Player = state.currentPlayer === "X" ? "O" : "X";

  const tryScore = (player: Player) => {
    for (const move of moves) {
      const clone = JSON.parse(JSON.stringify(state)) as GameState;
      const result = playMove(clone, move.board, move.cell);
      const boards = result.state.boards;
      const winner = determineMacroWinner(boards);
      if (winner === player) {
        return move;
      }
    }
    return null;
  };

  const winningMove = tryScore(self);
  if (winningMove) return winningMove;

  const blockingMove = tryScore(opponent);
  if (blockingMove) return blockingMove;

  const centerMove = moves.find((m) => m.cell === 4);
  if (centerMove) return centerMove;

  const cornerMove = moves.find((m) => [0, 2, 6, 8].includes(m.cell));
  if (cornerMove) return cornerMove;

  return moves[0];
}

export function randomRpsChoice(): RpsChoice {
  const options: RpsChoice[] = ["rock", "paper", "scissors", "lizard", "spock"];
  return options[Math.floor(Math.random() * options.length)];
}

export function submitFinalRpsChoice(
  state: GameState,
  player: Player,
  choice: RpsChoice
): { state: GameState; error?: string; finalWinner?: Player } {
  if (!state.pendingFinalRps || !state.finalRps) {
    return { state, error: "No final RPSLS pending." };
  }

  const picks = { ...state.finalRps.picks, [player]: choice };
  let finalRps: FinalRpsState = { ...state.finalRps, picks };
  let macroWinner = state.macroWinner;
  let pendingFinalRps = state.pendingFinalRps;
  let currentPlayer: Player = state.currentPlayer;
  let finalWinner: Player | undefined;

  if (picks.X && picks.O) {
    const outcome = compareRps(picks.X, picks.O);
    if (outcome === "tie") {
      finalRps = { ...finalRps, picks: {}, lastOutcome: "tie" };
      currentPlayer = player === "X" ? "O" : "X";
    } else {
      const winningPlayer: Player = outcome === "a" ? "X" : "O";
      finalRps = {
        ...finalRps,
        picks: {},
        lastOutcome: winningPlayer,
        score: {
          ...finalRps.score,
          [winningPlayer]: finalRps.score[winningPlayer] + 1
        },
        rounds: finalRps.rounds + 1
      };
      if (finalRps.score[winningPlayer] + 1 >= 2) {
        macroWinner = winningPlayer;
        pendingFinalRps = false;
        finalWinner = winningPlayer;
      }
      currentPlayer = player === "X" ? "O" : "X";
    }
  } else {
    currentPlayer = player === "X" ? "O" : "X";
  }

  return {
    state: {
      ...state,
      finalRps,
      pendingFinalRps,
      macroWinner,
      currentPlayer
    },
    finalWinner
  };
}

function minimax(
  state: GameState,
  depth: number,
  maximizing: boolean,
  player: Player
): number {
  if (state.macroWinner) {
    return state.macroWinner === player ? 10_000 : -10_000;
  }
  if (depth === 0) {
    return evaluateState(state, player);
  }
  if (state.pendingRpsBoard !== null) {
    return evaluateState(state, player);
  }

  const moves = availableMoves(state);
  if (moves.length === 0) return evaluateState(state, player);

  if (maximizing) {
    let best = -Infinity;
    for (const move of moves) {
      const clone = cloneState(state);
      const result = playMove(clone, move.board, move.cell);
      best = Math.max(best, minimax(result.state, depth - 1, false, player));
    }
    return best;
  }

  let best = Infinity;
  for (const move of moves) {
    const clone = cloneState(state);
    const result = playMove(clone, move.board, move.cell);
    best = Math.min(best, minimax(result.state, depth - 1, true, player));
  }
  return best;
}

function evaluateState(state: GameState, player: Player): number {
  const opponent: Player = player === "X" ? "O" : "X";

  if (state.macroWinner === player) return 5_000;
  if (state.macroWinner === opponent) return -5_000;

  const macroCells: Cell[] = state.boards.map((b) =>
    b.winner === "CAT" ? null : b.winner
  );

  const macroScore = scoreLines(macroCells, player) * 20;

  let microScore = 0;
  state.boards.forEach((board, idx) => {
    if (board.winner === "CAT") return;
    if (board.winner === player) microScore += 50;
    else if (board.winner === opponent) microScore -= 50;
    else {
      const weight = state.nextBoard === null || state.nextBoard === idx ? 1.5 : 1;
      microScore += scoreLines(board.cells, player) * weight;
    }
  });

  return macroScore + microScore;
}

function scoreLines(cells: Cell[], player: Player): number {
  const opponent: Player = player === "X" ? "O" : "X";
  let score = 0;
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const values = [cells[a], cells[b], cells[c]];
    const ours = values.filter((v) => v === player).length;
    const theirs = values.filter((v) => v === opponent).length;
    const empty = values.filter((v) => v === null).length;

    if (theirs === 0) {
      if (ours === 3) score += 100;
      else if (ours === 2 && empty === 1) score += 15;
      else if (ours === 1 && empty === 2) score += 3;
    } else if (ours === 0) {
      if (theirs === 3) score -= 100;
      else if (theirs === 2 && empty === 1) score -= 12;
      else if (theirs === 1 && empty === 2) score -= 2;
    }
  }
  return score;
}

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

export function serializeState(state: GameState): string {
  return JSON.stringify(state);
}

export function parseState(raw: string | null | undefined): GameState {
  if (!raw) return createInitialState();
  try {
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed.boards || parsed.boards.length !== 9) {
      return createInitialState();
    }
    return {
      ...createInitialState(),
      ...parsed
    };
  } catch (err) {
    return createInitialState();
  }
}
