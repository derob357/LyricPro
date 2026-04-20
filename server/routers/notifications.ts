import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

// In-memory notification store (replace with DB for production)
const notificationStore = new Map<number, any[]>();

export const notificationRouter = router({
  // Get unread notifications
  getUnreadNotifications: protectedProcedure.query(async ({ ctx }) => {
    const notifications = notificationStore.get(ctx.user.id) || [];
    return notifications.filter((n) => !n.read);
  }),

  // Get all notifications
  getAllNotifications: protectedProcedure.query(async ({ ctx }) => {
    return notificationStore.get(ctx.user.id) || [];
  }),

  // Mark notification as read
  markAsRead: protectedProcedure
    .input(z.object({ notificationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const notifications = notificationStore.get(ctx.user.id) || [];
      const notification = notifications.find((n) => n.id === input.notificationId);

      if (notification) {
        notification.read = true;
      }

      return { success: true };
    }),

  // Mark all as read
  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    const notifications = notificationStore.get(ctx.user.id) || [];
    notifications.forEach((n) => {
      n.read = true;
    });

    return { success: true };
  }),

  // Send test notification
  sendTestNotification: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        message: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const notifications = notificationStore.get(ctx.user.id) || [];

      const notification = {
        id: `notif_${Date.now()}`,
        title: input.title,
        message: input.message,
        type: "test",
        read: false,
        createdAt: new Date(),
      };

      notifications.push(notification);
      notificationStore.set(ctx.user.id, notifications);

      return { success: true, notification };
    }),
});
