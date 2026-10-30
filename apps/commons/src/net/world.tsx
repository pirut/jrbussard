import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConvexProvider, useMutation, useQuery } from 'convex/react';
import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import { api, convex, gameApi, loadIdentity } from './convex';
import { createDemo } from '../shared';

/*
 * One shape for "the world", whoever answers: the shared Convex deployment,
 * or the offline stand-in from the browser game (src/arcade/ascii3d/demo.js)
 * when no URL is configured. The game screen only sees this.
 */
export type WorldState = FunctionReturnType<typeof api.state>;

/* Every way the player can change the world, by the name the game uses. The
   offline stand-in answers to the same names (demo.js `calls`). */
type Mutations = {
  move: typeof api.move;
  harvest: typeof api.harvest;
  terraform: typeof api.terraform;
  build: typeof api.build;
  respawn: typeof api.respawn;
  craft: typeof api.craft;
  eat: typeof api.eat;
  drink: typeof api.drink;
  say: typeof api.say;
  claimQuest: typeof gameApi.claimQuest;
};
export type CallKind = keyof Mutations;
export type CallArgs<K extends CallKind> = Omit<FunctionArgs<Mutations[K]>, 'session'>;
/* The stand-in answers with a message where the server may answer with a
   position, so callers treat every result as possibly either. */
export type CallResult<K extends CallKind> = FunctionReturnType<Mutations[K]> | string | null;
export type Call = <K extends CallKind>(kind: K, args: CallArgs<K>) => Promise<CallResult<K>>;

export type World = {
  state: WorldState | undefined;
  call: Call;
  live: boolean;
  status: string;
};

export function WorldSource({ children }: { children: (world: World) => React.ReactNode }) {
  if (!convex) return <Offline>{children}</Offline>;
  return (
    <ConvexProvider client={convex}>
      <OnlineGate>{children}</OnlineGate>
    </ConvexProvider>
  );
}

function OnlineGate({ children }: { children: (world: World) => React.ReactNode }) {
  const [identity, setIdentity] = useState<{ session: string; name: string } | null>(null);
  useEffect(() => {
    loadIdentity().then(setIdentity);
  }, []);
  if (!identity) return <>{children({ state: undefined, call: noCall, live: true, status: 'finding your name…' })}</>;
  return <Online {...identity}>{children}</Online>;
}

const noCall: Call = async () => null;

function Online({ session, name, children }: { session: string; name: string; children: (world: World) => React.ReactNode }) {
  const state = useQuery(api.state, { session });
  const join = useMutation(api.join);
  const heartbeat = useMutation(api.heartbeat);
  const mutations = {
    move: useMutation(api.move),
    harvest: useMutation(api.harvest),
    terraform: useMutation(api.terraform),
    build: useMutation(api.build),
    respawn: useMutation(api.respawn),
    craft: useMutation(api.craft),
    eat: useMutation(api.eat),
    drink: useMutation(api.drink),
    say: useMutation(api.say),
    claimQuest: useMutation(gameApi.claimQuest),
  };
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;
  const [status, setStatus] = useState('');

  /* Same rhythm as the browser: join once, then a heartbeat every 15s so
     the server keeps you on the map. */
  useEffect(() => {
    join({ session, name }).catch(() => setStatus('Could not join. Check your connection.'));
    const timer = setInterval(() => {
      heartbeat({ session })
        .then(() => setStatus(''))
        .catch(() => setStatus('Connection interrupted. Reconnecting…'));
    }, 15000);
    return () => clearInterval(timer);
  }, [join, heartbeat, session, name]);

  const call = useCallback<Call>(
    (kind, args) => {
      const run = mutationsRef.current[kind] as unknown as (a: object) => Promise<never>;
      return run({ session, ...args });
    },
    [session],
  );

  return <>{children({ state, call, live: true, status })}</>;
}

function Offline({ children }: { children: (world: World) => React.ReactNode }) {
  const demo = useMemo(() => createDemo(), []);
  /* The stand-in builds the query's shape by hand in plain JS; its ids are
     strings rather than branded Convex ids, so it is cast, not checked. */
  const snapshot = useCallback(() => demo.snapshot() as unknown as WorldState, [demo]);
  const [state, setState] = useState<WorldState>(snapshot);

  useEffect(() => {
    const timer = setInterval(() => {
      if (demo.tick(Date.now())) setState(snapshot());
    }, 100);
    return () => clearInterval(timer);
  }, [demo, snapshot]);

  const call = useCallback<Call>(
    async (kind, args) => {
      const message = demo.call(kind, args);
      setState(snapshot());
      return message;
    },
    [demo, snapshot],
  );

  return <>{children({ state, call, live: false, status: 'offline preview: set EXPO_PUBLIC_CONVEX_URL to join the shared world' })}</>;
}
