"use client";

import { useEffect } from "react";
import AuthLandingPage from "@/components/AuthLandingPage";
import { pauseSharedCaboMusicPlayback } from "@/hooks/useCaboMusicPlayer";

const LoginPage: React.FC = () => {
  useEffect(() => {
    pauseSharedCaboMusicPlayback();
  }, []);

  return <AuthLandingPage />;
};

export default LoginPage;
