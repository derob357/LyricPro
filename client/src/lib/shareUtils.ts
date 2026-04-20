/**
 * Social media sharing utility for LyricPro
 * Generates share URLs for multiple platforms
 */

export interface ShareContent {
  title: string;
  text: string;
  url?: string;
  hashtags?: string[];
}

/**
 * Generate share URLs for different platforms
 */
export const generateShareUrls = (content: ShareContent) => {
  const { title, text, url = window.location.origin, hashtags = [] } = content;
  const hashtagString = hashtags.length > 0 ? ` ${hashtags.map(h => `#${h}`).join(" ")}` : "";
  const fullText = text + hashtagString;

  return {
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(fullText)}&url=${encodeURIComponent(url)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(fullText)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(fullText + " " + url)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(fullText)}`,
    instagram: `https://www.instagram.com/`, // Instagram app link
    tiktok: null, // TikTok doesn't support direct sharing via URL
  };
};

/**
 * Open share URL in a new window
 */
export const openShareWindow = (url: string, platform: string) => {
  const width = 550;
  const height = 420;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;
  
  window.open(
    url,
    `share-${platform}`,
    `width=${width},height=${height},left=${left},top=${top},resizable,scrollbars`
  );
};

/**
 * Share to clipboard with fallback
 */
export const shareToClipboard = async (text: string) => {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      return true;
    }
  } catch {
    return false;
  }
};

/**
 * Use native share API if available, otherwise provide platform options
 */
export const nativeShare = async (content: ShareContent) => {
  if (navigator.share) {
    try {
      await navigator.share({
        title: content.title,
        text: content.text,
        url: content.url,
      });
      return true;
    } catch (err) {
      // User cancelled or error occurred
      return false;
    }
  }
  return false;
};

/**
 * Generate homepage share content
 */
export const getHomepageShareContent = (): ShareContent => {
  return {
    title: "LyricPro Ai - Music Trivia Game",
    text: "🎵 I just discovered LyricPro Ai! Complete song lyrics, name the artist, guess the year. Play solo or battle friends across every genre and decade. Join me!",
    url: window.location.origin,
    hashtags: ["LyricPro", "MusicTrivia", "GameChallenge", "LyricGame"],
  };
};

/**
 * Generate individual score share content
 */
export const getScoreShareContent = (
  playerName: string,
  score: number,
  difficulty: string,
  rounds: number,
  shareUrl?: string
): ShareContent => {
  return {
    title: `${playerName}'s LyricPro Score`,
    text: `🎵 I just scored ${score} points on LyricPro Ai! ${difficulty} difficulty, ${rounds} rounds. Can you beat my score?`,
    url: shareUrl || window.location.href,
    hashtags: ["LyricPro", "MusicTrivia", "HighScore", `${difficulty}Difficulty`],
  };
};
