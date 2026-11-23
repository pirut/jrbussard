/* Loads Fraunces (display serif) and Nunito (rounded sans) once, only on
   nest pages. Stylesheet only; no third-party scripts. */

import { useEffect } from 'react';

const HREF = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Nunito:wght@400..800&display=swap';

export function useNestFonts() {
  useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById('nest-fonts')) return;
    for (const origin of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
      const pre = document.createElement('link');
      pre.rel = 'preconnect';
      pre.href = origin;
      if (origin.includes('gstatic')) pre.crossOrigin = 'anonymous';
      document.head.appendChild(pre);
    }
    const link = document.createElement('link');
    link.id = 'nest-fonts';
    link.rel = 'stylesheet';
    link.href = HREF;
    document.head.appendChild(link);
  }, []);
}
