import React, { useEffect, useRef, useState } from "react";

interface CardProps {
  hidden: boolean;        // true = card back, false = show value
  value?: number;         // shown when hidden=false
  abilityLabel?: string;
  size?: "small" | "medium" | "large";
  onClick?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLDivElement>;
  onDragEnd?: React.DragEventHandler<HTMLDivElement>;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
  onDragEnter?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
  flipDurationMs?: number;
}

// get the correct path for card face images
const getCardImagePath = (value: number): string => {
  return `/card${value}.jpg`;
};

const DEFAULT_FLIP_ANIMATION_MS = 280;

const CardComponent: React.FC<CardProps> = ({
  hidden,
  value,
  abilityLabel,
  size = "medium",
  onClick,
  disabled = false,
  style,
  draggable = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onDragEnter,
  onDragLeave,
  flipDurationMs = DEFAULT_FLIP_ANIMATION_MS,
}) => {
  const [flipClass, setFlipClass] = useState<string>("");
  const previousHiddenRef = useRef<boolean>(hidden);
  const flipResetTimeoutRef = useRef<number | null>(null);

  const effectiveFlipAnimationMs =
    Number.isFinite(Number(flipDurationMs)) && Number(flipDurationMs) > 0
      ? Math.max(1, Math.round(Number(flipDurationMs)))
      : DEFAULT_FLIP_ANIMATION_MS;

  useEffect(() => {
    const previousHidden = previousHiddenRef.current;
    if (previousHidden !== hidden) {
      setFlipClass(hidden ? "card-flip-to-back" : "card-flip-to-front");
      if (flipResetTimeoutRef.current != null) {
        window.clearTimeout(flipResetTimeoutRef.current);
      }
      flipResetTimeoutRef.current = window.setTimeout(() => {
        setFlipClass("");
        flipResetTimeoutRef.current = null;
      }, effectiveFlipAnimationMs);
    }
    previousHiddenRef.current = hidden;
  }, [effectiveFlipAnimationMs, hidden]);

  useEffect(() => {
    return () => {
      if (flipResetTimeoutRef.current != null) {
        window.clearTimeout(flipResetTimeoutRef.current);
      }
    };
  }, []);

  const handleClick = () => {
    if (!disabled && onClick) {
      onClick();
    }
  };

  const cursorStyle = disabled ? "not-allowed" : draggable ? "grab" : onClick ? "pointer" : "default";
  const opacityStyle = disabled ? 0.6 : 1;
  const cardClassName = `card ${size}${flipClass ? ` ${flipClass}` : ""}`;
  const flipAnimationName =
    flipClass === "card-flip-to-front"
      ? "gameCardFlipToFront"
      : flipClass === "card-flip-to-back"
        ? "gameCardFlipToBack"
        : "";
  const baseAnimation =
    typeof style?.animation === "string" && style.animation.trim().length > 0
      ? style.animation
      : "";
  const mergedAnimation =
    flipAnimationName && baseAnimation
      ? `${baseAnimation}, ${flipAnimationName} ${effectiveFlipAnimationMs}ms ease-out`
      : flipAnimationName
        ? `${flipAnimationName} ${effectiveFlipAnimationMs}ms ease-out`
        : baseAnimation || undefined;


// card backsides
  if (hidden) {
    // card back — uses the existing .card CSS class with cards.jpg background
    return (
      <div
        className={cardClassName}
        onClick={handleClick}
        draggable={!disabled && draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        style={{
          cursor: cursorStyle,
          opacity: opacityStyle,
          ...style,
          ...(mergedAnimation ? { animation: mergedAnimation } : {}),
        }}
      />
    );
  }

  // card front — shows the correct picture
  const imagePath = value !== undefined ? getCardImagePath(value) : null;

  return (
    <div
          className={cardClassName}
          onClick={handleClick}
          draggable={!disabled && draggable}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          style={{
            cursor: cursorStyle,
            opacity: opacityStyle,
            backgroundImage: imagePath ? `url(${imagePath})` : "none",
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundColor: imagePath ? "transparent" : "#fff",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            border: "2px solid #999",
            position: "relative",
            ...style,
            ...(mergedAnimation ? { animation: mergedAnimation } : {}),
          }}
          title={abilityLabel}
        >
          {abilityLabel && (
            <span className="card-ability-label">
              {abilityLabel}
            </span>
          )}
          {/* if no picture yet show value with white backgorund */}
          {!imagePath && (
            <span style={{
              fontSize: "24px",
              fontWeight: "bold",
              color: "#333",
            }}>
              {value ?? "?"}
            </span>
          )}
        </div>
      );
    };

    export default CardComponent;
