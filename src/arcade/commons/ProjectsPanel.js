import React from "react";
import { ITEMS, inventoryOf } from "../../lib/survival";
import { inSafeZone } from "../../lib/terrain";
import { PROJECTS, activeProject, projectFraction } from "../../lib/game/projects";
import "./gameplay.css";

/*
 * The shared work at the crossroads: what is being built, how far along it
 * is, and a hand-in button for each supply it still needs. Anyone can give;
 * you have to be standing at the crossroads to do it.
 */
export default function ProjectsPanel({ projects, me, onContribute }) {
  if (!projects) return null;
  const rows = Object.fromEntries(projects.map((p) => [p.key, p]));
  const active = activeProject(rows);
  const here = me && inSafeZone(me.x, me.y);
  const bag = inventoryOf(me);
  return (
    <section className="commons-projects" aria-label="Crossroads projects">
      <h3 className="journal-heading">Building the commons</h3>
      <p className="station-status">
        {here
          ? "You are at the crossroads. Give what you can."
          : "Carry supplies to the crossroads (0, 0) to help build."}
      </p>
      {PROJECTS.map((project) => {
        const row = rows[project.key];
        const done = row?.done;
        const current = active?.key === project.key;
        return (
          <article
            key={project.key}
            className={`commons-project ${done ? "is-done" : current ? "is-current" : "is-ahead"}`}
          >
            <header>
              <b>{project.name}</b>
              <span>
                {done
                  ? "finished"
                  : `${Math.floor(projectFraction(project, row?.progress) * 100)}%`}
              </span>
            </header>
            <p>{done ? project.effect : `${project.detail} ${project.effect}`}</p>
            {current && (
              <ul>
                {Object.entries(project.need).map(([item, need]) => {
                  const given = row?.progress?.[item] || 0;
                  return (
                    <li key={item}>
                      <span>{ITEMS[item]?.name || item}</span>
                      <span>
                        {Math.min(given, need)}/{need}
                      </span>
                      <button
                        disabled={!here || given >= need || !bag[item] || me?.hp <= 0}
                        onClick={() => onContribute(item)}
                        aria-label={`Give ${ITEMS[item]?.name || item}`}
                      >
                        Give
                      </button>
                      <i aria-hidden="true" style={{ width: `${Math.min(1, given / need) * 100}%` }} />
                    </li>
                  );
                })}
              </ul>
            )}
            {(current || done) && row?.contributors > 0 && (
              <small>
                {row.contributors} {row.contributors === 1 ? "person has" : "people have"} helped
              </small>
            )}
          </article>
        );
      })}
    </section>
  );
}
