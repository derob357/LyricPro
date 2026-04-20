import React, { createContext, useContext, useState, useCallback } from "react";

export type GameMode = "solo" | "multiplayer" | "team";
export type RankingMode = "total_points" | "speed_bonus" | "streak_bonus";
export type Difficulty = "low" | "medium" | "high";

export interface GameConfig {
  mode: GameMode;
  rankingMode: RankingMode;
  genres: string[];
  decades: string[];
  difficulty: Difficulty;
  timerSeconds: number;
  rounds: number;
  explicitFilter: boolean;
}

export interface Player {
  id: string;
  name: string;
  isGuest: boolean;
  teamId?: string;
  score: number;
  streak: number;
  isReady: boolean;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  score: number;
}

export interface SongPrompt {
  id: number;
  title: string;
  artistName: string;
  lyricPrompt: string;
  lyricAnswer: string;
  releaseYear: number;
  genre: string;
  decade: string;
  difficulty: string;
  artistMetadata?: {
    officialWebsite?: string;
    instagramUrl?: string;
    facebookUrl?: string;
    xUrl?: string;
    tiktokUrl?: string;
    youtubeUrl?: string;
    spotifyUrl?: string;
    appleMusicUrl?: string;
    newsSearchUrl?: string;
  };
}

export interface RoundAnswer {
  playerId: string;
  lyricAnswer: string;
  artistAnswer: string;
  yearAnswer: string;
  passUsed: boolean;
  responseTime: number;
  lyricPoints: number;
  artistPoints: number;
  yearPoints: number;
  speedBonus: number;
  streakBonus: number;
  total: number;
}

export interface GameState {
  roomCode: string;
  config: GameConfig;
  players: Player[];
  teams: Team[];
  currentRound: number;
  currentPlayerIndex: number;
  currentSong: SongPrompt | null;
  roundAnswers: RoundAnswer[];
  isGameOver: boolean;
  guestNickname: string | null;
  guestToken: string | null;
}

interface GameContextType {
  gameState: GameState | null;
  setGameState: (state: GameState | null) => void;
  updatePlayerScore: (playerId: string, points: number) => void;
  setGuestInfo: (nickname: string, token: string) => void;
  clearGame: () => void;
}

const GameContext = createContext<GameContextType | null>(null);

const DEFAULT_CONFIG: GameConfig = {
  mode: "solo",
  rankingMode: "total_points",
  genres: [],
  decades: [],
  difficulty: "medium",
  timerSeconds: 30,
  rounds: 10,
  explicitFilter: false,
};

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [gameState, setGameState] = useState<GameState | null>(null);

  const updatePlayerScore = useCallback((playerId: string, points: number) => {
    setGameState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        players: prev.players.map(p =>
          p.id === playerId ? { ...p, score: p.score + points } : p
        ),
      };
    });
  }, []);

  const setGuestInfo = useCallback((nickname: string, token: string) => {
    setGameState(prev => prev ? { ...prev, guestNickname: nickname, guestToken: token } : prev);
  }, []);

  const clearGame = useCallback(() => {
    setGameState(null);
  }, []);

  return (
    <GameContext.Provider value={{ gameState, setGameState, updatePlayerScore, setGuestInfo, clearGame }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}
