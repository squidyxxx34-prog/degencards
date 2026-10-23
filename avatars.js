/* DEGENCARDS — preset avatars (original artwork, drawn as SVG). Picked in Account, rasterized to a 256x256
   image and saved like an uploaded picture (set_avatar), so the top bar, Account and the leaderboard show it as is. */
(() => {
  const W = '#F4F2FA', INK = '#15131C', P = '#C09EFF', P2 = '#8B6CF0', G = '#3DFFA0', R = '#FF5C6C', Y = '#FFD35C', O = '#FF8A3D';
  const A = [
    { id: 'candles', name: 'Candles', bg: ['#3A2A66', '#120E22'], art: () =>
      `<line x1="32" y1="30" x2="32" y2="74" stroke="${G}" stroke-width="3" stroke-linecap="round"/><rect x="26" y="40" width="12" height="26" rx="2.5" fill="${G}"/>
       <line x1="50" y1="38" x2="50" y2="80" stroke="${R}" stroke-width="3" stroke-linecap="round"/><rect x="44" y="47" width="12" height="24" rx="2.5" fill="${R}"/>
       <line x1="68" y1="18" x2="68" y2="64" stroke="${G}" stroke-width="3" stroke-linecap="round"/><rect x="62" y="24" width="12" height="32" rx="2.5" fill="${G}"/>` },
    { id: 'diamond', name: 'Diamond', bg: ['#2C3A7A', '#0D1230'], art: () =>
      `<polygon points="28,42 39,27 61,27 72,42 50,76" fill="${W}"/>
       <g fill="none" stroke="${P2}" stroke-width="2" stroke-linejoin="round"><polyline points="28,42 72,42"/><polyline points="39,27 45,42 50,76 55,42 61,27"/><polyline points="45,42 50,27 55,42"/></g>` },
    { id: 'rocket', name: 'Rocket', bg: ['#1F3B78', '#0A1128'], art: () =>
      `<g transform="rotate(40 50 50)"><path d="M44 62 L50 84 L56 62Z" fill="${O}"/><path d="M47 62 L50 74 L53 62Z" fill="${Y}"/>
       <path d="M40 50 L31 66 L40 62Z M60 50 L69 66 L60 62Z" fill="${P}"/>
       <path d="M50 16 C61 27 63 44 60 62 L40 62 C37 44 39 27 50 16Z" fill="${W}"/><circle cx="50" cy="40" r="6.5" fill="${P2}"/><circle cx="50" cy="40" r="3" fill="#BFD2FF"/></g>` },
    { id: 'moon', name: 'Moon', bg: ['#26315E', '#0B0F24'], art: () =>
      `<path d="M45.3 27.06 A25 25 0 1 0 70.83 59.56 A21 21 0 0 1 45.3 27.06Z" fill="#FFF1C9"/><circle cx="74" cy="66" r="2" fill="${W}"/><circle cx="70" cy="24" r="1.6" fill="${W}"/><circle cx="82" cy="44" r="1.3" fill="${W}"/>` },
    { id: 'flame', name: 'Flame', bg: ['#5A1F1F', '#1A0909'], art: () =>
      `<path d="M50 14 C58 31 72 40 70 60 C69 74 60 83 50 83 C40 83 31 74 30 60 C29 46 40 40 42 28 C46 36 48 40 50 14Z" fill="${O}"/>
       <path d="M50 44 C56 54 62 58 60 68 C59 75 55 79 50 79 C45 79 41 75 40 68 C40 60 46 56 50 44Z" fill="${Y}"/>` },
    { id: 'bolt', name: 'Bolt', bg: ['#4A2C86', '#150C2A'], art: () =>
      `<polygon points="57,12 28,55 47,55 41,88 72,42 53,42" fill="${Y}" stroke="#E8B93A" stroke-width="2" stroke-linejoin="round"/>` },
    { id: 'crown', name: 'Crown', bg: ['#5C4513', '#1C1406'], art: () =>
      `<path d="M24 66 L20 33 L36 47 L50 25 L64 47 L80 33 L76 66Z" fill="${Y}"/><rect x="24" y="68" width="52" height="9" rx="2.5" fill="#E8B93A"/>
       <circle cx="50" cy="55" r="4.5" fill="${P2}"/><circle cx="35" cy="59" r="3" fill="${R}"/><circle cx="65" cy="59" r="3" fill="${G}"/>` },
    { id: 'skull', name: 'Skull', bg: ['#3A3A46', '#111116'], art: () =>
      `<circle cx="50" cy="44" r="24" fill="${W}"/><rect x="38" y="56" width="24" height="19" rx="5" fill="${W}"/>
       <circle cx="41" cy="45" r="6.5" fill="${INK}"/><circle cx="59" cy="45" r="6.5" fill="${INK}"/><polygon points="50,53 46,61 54,61" fill="${INK}"/>
       <g stroke="${INK}" stroke-width="2.4" stroke-linecap="round"><line x1="45" y1="66" x2="45" y2="74"/><line x1="50" y1="66" x2="50" y2="74"/><line x1="55" y1="66" x2="55" y2="74"/></g>` },
    { id: 'ghost', name: 'Ghost', bg: ['#5B3D9E', '#1A1033'], art: () =>
      `<path d="M28 80 L28 46 C28 30 38 20 50 20 C62 20 72 30 72 46 L72 80 L65 73 L58 80 L50 73 L42 80 L35 73Z" fill="${W}"/>
       <ellipse cx="42" cy="46" rx="4.5" ry="6.5" fill="${INK}"/><ellipse cx="58" cy="46" rx="4.5" ry="6.5" fill="${INK}"/><ellipse cx="50" cy="60" rx="4" ry="3" fill="${INK}"/>` },
    { id: 'eye', name: 'Eye', bg: ['#1E5560', '#081A1E'], art: () =>
      `<path d="M14 50 C27 29 73 29 86 50 C73 71 27 71 14 50Z" fill="${W}"/><circle cx="50" cy="50" r="15" fill="${P2}"/><circle cx="50" cy="50" r="7" fill="${INK}"/><circle cx="55" cy="45" r="3.2" fill="${W}"/>` },
    { id: 'planet', name: 'Planet', bg: ['#22306E', '#090D26'], art: () =>
      `<g transform="rotate(-18 50 50)"><path d="M14 50 A36 10 0 0 1 86 50" fill="none" stroke="#E4DCFF" stroke-width="4"/>
       <circle cx="50" cy="50" r="21" fill="${P}"/><path d="M31 44 Q50 40 69 44" stroke="${P2}" stroke-width="3" fill="none"/><path d="M30 55 Q50 51 70 55" stroke="${P2}" stroke-width="3" fill="none"/>
       <path d="M86 50 A36 10 0 0 1 14 50" fill="none" stroke="#E4DCFF" stroke-width="4"/></g>` },
    { id: 'dice', name: 'Dice', bg: ['#1E5A3C', '#081A11'], art: () =>
      `<g transform="rotate(-12 50 50)"><rect x="25" y="25" width="50" height="50" rx="11" fill="${W}"/>
       <g fill="${INK}"><circle cx="37" cy="37" r="5"/><circle cx="63" cy="37" r="5"/><circle cx="50" cy="50" r="5"/><circle cx="37" cy="63" r="5"/><circle cx="63" cy="63" r="5"/></g></g>` },
    { id: 'coins', name: 'Stack', bg: ['#5E4214', '#1D1406'], art: () =>
      [0, 1, 2, 3].map(i => { const y = 70 - i * 11;
        return `<rect x="28" y="${y}" width="44" height="9" fill="#D99A28"/><ellipse cx="50" cy="${y + 9}" rx="22" ry="7" fill="#D99A28"/><ellipse cx="50" cy="${y}" rx="22" ry="7" fill="${Y}" stroke="#D99A28" stroke-width="2"/>`; }).join('') },
    { id: 'pump', name: 'Pump', bg: ['#155440', '#06190F'], art: () =>
      `<g stroke="rgba(244,242,250,.12)" stroke-width="1.5"><line x1="16" y1="34" x2="84" y2="34"/><line x1="16" y1="52" x2="84" y2="52"/><line x1="16" y1="70" x2="84" y2="70"/></g>
       <polyline points="16,74 34,58 48,64 76,32" fill="none" stroke="${G}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
       <polygon points="86,22 64,26 82,44" fill="${G}"/>` },
    { id: 'sniper', name: 'Sniper', bg: ['#5A1E2A', '#1A080C'], art: () =>
      `<circle cx="50" cy="50" r="30" fill="${R}"/><circle cx="50" cy="50" r="22" fill="${W}"/><circle cx="50" cy="50" r="14" fill="${R}"/><circle cx="50" cy="50" r="6" fill="${W}"/>
       <g stroke="${INK}" stroke-width="2.4" stroke-linecap="round"><line x1="50" y1="12" x2="50" y2="30"/><line x1="50" y1="70" x2="50" y2="88"/><line x1="12" y1="50" x2="30" y2="50"/><line x1="70" y1="50" x2="88" y2="50"/></g>` },
    { id: 'spark', name: 'Spark', bg: ['#3B2470', '#100A20'], art: () =>
      `<path d="M50 14 L57 43 L86 50 L57 57 L50 86 L43 57 L14 50 L43 43Z" fill="${P}"/><path d="M50 30 L53.5 46.5 L70 50 L53.5 53.5 L50 70 L46.5 53.5 L30 50 L46.5 46.5Z" fill="${W}"/>
       <path d="M76 18 L78 24 L84 26 L78 28 L76 34 L74 28 L68 26 L74 24Z" fill="${W}"/>` },
  ];
  let n = 0;
  const svg = a => { const u = 'av' + (n++);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256"><defs><radialGradient id="g${u}" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="${a.bg[0]}"/><stop offset="1" stop-color="${a.bg[1]}"/></radialGradient></defs><rect width="100" height="100" fill="url(#g${u})"/>${a.art(u)}</svg>`; };
  window.DC_AVATARS = A.map(a => ({ id: a.id, name: a.name, svg: () => svg(a) }));
})();
