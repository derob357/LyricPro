import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ActivityTab } from "./ActivityTab";
import { BansTab } from "./BansTab";
import { AuditLogTab } from "./AuditLogTab";
import { UserLookupTab } from "./UserLookupTab";

type DashboardTab = "activity" | "bans" | "audit" | "users";

export default function AdminChatDashboard() {
  const [tab, setTab] = useState<DashboardTab>("activity");

  return (
    <div className="container max-w-5xl py-6">
      <h1 className="text-2xl font-bold mb-4">Chat Moderation</h1>
      <Tabs value={tab} onValueChange={(v) => setTab(v as DashboardTab)}>
        <TabsList className="grid grid-cols-4">
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="bans">Bans</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
          <TabsTrigger value="users">User Lookup</TabsTrigger>
        </TabsList>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab />
        </TabsContent>
        <TabsContent value="bans" className="mt-4">
          <BansTab />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditLogTab />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UserLookupTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
