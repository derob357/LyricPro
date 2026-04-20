import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: "success" | "error" | "info" | "warning";
  duration?: number;
}

interface NotificationToastProps {
  notification: Notification;
  onDismiss: (id: string) => void;
}

export function NotificationToast({ notification, onDismiss }: NotificationToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (notification.duration) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onDismiss(notification.id);
      }, notification.duration);

      return () => clearTimeout(timer);
    }
  }, [notification, onDismiss]);

  if (!isVisible) return null;

  const bgColor = {
    success: "bg-green-500/10 border-green-500/20",
    error: "bg-red-500/10 border-red-500/20",
    info: "bg-blue-500/10 border-blue-500/20",
    warning: "bg-yellow-500/10 border-yellow-500/20",
  }[notification.type];

  const textColor = {
    success: "text-green-300",
    error: "text-red-300",
    info: "text-blue-300",
    warning: "text-yellow-300",
  }[notification.type];

  return (
    <div className={`${bgColor} border rounded-lg p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2`}>
      <div className="flex-1">
        <p className={`${textColor} font-semibold text-sm`}>{notification.title}</p>
        <p className="text-gray-400 text-sm mt-1">{notification.message}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setIsVisible(false);
          onDismiss(notification.id);
        }}
        className="h-6 w-6 p-0"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}

export function NotificationContainer() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = (notification: Omit<Notification, "id">) => {
    const id = `notif_${Date.now()}`;
    const newNotification = {
      ...notification,
      id,
      duration: notification.duration || 5000,
    };

    setNotifications((prev) => [...prev, newNotification]);
  };

  const removeNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  // Expose globally for easy access
  (window as any).showNotification = addNotification;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {notifications.map((notification) => (
        <NotificationToast
          key={notification.id}
          notification={notification}
          onDismiss={removeNotification}
        />
      ))}
    </div>
  );
}
