"use client";

import { Button, Card } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildInfoLocalDateTimeLabel } from "@/utils/dateTime";
import InlineMusicPlayer from "@/components/InlineMusicPlayer";

type BuildInfo = {
  commitId: string;
  date: string;
  time: string;
};

type BuildInfoResponse = {
  client?: BuildInfo;
  server?: BuildInfo;
};

const UNKNOWN_BUILD_INFO: BuildInfo = {
  commitId: "unknown",
  date: "--------",
  time: "--:--",
};

const CREDIT_NAMES = [
  "@janagraf",
  "@aleexgort",
  "@uIiana",
  "@liun777",
  "@suisu-IT-daigakusei (Jan)",
  "",
  "Audio Sources:",
  "pixabay.com",
  "alkakrab.itch.io",
  "",
  "Video Sources:",
  "Transparent Celebration Stock Videos by Vecteezy",
  "https://www.vecteezy.com/free-videos/transparent-celebration",
];

function toBuildInfo(value: unknown): BuildInfo {
  if (!value || typeof value !== "object") {
    return UNKNOWN_BUILD_INFO;
  }
  const record = value as Record<string, unknown>;
  const commitId = String(record.commitId ?? "").trim() || UNKNOWN_BUILD_INFO.commitId;
  const date = String(record.date ?? "").trim() || UNKNOWN_BUILD_INFO.date;
  const time = String(record.time ?? "").trim() || UNKNOWN_BUILD_INFO.time;
  return { commitId, date, time };
}

function buildInfoLine(label: string, buildInfo: BuildInfo): string {
  return `${label}: ${buildInfo.commitId}, ${buildInfoLocalDateTimeLabel(buildInfo.date, buildInfo.time)}`;
}

export default function CreditsPage() {
  const router = useRouter();
  const [clientBuild, setClientBuild] = useState<BuildInfo>(UNKNOWN_BUILD_INFO);
  const [serverBuild, setServerBuild] = useState<BuildInfo>(UNKNOWN_BUILD_INFO);
  const scrollTrackRef = useRef<HTMLDivElement | null>(null);
  const scrollBlockRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;

    const loadBuildInfo = async () => {
      try {
        const response = await fetch("/api/build-info", {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok || !active) {
          return;
        }

        const payload = await response.json() as BuildInfoResponse;
        if (!active) {
          return;
        }

        setClientBuild(toBuildInfo(payload.client));
        setServerBuild(toBuildInfo(payload.server));
      } catch {
        // keep unknown defaults
      }
    };

    void loadBuildInfo();

    return () => {
      active = false;
    };
  }, []);

  const creditLines = useMemo(() => [
    "Online Cabo",
    "",
    buildInfoLine("Client Build", clientBuild),
    buildInfoLine("Server Build", serverBuild),
    "",
    ...CREDIT_NAMES,
  ], [clientBuild, serverBuild]);

  useEffect(() => {
    const track = scrollTrackRef.current;
    const block = scrollBlockRef.current;
    if (!track || !block) {
      return;
    }

    let frameId = 0;
    let previousMs = 0;
    let offsetPx = 0;
    const speedPxPerSecond = 34;

    const animate = (nowMs: number) => {
      if (previousMs === 0) {
        previousMs = nowMs;
      }
      const elapsedSeconds = (nowMs - previousMs) / 1000;
      previousMs = nowMs;

      const blockHeight = block.offsetHeight;
      if (blockHeight > 0) {
        offsetPx += speedPxPerSecond * elapsedSeconds;
        if (offsetPx >= blockHeight) {
          offsetPx -= blockHeight;
        }
        track.style.transform = `translateY(${-offsetPx}px)`;
      }

      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [creditLines]);

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/dashboard");
  };

  const handleDashboard = () => {
    router.push("/dashboard");
  };

  return (
    <div className="cabo-background">
      <div className="login-container">
        <div className="create-lobby-stack dashboard-stack">
          <Card
            className="dashboard-container"
            title={<div className="dashboard-section-title">Credits</div>}
          >
            <div className="credits-scroll-viewport" aria-label="Credits rolling text">
              <div ref={scrollTrackRef} className="credits-scroll-track">
                <div ref={scrollBlockRef} className="credits-scroll-block">
                  {creditLines.map((line, index) => (
                    <div key={`top-${line}-${index}`} className="credits-line">
                      {line || "\u00A0"}
                    </div>
                  ))}
                </div>
                <div className="credits-scroll-block" aria-hidden="true">
                  {creditLines.map((line, index) => (
                    <div key={`bottom-${line}-${index}`} className="credits-line">
                      {line || "\u00A0"}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card className="dashboard-container">
            <div className="dashboard-nav-row">
              <Button type="default" onClick={handleBack}>
                {"\u2190"} Back
              </Button>
              <Button type="default" onClick={handleDashboard}>
                {"\u2302"} Dashboard
              </Button>
            </div>
          </Card>

          <Card className="dashboard-container dashboard-music-card">
            <InlineMusicPlayer className="dashboard-inline-music-player" />
          </Card>
        </div>
      </div>
    </div>
  );
}
