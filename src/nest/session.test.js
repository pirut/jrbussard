import {
  SESSION_KEY, readSession, writeSession, clearSession, parseFragment, routeIntent,
  takeFragmentSecrets, peekSecrets, consumeTouchSecret, consumeClaimCode, resetSecretsForTests,
} from './session';

beforeEach(() => {
  resetSecretsForTests();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('session storage', () => {
  test('writes, reads and clears nest.session', () => {
    writeSession('tok-1');
    expect(window.localStorage.getItem(SESSION_KEY)).toBe('tok-1');
    expect(readSession()).toBe('tok-1');
    clearSession();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(readSession()).toBeNull();
  });

  test('keeps working in memory when storage throws', () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => writeSession('mem-tok')).not.toThrow();
    expect(readSession()).toBe('mem-tok');
    get.mockRestore();
    set.mockRestore();
  });
});

describe('fragments', () => {
  test('parseFragment accepts base64url and rejects junk', () => {
    expect(parseFragment('#abc_DEF-123')).toBe('abc_DEF-123');
    expect(parseFragment('abc')).toBe('abc');
    expect(parseFragment('')).toBeNull();
    expect(parseFragment('#')).toBeNull();
    expect(parseFragment('#a b')).toBeNull();
    expect(parseFragment('#<script>')).toBeNull();
    expect(parseFragment('#%E0%A4%A')).toBeNull();
    expect(parseFragment(`#${'a'.repeat(201)}`)).toBeNull();
  });

  test('routeIntent reads claim and touch paths', () => {
    expect(routeIntent('/nest/claim', '#code1')).toEqual({ kind: 'claim', code: 'code1' });
    expect(routeIntent('/nest/claim/', '')).toEqual({ kind: 'claim', code: null });
    expect(routeIntent('/nest/touch/abcdefghjkmn', '#sec')).toEqual({ kind: 'touch', tagId: 'abcdefghjkmn', secret: 'sec' });
    expect(routeIntent('/nest', '#x')).toEqual({ kind: 'none' });
    expect(routeIntent('/nest/touch/a!b', '#x')).toEqual({ kind: 'none' });
  });

  test('takes a touch secret and clears it from the address bar', () => {
    window.history.replaceState(null, '', '/nest/touch/abcdefghjkmn?x=1#s3cret');
    takeFragmentSecrets();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/nest/touch/abcdefghjkmn');
    expect(window.location.search).toBe('?x=1');
    expect(peekSecrets().touch).toMatchObject({ tagId: 'abcdefghjkmn', secret: 's3cret' });
    /* a second read (React's double render) still sees it */
    takeFragmentSecrets();
    expect(peekSecrets().touch.secret).toBe('s3cret');
    expect(consumeTouchSecret('other')).toBeNull();
    expect(consumeTouchSecret('abcdefghjkmn').secret).toBe('s3cret');
    expect(peekSecrets().touch).toBeNull();
  });

  test('takes a claim code and clears it', () => {
    window.history.replaceState(null, '', '/nest/claim#claim_code');
    takeFragmentSecrets();
    expect(window.location.hash).toBe('');
    expect(consumeClaimCode()).toBe('claim_code');
    expect(consumeClaimCode()).toBeNull();
  });

  test('leaves fragments alone on other pages', () => {
    window.history.replaceState(null, '', '/notes#section');
    takeFragmentSecrets();
    expect(window.location.hash).toBe('#section');
  });
});
