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
    <div className="game-tutorial-section">
      <h3 className="game-tutorial-heading game-tutorial-heading-first">Navigation & Lobby</h3>
      <p>Welcome to Online-CABO! Here is how you get around the platform:</p>
      <ul>
        <li><strong>Dashboard:</strong> Your central hub. Look at your win rate, stats, or access settings.</li>
        <li><strong>Join a Game:</strong> Enter an existing lobby using a shared lobby ID or browse public games.</li>
        <li><strong>Create a New Lobby:</strong> Host your own game, customize settings, and invite friends.</li>
        <li><strong>Leaderboard:</strong> Check out the &quot;Users & Leaderboard&quot; section to see how other players are performing.</li>
      </ul>
    </div>
  );

  // How to play CABO
  const gameRules = (
    <div className="game-tutorial-section game-tutorial-section-scroll">
      <h3 className="game-tutorial-heading game-tutorial-heading-first">Objective</h3>
      <p>The goal of CABO is to minimize the total value of your cards by the time the game ends.</p>
      
      <h3 className="game-tutorial-heading">Gameplay & Setup</h3>
      <ul>
        <li>Each player starts with 4 face-down cards. At the beginning, you may peek at 2 of them.</li>
        <li>On your turn, you draw a card from the deck or the discard pile.</li>
        <li>You can swap the drawn card with one of your own cards, or discard it.</li>
      </ul>

      <h3 className="game-tutorial-heading">Special Ability Cards</h3>
      <p>If you discard a card drawn from the deck, you can trigger its special ability:</p>
      <ul>
        <li><strong>Peek:</strong> Look at one of your own hidden cards.</li>
        <li><strong>Spy:</strong> Look at one card belonging to an opponent.</li>
        <li><strong>Swap:</strong> Trade one of your cards with any opponent&apos;s card (without looking at them!).</li>
      </ul>

      <h3 className="game-tutorial-heading">Calling &quot;CABO&quot;</h3>
      <p>If you believe you have the lowest score, you can call <strong>&quot;CABO&quot;</strong> at the start of your turn. You cannot take any actions on that turn, and every other player gets exactly one final turn. Then, cards are revealed!</p>
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
      title={<div className="game-tutorial-title">CABO Tutorial & Guide</div>}
      open={isOpen}
      onCancel={onClose}
      footer={null}
      centered
      width={600}
      rootClassName="game-tutorial-modal"
    >
      <div className="game-tutorial-body">
        <Tabs defaultActiveKey="website" items={tabItems} className="game-tutorial-tabs" />
      </div>
    </Modal>
  );
};

export default GameTutorialModal;
