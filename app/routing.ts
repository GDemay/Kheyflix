export type Route = { section: 'home'|'movies'|'series'|'search'|'discover'|'title'|'watch'|'profile'|'debrid'|'stream'; id?: string; file?:number; title?:string; query?: string; compat?:boolean };

export const parseRoute = (location = '/'): Route => {
  const url = new URL(location, 'https://kheyflix.local');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'watch') return { section:'watch', id:parts[1] };
  if (parts[0] === 'stream') { const legacy=url.searchParams.get('title'),slug=decodeURIComponent(parts.slice(3).join('-'));return { section:'stream', id:parts[1], file:Number(parts[2]), title:legacy||slug.split('-').filter(Boolean).map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(' ')||'Kheyflix video', compat:url.searchParams.get('compat')==='1' }; }
  if (parts[0] === 'debrid') return { section:'debrid', id:decodeURIComponent(parts[1]||''), file:parts[2]===undefined?undefined:Number(parts[2]), title:url.searchParams.get('title') || 'Kheyflix title' };
  if (parts[0] === 'title') return { section:'title', id:parts[1] };
  if (parts[0] === 'profile') return { section:'profile' };
  if (parts[0] === 'discover') return { section:'discover' };
  if (parts[0] === 'search') return { section:'search', query:url.searchParams.get('q') ?? '' };
  if (parts[0] === 'movies' || parts[0] === 'series') return { section:parts[0] };
  return { section:'home' };
};

export const routePath = (route:Route) => {
  if (route.section === 'home') return '/';
  if (route.section === 'search') return `/search${route.query ? `?q=${encodeURIComponent(route.query)}` : ''}`;
  if (route.section === 'stream') { const slug=(route.title||'kheyflix-video').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100);return `/stream/${route.id}/${route.file}/${slug}${route.compat?'?compat=1':''}`; }
  if (route.section === 'debrid') return `/debrid/${encodeURIComponent(route.id||'')}${route.file===undefined?'':`/${route.file}`}?title=${encodeURIComponent(route.title || 'Kheyflix title')}`;
  if (route.section === 'title' || route.section === 'watch') return `/${route.section}/${route.id}`;
  return `/${route.section}`;
};
