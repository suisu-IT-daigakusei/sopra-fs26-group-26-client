import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { Suspense } from "react";
import CaboInviteNotifications from "./CaboInviteNotifications";
import FriendRequestNotifications from "./FriendRequestNotifications";
import GameReconnectPrompt from "./GameReconnectPrompt";
import "./styles/globals.css";
import DisconnectHandler from "./components/DisconnectHandler";
import PageTransitionLoader from "./components/PageTransitionLoader";
import AuthRouteLoadingOverlay from "./components/AuthRouteLoadingOverlay";
import BackgroundPreferenceSync from "./components/BackgroundPreferenceSync";
import ClientThemeProvider from "./components/ClientThemeProvider";
import TabTitleManager from "./components/TabTitleManager";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cabo",
  description: "sopra-fs26-template-client",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <AntdRegistry>
          <ClientThemeProvider>
              <DisconnectHandler />
              <BackgroundPreferenceSync />
              <Suspense fallback={null}>
                <TabTitleManager />
              </Suspense>
              <AuthRouteLoadingOverlay />
              <Suspense fallback={null}>
              <PageTransitionLoader />
              </Suspense>
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
