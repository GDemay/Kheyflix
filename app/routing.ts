export type Route = { section: 'home'|'movies'|'series'|'search'|'title'|'watch'|'profile'|'debrid'|'stream'; id?: string; file?:number; title?:string; query?: string };

export const parseRoute = (location = '/'): Route => {
  const url = new URL(location, 'https://kheyflix.local');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'watch') return { section:'watch', id:parts[1] };
  if (parts[0] === 'stream') return { section:'stream', id:parts[1], file:Number(parts[2]), title:url.searchParams.get('title') || 'AllDebrid video' };
  if (parts[0] === 'debrid') return { section:'debrid', id:decodeURIComponent(parts[1]||''), file:parts[2]===undefined?undefined:Number(parts[2]), title:url.searchParams.get('title') || 'Kheyflix title' };
  if (parts[0] === 'title') return { section:'title', id:parts[1] };
  if (parts[0] === 'profile') return { section:'profile' };
  if (parts[0] === 'search') return { section:'search', query:url.searchParams.get('q') ?? '' };
  if (parts[0] === 'movies' || parts[0] === 'series') return { section:parts[0] };
  return { section:'home' };
};

export const routePath = (route:Route) => {
  if (route.section === 'home') return '/';
  if (route.section === 'search') return `/search${route.query ? `?q=${encodeURIComponent(route.query)}` : ''}`;
  if (route.section === 'stream') return `/stream/${route.id}/${route.file}?title=${encodeURIComponent(route.title || 'AllDebrid video')}`;
  if (route.section === 'debrid') return `/debrid/${encodeURIComponent(route.id||'')}${route.file===undefined?'':`/${route.file}`}?title=${encodeURIComponent(route.title || 'Kheyflix title')}`;
  if (route.section === 'title' || route.section === 'watch') return `/${route.section}/${route.id}`;
  return `/${route.section}`;
};
