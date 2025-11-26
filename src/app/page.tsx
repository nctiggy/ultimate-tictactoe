/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  BotLevel,
  GameState,
  Player,
  RpsChoice,
  availableMoves,
  chooseAIMove,
  createInitialState,
  parseState,
  playMove,
  randomRpsChoice,
  serializeState,
  submitRpsChoice
} from "../lib/game";
import { supabase } from "../lib/supabaseClient";

const COOKIE_KEY = "utt_state_v1";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const LOBBY_STALE_MS = 10 * 60 * 1000; // 10 minutes

type RemoteStatus = "idle" | "connecting" | "connected";
type RemoteState = {
  code: string;
  role: RemoteRole;
  status: RemoteStatus;
  opponentOnline: boolean;
  lastEvent?: string;
  spectator: boolean;
};

type RemotePayload =
  | { from: Player; kind: "move"; board: number; cell: number; player: Player }
  | { from: Player; kind: "rps"; choice: RpsChoice; player: Player }
  | { from: Player; kind: "state"; state: GameState };

type RemoteOutbound =
  | { kind: "move"; board: number; cell: number; player: Player }
  | { kind: "rps"; choice: RpsChoice; player: Player }
  | { kind: "state"; state: GameState };

type RemoteRole = Player | "spectator";

const RPS_CHOICES: Array<{ key: RpsChoice; label: string; emoji: string }> = [
  { key: "rock", label: "Rock", emoji: "🪨" },
  { key: "paper", label: "Paper", emoji: "📄" },
  { key: "scissors", label: "Scissors", emoji: "✂️" },
  { key: "lizard", label: "Lizard", emoji: "🦎" },
  { key: "spock", label: "Spock", emoji: "🖖" }
];

const realtimeAvailable = Boolean(supabase);

function randomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp("(^| )" + name + "=([^;]+)")
  );
  return match ? decodeURIComponent(match[2]) : null;
}

function persistState(state: GameState) {
  if (typeof document === "undefined") return;
  const raw = serializeState(state);
  document.cookie = `${COOKIE_KEY}=${encodeURIComponent(raw)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}`;
}

function useAudio() {
  const ctxRef = useRef<AudioContext | null>(null);

  const playTone = (frequency: number, durationMs = 120) => {
    if (typeof window === "undefined") return;
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    const ctx = ctxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = frequency;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  };

  return {
    click: () => playTone(480),
    win: () => {
      playTone(660, 150);
      setTimeout(() => playTone(760, 200), 120);
    },
    rps: () => playTone(340, 160),
    rpsWin: () => {
      const notes = [
        { f: 220, d: 120 },
        { f: 260, d: 120 },
        { f: 300, d: 120 },
        { f: 340, d: 120 },
        { f: 380, d: 120 },
        { f: 220, d: 200 }
      ];
      notes.forEach((n, idx) =>
        setTimeout(() => playTone(n.f, n.d), idx * 70)
      );
    }
  };
}

export default function Home() {
  const [game, setGame] = useState<GameState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteState>({
    code: "",
    role: "X",
    status: "idle",
    opponentOnline: false,
    spectator: false
  });
  const [remoteCodeInput, setRemoteCodeInput] = useState("");
  const [showSetup, setShowSetup] = useState(true);
  const audio = useAudio();
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lobbyChannelRef = useRef<RealtimeChannel | null>(null);
  const clientIdRef = useRef<string>(Math.random().toString(36).slice(2, 10));
  const [lobbyCodes, setLobbyCodes] = useState<
    Array<{ code: string; role: RemoteRole; timestamp: number }>
  >([]);

  useEffect(() => {
    const saved = readCookie(COOKIE_KEY);
    setGame(parseState(saved));
  }, []);

  useEffect(() => {
    if (game) persistState(game);
  }, [game]);

  useEffect(() => {
    if (!supabase) return;
    const lobby = supabase.channel("utt-lobby", {
      config: { presence: { key: clientIdRef.current } }
    });
    lobbyChannelRef.current = lobby;

    lobby
      .on("presence", { event: "sync" }, () => {
        const state = lobby.presenceState() as Record<
          string,
          Array<{ code?: string; role?: RemoteRole; timestamp?: number }>
        >;
        const codes: Array<{ code: string; role: RemoteRole; timestamp: number }> = [];
        Object.entries(state).forEach(([_, arr]) => {
          arr.forEach((entry) => {
            if (entry.code) {
              codes.push({
                code: entry.code,
                role: entry.role ?? "spectator",
                timestamp: entry.timestamp ?? Date.now()
              });
            }
          });
        });
        setLobbyCodes(
          codes
            .filter((c) => Date.now() - c.timestamp < LOBBY_STALE_MS)
            .sort((a, b) => b.timestamp - a.timestamp)
            .filter(
              (item, idx, self) =>
                idx === self.findIndex((x) => x.code === item.code)
            )
        );
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          lobby
            .track({
              lobby: true,
              timestamp: Date.now()
            })
            .catch(() => {});
        }
      });

    return () => {
      lobby.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const lobby = lobbyChannelRef.current;
    if (!lobby) return;
    if (remote.status === "connected" && remote.code) {
      lobby
        .track({
          code: remote.code,
          role: remote.role,
          timestamp: Date.now()
        })
        .catch(() => {});
    } else {
      lobby
        .track({
          lobby: true,
          timestamp: Date.now()
        })
        .catch(() => {});
    }
  }, [remote.status, remote.code, remote.role]);

  useEffect(() => {
    const lobby = lobbyChannelRef.current;
    if (!lobby) return;
    const interval = setInterval(() => {
      if (remote.status === "connected" && remote.code) {
        lobby
          .track({
            code: remote.code,
            role: remote.role,
            timestamp: Date.now()
          })
          .catch(() => {});
      } else {
        lobby
          .track({
            lobby: true,
            timestamp: Date.now()
          })
          .catch(() => {});
      }
    }, 25_000);
    return () => clearInterval(interval);
  }, [remote.status, remote.code, remote.role]);

  useEffect(() => {
    if (!game || game.macroWinner) return;
    const bot = game.bots[game.currentPlayer];
    if (bot === "none") return;

    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => {
      setGame((prev) => {
        if (!prev || prev.macroWinner) return prev;
        if (prev.currentPlayer !== game.currentPlayer) return prev;

        if (prev.pendingRpsBoard !== null) {
          const choice = randomRpsChoice();
          const result = submitRpsChoice(prev, prev.currentPlayer, choice);
          return result.state;
        }

        const move = chooseAIMove(prev, bot);
        if (!move) return prev;
        const result = playMove(prev, move.board, move.cell);
        return result.state;
      });
    }, 420);

    return () => {
      if (aiTimer.current) clearTimeout(aiTimer.current);
    };
  }, [game]);

  useEffect(() => {
    return () => {
      channelRef.current?.unsubscribe();
    };
  }, []);

  const disconnectRemote = () => {
    channelRef.current?.unsubscribe();
    channelRef.current = null;
    setRemote((prev) => ({
      ...prev,
      status: "idle",
      opponentOnline: false,
      lastEvent: undefined,
      spectator: false
    }));
    setShowSetup(true);
  };

  const handleRemotePayload = (payload: RemotePayload) => {
    if (!game) return;
    if (remote.role !== "spectator" && payload.from === remote.role) return;
    setRemote((prev) => ({ ...prev, lastEvent: `${payload.kind}` }));

    if (payload.kind === "move") {
      setGame((prev) => {
        if (!prev) return prev;
        const result = playMove(prev, payload.board, payload.cell);
        return result.state;
      });
      setMessage(null);
      return;
    }

    if (payload.kind === "rps") {
      setGame((prev) => {
        if (!prev) return prev;
        const result = submitRpsChoice(prev, payload.player, payload.choice);
        return result.state;
      });
      setMessage(null);
      return;
    }

    if (payload.kind === "state") {
      setGame(payload.state);
      setMessage("Synced remote state.");
    }
  };

  const sendRemoteEvent = (payload: RemoteOutbound) => {
    if (remote.status !== "connected") return;
    channelRef.current?.send({
      type: "broadcast",
      event: "game",
      payload: { ...payload, from: remote.role }
    });
  };

  const sendRemoteStateSnapshot = (channel?: RealtimeChannel) => {
    if (!game) return;
    const target = channel ?? channelRef.current;
    if (!target) return;
    target.send({
      type: "broadcast",
      event: "game",
      payload: { kind: "state", state: game, from: remote.role }
    });
    setRemote((prev) => ({ ...prev, lastEvent: "state" }));
    setMessage("Shared full state with opponent.");
  };

  const connectRemote = (code: string, role: RemoteRole) => {
    setShowSetup(false);
    if (!supabase) {
      setMessage("Supabase Realtime not configured. Add env vars.");
      return;
    }
    disconnectRemote();
    setGame((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        bots: { X: "none", O: "none" }
      };
    });
    setRemote({
      code,
      role,
      status: "connecting",
      opponentOnline: false,
      spectator: role === "spectator"
    });

    const channel = supabase.channel(`utt-${code}`, {
      config: { presence: { key: role } }
    });
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "game" }, ({ payload }) =>
        handleRemotePayload(payload as RemotePayload)
      )
      .on("presence", { event: "sync" }, () => {
        const others = channel.presenceState();
        const othersOnline = Object.keys(others).some((k) => k !== role);
        setRemote((prev) => ({ ...prev, opponentOnline: othersOnline }));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (role !== "spectator") {
            channel
              .track({ role, name: game?.names[role] ?? role })
              .catch(() => {});
          } else {
            channel.track({ role, name: "spectator" }).catch(() => {});
          }
          setRemote((prev) => ({ ...prev, status: "connected" }));
          setMessage(`Connected to match ${code}`);
          sendRemoteStateSnapshot(channel);
        }
      });
  };

  const status = useMemo(() => {
    if (!game) return "Loading...";
    if (game.macroWinner) {
      return `${game.names[game.macroWinner]} wins the galaxy!`;
    }
    if (game.pendingRpsBoard !== null) {
      return "Resolve the tied board with Rock Paper Scissors Lizard Spock";
    }
    return `${game.names[game.currentPlayer]}'s turn (${game.currentPlayer})`;
  }, [game]);

  const handleCellClick = (boardIndex: number, cellIndex: number) => {
    if (!game || game.macroWinner) return;

    if (
      remote.status === "connected" &&
      remote.role !== game.currentPlayer &&
      remote.role !== "spectator" &&
      game.bots[game.currentPlayer] === "none"
    ) {
      setMessage("Waiting for opponent to move.");
      return;
    }

    const actor = game.currentPlayer;
    const result = playMove(game, boardIndex, cellIndex);
    setGame(result.state);

    if (result.error) setMessage(result.error);
    else setMessage(null);
    if (!result.error) {
      if (result.state.pendingRpsBoard !== null) audio.rps();
      else audio.click();
      if (result.state.macroWinner) audio.win();
      if (
        remote.status === "connected" &&
        game.bots[actor] === "none" &&
        remote.role === actor
      ) {
        sendRemoteEvent({
          kind: "move",
          board: boardIndex,
          cell: cellIndex,
          player: actor
        });
      }
    }
  };

  const handleRpsChoice = (choice: RpsChoice) => {
    if (!game) return;
    if (
      remote.status === "connected" &&
      remote.role !== game.currentPlayer &&
      remote.role !== "spectator" &&
      game.bots[game.currentPlayer] === "none"
    ) {
      setMessage("Waiting for opponent to pick.");
      return;
    }

    const actor = game.currentPlayer;
    const result = submitRpsChoice(game, game.currentPlayer, choice);
    setGame(result.state);

      if (
        remote.status === "connected" &&
        game.bots[actor] === "none" &&
        remote.role === actor
      ) {
        sendRemoteEvent({
          kind: "rps",
          choice,
          player: actor
      });
    }

    if (result.error) {
      setMessage(result.error);
      return;
    }

    if (result.resolvedRps) {
      const { winner, picks, verb } = result.resolvedRps;
      const loser: "X" | "O" = winner === "X" ? "O" : "X";
      const winnerMove = picks[winner];
      const loserMove = picks[loser];
      const msg = `${winnerMove.toUpperCase()} ${verb} ${loserMove.toUpperCase()} — ${game.names[winner]} takes the square`;
      setMessage(msg);
      audio.rpsWin();
      if (result.state.macroWinner) audio.win();
    } else if (result.state.pendingRpsBoard !== null) {
      setMessage("Tie! Throw again.");
      audio.rps();
    } else {
      setMessage(null);
    }
  };

  const resetGame = () => {
    const bots = game?.bots ?? { X: "none", O: "none" };
    const names = game?.names ?? { X: "Player X", O: "Player O" };
    const fresh = createInitialState();
    fresh.bots = bots;
    fresh.names = names;
    setGame(fresh);
    setMessage(null);
  };

  const updateName = (player: "X" | "O", value: string) => {
    if (!game) return;
    setGame({ ...game, names: { ...game.names, [player]: value } });
  };

  const updateBot = (player: "X" | "O", level: BotLevel) => {
    if (!game) return;
    setGame({ ...game, bots: { ...game.bots, [player]: level } });
  };

  const updateRemoteRole = (role: RemoteRole) => {
    setRemote((prev) => ({ ...prev, role, spectator: role === "spectator" }));
  };

  if (!game) return <main className="p-8 text-center">Loading…</main>;

  const allowedBoards = game
    ? Array.from(new Set(availableMoves(game).map((m) => m.board)))
    : [];
  const inSession = remote.status === "connected";

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-6 lg:flex-row">
        <section className="glass rounded-2xl p-6 grow border border-slate-800/60">
          <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-slate-400">Ultimate Tic Tac Toe</p>
              <h1 className="text-3xl font-bold">Nine boards, one champion</h1>
            </div>
            <div className="flex items-center gap-2">
              {inSession && remote.code && (
                <div className="px-3 py-1 rounded-full border border-indigo-400/40 bg-indigo-500/10 text-indigo-100 text-xs">
                  Code: {remote.code} · Role: {remote.role}
                </div>
              )}
              <button
                onClick={() => {
                  if (inSession) {
                    const ok = window.confirm(
                      "Leave current match and reset locally?"
                    );
                    if (!ok) return;
                    disconnectRemote();
                  }
                  resetGame();
                }}
                className={clsx(
                  "px-4 py-2 rounded-xl border transition",
                  inSession
                    ? "bg-amber-500/15 text-amber-100 border-amber-400/40 hover:bg-amber-500/25"
                    : "bg-emerald-500/20 text-emerald-200 border-emerald-400/30 hover:bg-emerald-500/30"
                )}
              >
                {inSession ? "Leave & reset" : "New match"}
              </button>
            </div>
          </header>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span
              className={clsx(
                "px-3 py-1 rounded-full border",
                game.currentPlayer === "X"
                  ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                  : "border-pink-400/40 bg-pink-400/10 text-pink-200"
              )}
            >
              {status}
            </span>
            {game.nextBoard !== null && game.pendingRpsBoard === null && (
              <span className="text-slate-400">
                Play in board {game.nextBoard + 1}
              </span>
            )}
            {message && (
              <span className="text-amber-200 bg-amber-500/10 border border-amber-400/30 px-3 py-1 rounded-full">
                {message}
              </span>
            )}
            {inSession && (
              <button
                onClick={() => setShowSetup((s) => !s)}
                className="px-3 py-1 rounded-lg border border-slate-700 bg-slate-800/60 text-xs text-slate-200 hover:border-slate-500/60"
              >
                {showSetup ? "Hide setup" : "Show setup"}
              </button>
            )}
          </div>

          {game.macroWinner && (
            <div className="mt-4 p-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 flex items-center justify-between">
              <div>
                <p className="text-sm text-emerald-200/90">Champion</p>
                <p className="text-2xl font-bold text-emerald-100">
                  {game.names[game.macroWinner]} wins the galaxy!
                </p>
              </div>
              <div className="text-4xl animate-bounce">🏆</div>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
            <div className="bg-slate-900/40 rounded-2xl p-4 border border-slate-800/60 shadow-glow">
              <BigBoard
                game={game}
                allowedBoards={allowedBoards}
                onCellClick={handleCellClick}
              />
            </div>
            {showSetup && (
              <aside className="bg-slate-900/30 rounded-2xl border border-slate-800/60 p-4 flex flex-col gap-4">
                <h2 className="font-semibold text-lg">Match Setup</h2>
                <PlayerCard
                  player="X"
                  name={game.names.X}
                  botLevel={game.bots.X}
                  onNameChange={updateName}
                  onBotChange={updateBot}
                />
                <PlayerCard
                  player="O"
                  name={game.names.O}
                  botLevel={game.bots.O}
                  onNameChange={updateName}
                  onBotChange={updateBot}
                />
                <RemoteCard
                  remote={remote}
                  codeInput={remoteCodeInput}
                  onCodeChange={setRemoteCodeInput}
                  onConnect={connectRemote}
                  onDisconnect={disconnectRemote}
                  onRoleChange={updateRemoteRole}
                  realtimeAvailable={realtimeAvailable}
                  lobbies={lobbyCodes}
                />
                <div className="text-sm text-slate-400 space-y-2">
                  <p>
                    Last move decides the next micro-board. If that board is
                    already closed, you can play anywhere.
                  </p>
                  <p>
                    Cat&apos;s games trigger Rock Paper Scissors Lizard Spock to
                    claim the square. Ties go again.
                  </p>
                  <p className="text-slate-500">State saves locally via cookies.</p>
                </div>
              </aside>
            )}
          </div>
        </section>
      </div>

      {game.pendingRpsBoard !== null && (
        <RpsOverlay
          boardIndex={game.pendingRpsBoard}
          currentPlayer={game.currentPlayer}
          onPick={handleRpsChoice}
        />
      )}
    </main>
  );
}

function BigBoard({
  game,
  allowedBoards,
  onCellClick
}: {
  game: GameState;
  allowedBoards: number[];
  onCellClick: (boardIndex: number, cellIndex: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {game.boards.map((board, idx) => (
        <div
          key={idx}
          className={clsx(
            "relative rounded-xl border border-slate-800/70 bg-slate-900/60 p-2 transition-shadow",
            allowedBoards.includes(idx) && "shadow-[0_0_0_2px_rgba(56,189,248,0.35)]",
            board.winner && "border-slate-700/70"
          )}
        >
          {board.winner && (
            <div className="absolute inset-0 flex items-center justify-center backdrop-blur-[1px] bg-slate-950/40">
              <div
                className={clsx(
                  "text-6xl font-black drop-shadow-lg px-4 py-2 rounded-lg border shadow-glow scale-110",
                  board.winner === "X"
                    ? "text-cyan-200 border-cyan-400/40 bg-cyan-500/10"
                    : board.winner === "O"
                    ? "text-pink-200 border-pink-400/40 bg-pink-500/10"
                    : "text-amber-200 border-amber-400/40 bg-amber-500/10"
                )}
              >
                {board.winner === "CAT" ? "CAT" : board.winner}
              </div>
            </div>
          )}
          <div
            className={clsx(
              "grid grid-cols-3 gap-1",
              board.winner && "opacity-40 pointer-events-none"
            )}
          >
            {board.cells.map((cell, cellIdx) => (
              <button
                key={cellIdx}
                onClick={() => onCellClick(idx, cellIdx)}
                className={clsx(
                  "aspect-square rounded-lg bg-slate-800/60 border border-slate-700/70 flex items-center justify-center text-2xl font-semibold transition hover:-translate-y-0.5 hover:border-slate-500/70",
                  cell === "X" && "text-cyan-200",
                  cell === "O" && "text-pink-200",
                  board.winner && "opacity-70"
                )}
              >
                {cell || ""}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PlayerCard({
  player,
  name,
  botLevel,
  onNameChange,
  onBotChange
}: {
  player: "X" | "O";
  name: string;
  botLevel: BotLevel;
  onNameChange: (player: "X" | "O", name: string) => void;
  onBotChange: (player: "X" | "O", level: BotLevel) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-800/70 p-3 bg-slate-900/50 space-y-2">
      <div className="flex items-center gap-2 justify-between">
        <div
          className={clsx(
            "px-3 py-1 rounded-full text-xs font-semibold",
            player === "X"
              ? "bg-cyan-500/15 text-cyan-200 border border-cyan-400/30"
              : "bg-pink-500/15 text-pink-200 border border-pink-400/30"
          )}
        >
          {player === "X" ? "Player X" : "Player O"}
        </div>
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          {botLevel === "none" ? "Human" : `AI: ${botLevel}`}
        </span>
      </div>
      <input
        value={name}
        onChange={(e) => onNameChange(player, e.target.value)}
        className="w-full rounded-lg bg-slate-800/60 border border-slate-700/80 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
        placeholder="Name"
      />
      <div className="flex gap-2 text-xs">
        {(["none", "easy", "smart", "hard"] as BotLevel[]).map((level) => (
          <button
            key={level}
            onClick={() => onBotChange(player, level)}
            className={clsx(
              "px-3 py-2 rounded-lg border flex-1 transition",
              botLevel === level
                ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
                : "border-slate-700/70 bg-slate-800/60 text-slate-300 hover:border-slate-500/60"
            )}
          >
            {level === "none"
              ? "Human"
              : level === "easy"
              ? "AI: Easy"
              : level === "smart"
              ? "AI: Smart"
              : "AI: Hard"}
          </button>
        ))}
      </div>
    </div>
  );
}

function RpsOverlay({
  boardIndex,
  currentPlayer,
  onPick
}: {
  boardIndex: number;
  currentPlayer: "X" | "O";
  onPick: (choice: RpsChoice) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-20">
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6 max-w-md w-full shadow-2xl space-y-4">
        <p className="text-sm text-slate-400">
          Board {boardIndex + 1} is a cat&apos;s game. Throw down Rock Paper Scissors
          Lizard Spock!
        </p>
        <div className="flex items-center justify-between">
          <div className="px-3 py-1 rounded-full text-xs uppercase tracking-wide bg-indigo-500/15 text-indigo-200 border border-indigo-400/40">
            {currentPlayer}&apos;s pick
          </div>
          <span className="text-xs text-slate-500 text-right">
            Best of 1 · pass the device after you choose
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {RPS_CHOICES.map((c) => (
            <button
              key={c.key}
              onClick={() => onPick(c.key)}
              className="rounded-xl border border-slate-700/70 bg-slate-800/60 hover:border-cyan-400/60 hover:bg-cyan-500/10 transition px-3 py-3 flex items-center gap-2 text-left"
            >
              <span className="text-xl">{c.emoji}</span>
              <div>
                <div className="font-semibold">{c.label}</div>
                <div className="text-[11px] text-slate-500">{c.key}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function RemoteCard({
  remote,
  codeInput,
  onCodeChange,
  onConnect,
  onDisconnect,
  onRoleChange,
  realtimeAvailable,
  lobbies
}: {
  remote: RemoteState;
  codeInput: string;
  onCodeChange: (code: string) => void;
  onConnect: (code: string, role: RemoteRole) => void;
  onDisconnect: () => void;
  onRoleChange: (role: RemoteRole) => void;
  realtimeAvailable: boolean;
  lobbies: Array<{ code: string; role: RemoteRole; timestamp: number }>;
}) {
  const handleHost = (role: Player) => {
    onRoleChange(role);
    const code = (codeInput || randomCode()).toUpperCase();
    onCodeChange(code);
    onConnect(code, role);
  };

  const handleJoin = (role: Player) => {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    onRoleChange(role);
    onConnect(code, role);
  };

  return (
    <div className="rounded-xl border border-slate-800/70 p-3 bg-slate-900/50 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Remote play (Supabase)</h3>
        <span
          className={clsx(
            "px-2 py-1 rounded-full text-[11px] uppercase tracking-wide border",
            remote.status === "connected"
              ? "border-emerald-400/40 text-emerald-200 bg-emerald-500/10"
              : remote.status === "connecting"
              ? "border-amber-400/40 text-amber-200 bg-amber-500/10"
              : "border-slate-600 text-slate-300 bg-slate-800/60"
          )}
        >
          {remote.status}
        </span>
      </div>
      {!realtimeAvailable && (
        <p className="text-xs text-amber-300">
          Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable
          remote games.
        </p>
      )}
      <div className="flex gap-2">
        <input
          value={codeInput}
          onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
          className="flex-1 rounded-lg bg-slate-800/60 border border-slate-700/80 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
          placeholder="Match code"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => handleHost("X")}
          disabled={!realtimeAvailable}
          className="flex-1 px-3 py-2 rounded-lg border border-cyan-400/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-40"
        >
          Host as X
        </button>
        <button
          onClick={() => handleHost("O")}
          disabled={!realtimeAvailable}
          className="flex-1 px-3 py-2 rounded-lg border border-cyan-400/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-40"
        >
          Host as O
        </button>
        <button
          onClick={onDisconnect}
          disabled={remote.status === "idle"}
          className="px-3 py-2 rounded-lg border border-slate-600 bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 disabled:opacity-40"
        >
          Leave
        </button>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => handleJoin("X")}
          disabled={!realtimeAvailable || !codeInput}
          className="flex-1 px-3 py-2 rounded-lg border border-indigo-400/40 bg-indigo-500/10 text-indigo-100 hover:bg-indigo-500/20 disabled:opacity-40"
        >
          Join as X
        </button>
        <button
          onClick={() => handleJoin("O")}
          disabled={!realtimeAvailable || !codeInput}
          className="flex-1 px-3 py-2 rounded-lg border border-indigo-400/40 bg-indigo-500/10 text-indigo-100 hover:bg-indigo-500/20 disabled:opacity-40"
        >
          Join as O
        </button>
        <button
          onClick={() => onConnect(codeInput.trim().toUpperCase(), "spectator")}
          disabled={!realtimeAvailable || !codeInput}
          className="px-3 py-2 rounded-lg border border-slate-600 bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 disabled:opacity-40"
        >
          Spectate
        </button>
      </div>
      <div className="text-xs text-slate-400 space-y-1">
        <p>Share the code to play across devices.</p>
        <p>
          Opponent:{" "}
          <span
            className={
              remote.opponentOnline ? "text-emerald-200" : "text-slate-500"
            }
          >
            {remote.opponentOnline ? "online" : "waiting"}
          </span>
        </p>
        {remote.code && (
          <p className="text-slate-300">
            Current code: <span className="font-mono">{remote.code}</span>
          </p>
        )}
        {remote.lastEvent && (
          <p className="text-slate-500">Last sync: {remote.lastEvent}</p>
        )}
        <div className="mt-2 space-y-2">
          <p className="text-slate-300">Open lobbies:</p>
          {lobbies.length === 0 && (
            <p className="text-slate-500">No lobbies yet. Host or join one.</p>
          )}
          {lobbies.slice(0, 5).map((lobby) => (
            <div
              key={lobby.code}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/60 bg-slate-800/50 px-3 py-2"
            >
              <div>
                <div className="font-mono text-sm text-slate-100">{lobby.code}</div>
                <div className="text-[11px] text-slate-500">
                  host: {lobby.role === "spectator" ? "unknown" : lobby.role}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onCodeChange(lobby.code);
                    onConnect(lobby.code, "spectator");
                  }}
                  className="px-2 py-1 text-xs rounded-md border border-slate-600 bg-slate-900 hover:border-slate-400/70"
                >
                  Spectate
                </button>
                <button
                  onClick={() => {
                    onCodeChange(lobby.code);
                    onConnect(lobby.code, "X");
                  }}
                  className="px-2 py-1 text-xs rounded-md border border-cyan-400/50 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                >
                  Join X
                </button>
                <button
                  onClick={() => {
                    onCodeChange(lobby.code);
                    onConnect(lobby.code, "O");
                  }}
                  className="px-2 py-1 text-xs rounded-md border border-emerald-400/50 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                >
                  Join O
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
