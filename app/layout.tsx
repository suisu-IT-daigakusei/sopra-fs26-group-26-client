import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { Suspense } from "react";
import CaboInviteNotifications from "./CaboInviteNotifications";
import FriendRequestNotifications from "./FriendRequestNotifications";
import GameReconnectPrompt from "./GameReconnectPrompt";
import "./styles/globals.css";
import DisconnectHandler from "./components/DisconnectHandler";
import AuthRouteLoadingOverlay from "./components/AuthRouteLoadingOverlay";
import BackgroundPreferenceSync from "./components/BackgroundPreferenceSync";
import ClientThemeProvider from "./components/ClientThemeProvider";
import TabTitleManager from "./components/TabTitleManager";

export const metadata: Metadata = {
  title: "Cabo Game",
  description: "Play Cabo with friends online",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AntdRegistry>
          <ClientThemeProvider>
              <DisconnectHandler />
              <BackgroundPreferenceSync />
              <Suspense fallback={null}>
                <TabTitleManager />
              </Suspense>
              <AuthRouteLoadingOverlay />
              <GameReconnectPrompt />
              <CaboInviteNotifications />
              <FriendRequestNotifications />
              {children}
          </ClientThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
