import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConvexReactClient } from 'convex/react';
import { anyApi } from 'convex/server';
import type { api as generated } from '@convex/_generated/api';

/*
 * The same Convex deployment the browser Commons talks to. The URL is a
 * public client address, not a secret; it comes from EXPO_PUBLIC_CONVEX_URL
 * (see .env.example), which Expo inlines when it bundles. Without it the
 * app plays the offline stand-in, as the browser build does.
 *
 * Function references are built at runtime by name (anyApi), so the bundle
 * never imports convex/_generated; only the types come from there, which is
 * what keeps the app's arguments and results checked against convex/world.ts.
 */
export const CONVEX_URL = (process.env.EXPO_PUBLIC_CONVEX_URL ?? '').trim();

export const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null;

export const api = (anyApi as unknown as typeof generated).world;

/* A stable per-install identity, like the browser's per-browser one. */
const SESSION_KEY = 'commons_session';
const NAME_KEY = 'commons_name';

function randomId() {
  let id = '';
  for (let i = 0; i < 4; i += 1) id += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `s_${id}`;
}

const ADJECTIVES = ['quiet', 'rust', 'dry', 'pale', 'long', 'salt', 'low', 'grey'];
const NOUNS = ['fern', 'socket', 'harbor', 'ember', 'gull', 'pine', 'kettle', 'wire'];
const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];

export async function loadIdentity(): Promise<{ session: string; name: string }> {
  try {
    let session = await AsyncStorage.getItem(SESSION_KEY);
    let name = await AsyncStorage.getItem(NAME_KEY);
    if (!session) {
      session = randomId();
      await AsyncStorage.setItem(SESSION_KEY, session);
    }
    if (!name) {
      name = `${pick(ADJECTIVES)}_${pick(NOUNS)}`;
      await AsyncStorage.setItem(NAME_KEY, name);
    }
    return { session, name };
  } catch {
    return { session: randomId(), name: 'wanderer' };
  }
}
