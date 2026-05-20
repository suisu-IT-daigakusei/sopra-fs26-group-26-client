"use client";

import React, { useEffect } from "react";

interface GameTutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const GameTutorialModal: React.FC<GameTutorialModalProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="game-tutorial-overlay" 
      onClick={onClose}
      style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)", 
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, backdropFilter: "blur(4px)" 
      }}
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="dashboard-container"
        style={{
          width: "90%",
          maxWidth: "600px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          padding: "24px"
        }}
      >
        <div style={{ paddingBottom: "16px", borderBottom: "1px solid rgba(128,128,128,0.2)", marginBottom: "16px" }}>
          <h2 style={{ color: "var(--cabo-primary-color)", fontSize: "24px" }}>CABO Tutorial & Guide</h2>
        </div>

        <div style={{ overflowY: "auto", lineHeight: "1.6", color: "var(--cabo-text-color)" }}>
          <h3 style={{ color: "var(--cabo-primary-color)", marginTop: 0, marginBottom: "8px" }}>Navigation & Lobby</h3>
          <p style={{ marginBottom: "12px" }}>Welcome to Online-CABO! Here is how you get around the platform:</p>
          <ul style={{ paddingLeft: "20px", marginBottom: "16px" }}>
            <li style={{ marginBottom: "8px" }}><strong>Dashboard:</strong> Your central hub. Look at your win rate, stats, or access settings.</li>
            <li style={{ marginBottom: "8px" }}><strong>Join a Game:</strong> Enter an existing lobby using a shared lobby ID or browse public games.</li>
            <li style={{ marginBottom: "8px" }}><strong>Create a New Lobby:</strong> Host your own game, customize settings, and invite friends.</li>
            <li style={{ marginBottom: "8px" }}><strong>Leaderboard:</strong> Check out the &quot;Users & Leaderboard&quot; section to see how other players are performing.</li>
          </ul>

          <h3 style={{ color: "var(--cabo-primary-color)", marginTop: "20px", marginBottom: "8px" }}>Objective</h3>
          <p style={{ marginBottom: "16px" }}>The goal of CABO is to minimize the total value of your cards by the time the game ends.</p>
          
          <h3 style={{ color: "var(--cabo-primary-color)", marginBottom: "8px" }}>Gameplay & Setup</h3>
          <ul style={{ paddingLeft: "20px", marginBottom: "16px" }}>
            <li style={{ marginBottom: "8px" }}>Each player starts with 4 face-down cards. At the beginning, you may peek at 2 of them.</li>
            <li style={{ marginBottom: "8px" }}>On your turn, you draw a card from the deck or the discard pile.</li>
            <li style={{ marginBottom: "8px" }}>You can swap the drawn card with one of your own cards, or discard it. If you discard a card from the draw pile with a special ability, you may use it.</li>
          </ul>

          <h3 style={{ color: "var(--cabo-primary-color)", marginBottom: "8px" }}>Special Ability Cards</h3>
          <p style={{ marginBottom: "8px" }}>If you discard a card drawn from the deck, you can trigger its special ability:</p>
          <ul style={{ paddingLeft: "20px" }}>
            <li style={{ marginBottom: "8px" }}><strong>Peek:</strong> Look at one of your own hidden cards.</li>
            <li style={{ marginBottom: "8px" }}><strong>Spy:</strong> Look at one card belonging to an opponent.</li>
            <li style={{ marginBottom: "8px" }}><strong>Swap:</strong> Trade one of your cards with any opponent&apos;s card, without looking at it before.</li>
          </ul>

          <h3 style={{ color: "var(--cabo-primary-color)", marginBottom: "8px" }}>End of the Game</h3>
          <p style={{ marginBottom: "8px" }}>If you think you have the least amount of points you can call cabo:</p>
          <ul style={{ paddingLeft: "20px" }}>
            <li style={{ marginBottom: "8px" }}>After you called cabo you have no turns left. Each of your opponents has one last turn.</li>
            <li style={{ marginBottom: "8px" }}>The player with the fewest points wins the game.</li>
          </ul>
        </div>

        <div style={{ marginTop: "24px", textAlign: "right" }}>
          <button 
            onClick={onClose}
            className="settings-appearance-dot-btn"
            style={{ cursor: "pointer", padding: "6px 24px" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default GameTutorialModal;