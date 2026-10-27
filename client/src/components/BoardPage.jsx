import { useEffect } from 'react';
import LivePage from './LivePage.jsx';

// The board a position pasted on the Home page opens on. It only opens with a
// position handed over from Home in this tab; online it is the only way onto
// an analysis board, since the Live board itself is local-only.
export default function BoardPage() {
  let handed = false;
  try {
    handed = !!sessionStorage.getItem('boardFromHome');
  } catch {}
  useEffect(() => {
    if (!handed) location.hash = '#/';
  }, [handed]);
  return handed ? <LivePage /> : null;
}
