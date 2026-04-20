/**
 * Invite link utilities for generating and parsing shareable game links
 */

export interface InviteLink {
  code: string;
  url: string;
  expiresAt?: Date;
  maxPlayers?: number;
}

/**
 * Generate a unique invite code
 */
export const generateInviteCode = (): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

/**
 * Create a shareable invite link
 */
export const createInviteLink = (code: string): InviteLink => {
  const baseUrl = window.location.origin;
  return {
    code,
    url: `${baseUrl}/join?code=${code}`,
  };
};

/**
 * Parse invite code from URL
 */
export const parseInviteCode = (url: string): string | null => {
  try {
    const urlObj = new URL(url);
    return urlObj.searchParams.get("code");
  } catch {
    return null;
  }
};

/**
 * Get invite code from current URL
 */
export const getInviteCodeFromUrl = (): string | null => {
  const params = new URLSearchParams(window.location.search);
  return params.get("code");
};

/**
 * Generate share content for invite link
 */
export const getInviteLinkShareContent = (
  hostName: string,
  gameMode: string,
  difficulty: string,
  inviteUrl: string
) => {
  return {
    title: `Join ${hostName}'s LyricPro Game`,
    text: `🎵 ${hostName} invited you to play LyricPro Ai! ${gameMode} mode, ${difficulty} difficulty. Can you beat their score?`,
    url: inviteUrl,
    hashtags: ["LyricPro", "MusicTrivia", "GameInvite"],
  };
};
