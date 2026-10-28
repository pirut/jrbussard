import React from "react";

export default function Objective({ objective }) {
  if (!objective) return null;
  return (
    <section className="hud-quest" aria-label="Next goal">
      <span>NEXT</span>
      <b>{objective.title}</b>
      <small>{objective.detail}</small>
    </section>
  );
}
