"use client";

import React from "react";
import { Modal, Tabs } from "antd";

interface GameTutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const GameTutorialModal: React.FC<GameTutorialModalProps> = ({ isOpen, onClose }) => {
  // How to use the Website
  const websiteGuide = (
    <div style={{ padding: "8px 0" }}>
      <h3 style={{ marginTop: 0 }}>Navigation & Lobby</h3>
      <p>Welcome to Online-CABO! Here is how you get around the platform:</p>
      <ul>
        <li><strong>Dashboard:</strong> Your central hub. Look at your win rate, stats, or access settings.</li>
        <li><strong>Join a Game:</strong> Enter an existing lobby using a shared lobby ID or browse public games.</li>
        <li><strong>Create a New Lobby:</strong> Host your own game, customize settings, and invite friends.</li>
        <li><strong>Leaderboard:</strong> Check out the "Users & Leaderboard" section to see how other players are performing.</li>
      </ul>
    </div>
  );

  // How to play CABO
  const gameRules = (
    <div style={{ padding: "8px 0", maxHeight: "400px", overflowY: "auto" }}>
      <h3 style={{ marginTop: 0 }}>Objective</h3>
      <p>The goal of CABO is to minimize the total value of your cards by the time the game ends.</p>
      
      <h3>Gameplay & Setup</h3>
      <ul>
        <li>Each player starts with 4 face-down cards. At the beginning, you may peek at 2 of them.</li>
        <li>On your turn, you draw a card from the deck or the discard pile.</li>
        <li>You can swap the drawn card with one of your own cards, or discard it.</li>
      </ul>

      <h3>Special Ability Cards</h3>
      <p>If you discard a card drawn from the deck, you can trigger its special ability:</p>
      <ul>
        <li><strong>Peek:</strong> Look at one of your own hidden cards.</li>
        <li><strong>Spy:</strong> Look at one card belonging to an opponent.</li>
        <li><strong>Swap:</strong> Trade one of your cards with any opponent's card (without looking at them!).</li>
      </ul>

      <h3>Calling "CABO"</h3>
      <p>If you believe you have the lowest score, you can call <strong>"CABO"</strong> at the start of your turn. You cannot take any actions on that turn, and every other player gets exactly one final turn. Then, cards are revealed!</p>
    </div>
  );

  const tabItems = [
    {
      key: "website",
      label: "How to use Website",
      children: websiteGuide,
    },
    {
      key: "game",
      label: "How to play Game",
      children: gameRules,
    },
  ];

  return (
    <Modal
      title={<div style={{ fontSize: "20px", fontWeight: "bold" }}>CABO Tutorial & Guide</div>}
      open={isOpen}
      onCancel={onClose}
      footer={null}
      centered
      width={600}
      styles={{ body: { color: "#222222" } }}
    >
      <div style={{ color: "#222" }}> 
        <Tabs defaultActiveKey="website" items={tabItems} style={{ marginTop: "12px" }} />
      </div>
    </Modal>
  );
};

export default GameTutorialModal;