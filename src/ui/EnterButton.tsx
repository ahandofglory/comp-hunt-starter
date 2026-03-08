import React from "react";

export function EnterButton({
  label = "Label",
  icon,
  onClick,
}: {
  label?: string;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0.4rem 1rem",
        borderRadius: "6.4px",
        background: "var(--color-background-bg-primary-inverse)",
        color: "var(--color-text-text-primary-inverse)",
        border: "none",
        fontSize: "0.78rem",
        fontWeight: 500,
        cursor: "pointer",
        letterSpacing: "0.01em",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {label}
      {icon && <span style={{ display: "inline-flex", alignItems: "center" }}>{icon}</span>}
    </button>
  );
}
