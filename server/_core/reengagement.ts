// AI Player Intelligence — Phase 6: Re-engagement Notifications
//
// Scans player_profiles for lapsed users and generates in-app
// notifications. Designed to be called from an admin tRPC route
// or a future cron job.

import { sql, lte } from "drizzle-orm";
import { getDb } from "../db";
import { playerProfiles, users } from "../../drizzle/schema";
import type { PlayerProfileData } from "./playerProfile";

interface ReengagementRule {
  minDaysInactive: number;
  maxDaysInactive: number;
  title: string;
  message: (profile: PlayerProfileData) => string;
  type: string;
}

const RULES: ReengagementRule[] = [
  {
    minDaysInactive: 3,
    maxDaysInactive: 6,
    title: "Your streak is fading",
    message: (p) =>
      p.isStreakPlayer
        ? "Your streak is fading — one quick game to keep it alive."
        : "It's been a few days. A quick round will shake off the rust.",
    type: "reengagement_3day",
  },
  {
    minDaysInactive: 7,
    maxDaysInactive: 13,
    title: "New songs waiting",
    message: (p) => {
      const genre = p.strongestGenres[0];
      return genre
        ? `New songs added this week in ${genre}. Come back and try them.`
        : "New songs added this week. Come back and try them.";
    },
    type: "reengagement_7day",
  },
  {
    minDaysInactive: 14,
    maxDaysInactive: 999,
    title: "We miss you",
    message: () =>
      "We miss you. Come back and show us what you've got.",
    type: "reengagement_14day",
  },
];

// In-memory notification store reference (shared with notifications router).
// Ideally this moves to a DB table in a future migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _notificationStore: Map<number, any[]> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setNotificationStore(store: Map<number, any[]>) {
  _notificationStore = store;
}

export interface ReengagementResult {
  notificationsSent: number;
  usersProcessed: number;
  details: Array<{ userId: number; type: string; message: string }>;
}

export async function sendReengagementNotifications(): Promise<ReengagementResult> {
  const db = await getDb();
  if (!db) return { notificationsSent: 0, usersProcessed: 0, details: [] };

  // Fetch all profiles where the user has been inactive >= 3 days.
  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      userId: playerProfiles.userId,
      profile: playerProfiles.profile,
    })
    .from(playerProfiles)
    .where(lte(playerProfiles.computedAt, cutoff));

  const details: ReengagementResult["details"] = [];

  for (const row of rows) {
    const profile = row.profile as unknown as PlayerProfileData;
    if (!profile || !profile.daysSinceLastGame) continue;

    const days = profile.daysSinceLastGame;

    for (const rule of RULES) {
      if (days >= rule.minDaysInactive && days <= rule.maxDaysInactive) {
        const message = rule.message(profile);

        // Push to in-memory store if available.
        if (_notificationStore) {
          const existing = _notificationStore.get(row.userId) ?? [];
          // Don't send duplicate re-engagement of the same type within 7 days.
          const recentDupe = existing.find(
            (n) => n.type === rule.type && Date.now() - new Date(n.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000,
          );
          if (recentDupe) break;

          existing.push({
            id: `notif_${Date.now()}_${row.userId}`,
            title: rule.title,
            message,
            type: rule.type,
            read: false,
            createdAt: new Date(),
          });
          _notificationStore.set(row.userId, existing);
        }

        details.push({ userId: row.userId, type: rule.type, message });
        break; // Only one notification per user.
      }
    }
  }

  return {
    notificationsSent: details.length,
    usersProcessed: rows.length,
    details,
  };
}
