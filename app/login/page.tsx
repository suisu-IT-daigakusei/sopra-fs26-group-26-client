"use client";

import { useEffect } from "react";
import AuthLandingPage from "@/components/AuthLandingPage";
import { pauseSharedCaboMusicPlayback, primeSharedCaboMusicAutoplay } from "@/hooks/useCaboMusicPlayer";

const LoginPage: React.FC = () => {
  useEffect(() => {
    pauseSharedCaboMusicPlayback();
    primeSharedCaboMusicAutoplay(true);
  }, []);

  return <AuthLandingPage />;
};

export default LoginPage;
